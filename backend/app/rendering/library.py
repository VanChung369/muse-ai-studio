"""The media library: everything made in Video Studio (scene clips and
finished films, which stay in their projects) together with the files
uploaded to the library itself.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select

from app.core.config import Settings
from app.core.text import normalize_search_text
from app.models import LibraryAsset, Project, Scene
from app.rendering import storage
from app.rendering.intake import thumbnail_name

MAX_ASSETS = 500


@dataclass(frozen=True)
class Item:
    """One entry of the library, wherever its file lives."""

    # "upload:<asset id>", "scene:<project id>:<number>" or "film:<project id>".
    id: str
    role: str
    kind: str
    title: str
    path: Path
    mime: str
    created_at: datetime
    project_id: str | None = None
    project_name: str | None = None
    scene_number: int | None = None
    asset_id: str | None = None
    seconds: float | None = None
    width: int | None = None
    height: int | None = None
    asset_source: str = "upload"

    @property
    def source(self) -> str:
        return self.asset_source if self.role == "upload" else "studio"

    @property
    def file_name(self) -> str:
        """A name to save the file under."""
        if self.role == "upload":
            return self.title
        label = f" - scene {self.scene_number:02d}" if self.role == "scene" else ""
        return f"{self.project_name}{label}{self.path.suffix}"

    @property
    def urls(self) -> tuple[str, str | None, str | None]:
        """The file, its still and the drawing of its sound."""
        if self.role == "upload":
            base = f"/api/library/assets/{self.asset_id}"
            return (
                f"{base}/file",
                None if self.kind == "audio" else f"{base}/thumbnail",
                f"{base}/waveform" if self.kind == "audio" else None,
            )
        base = f"/api/projects/{self.project_id}"
        # Their address changes with the clip, so a re-render is not hidden
        # behind a cached copy.
        version = f"?v={int(self.created_at.timestamp())}"
        if self.role == "scene":
            scene = f"{base}/scenes/{self.scene_number}"
            return f"{scene}/video{version}", f"{scene}/thumbnail{version}", None
        return f"{base}/video{version}", f"{base}/cover{version}", None


def _aware(moment: datetime | None) -> datetime:
    """Stored times are UTC without saying so."""
    moment = moment or datetime.now(UTC)
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _upload(settings: Settings, asset: LibraryAsset) -> Item:
    return Item(
        id=f"upload:{asset.id}",
        role="upload",
        kind=asset.kind,
        title=asset.name,
        path=storage.library_dir(settings) / asset.file,
        mime=asset.mime,
        created_at=_aware(asset.created_at),
        asset_id=asset.id,
        seconds=asset.seconds,
        width=asset.width,
        height=asset.height,
        asset_source=asset.source,
    )


def _scene(settings, project_id, name, number, title, seconds, file, rendered) -> Item:
    path = storage.project_dir(settings, project_id) / Path(file).name
    return Item(
        id=f"scene:{project_id}:{number}",
        role="scene",
        kind="video",
        title=title,
        path=path,
        mime=storage.media_type(path.name),
        created_at=_aware(rendered),
        project_id=project_id,
        project_name=name,
        scene_number=number,
        seconds=float(seconds),
    )


def _film(settings, project_id, name, file, rendered) -> Item:
    path = storage.project_dir(settings, project_id) / Path(file).name
    return Item(
        id=f"film:{project_id}",
        role="film",
        kind="video",
        title=name,
        path=path,
        mime=storage.media_type(path.name),
        created_at=_aware(rendered),
        project_id=project_id,
        project_name=name,
    )


def catalogue(session, settings: Settings) -> list[Item]:
    """Every library entry whose file is on disk, newest first."""
    items = [
        _upload(settings, asset) for asset in session.scalars(select(LibraryAsset))
    ]
    scenes = session.execute(
        select(
            Scene.project_id,
            Project.name,
            Scene.number,
            Scene.title,
            Scene.duration_seconds,
            Scene.video_file,
            Scene.rendered_at,
        )
        .join(Project, Project.id == Scene.project_id)
        .where(Scene.video_file.is_not(None))
    )
    items += [_scene(settings, *row) for row in scenes]
    films = session.execute(
        select(Project.id, Project.name, Project.video_file, Project.rendered_at).where(
            Project.video_file.is_not(None)
        )
    )
    items += [_film(settings, *row) for row in films]
    items = [item for item in items if item.path.is_file()]
    return sorted(items, key=lambda item: item.created_at, reverse=True)


def matches(item: Item, source: str | None, query: str) -> bool:
    if source and item.source != source:
        return False
    if not query:
        return True
    words = normalize_search_text(f"{item.title} {item.project_name or ''}")
    return normalize_search_text(query) in words


def find(session, settings: Settings, item_id: str) -> Item | None:
    """The entry with this id, if it exists and its file is on disk."""
    role, _, rest = item_id.partition(":")
    item = None
    if role == "upload":
        asset = session.get(LibraryAsset, rest)
        item = _upload(settings, asset) if asset else None
    elif role == "scene":
        project_id, _, number = rest.rpartition(":")
        if number.isdigit():
            row = session.execute(
                select(
                    Scene.project_id,
                    Project.name,
                    Scene.number,
                    Scene.title,
                    Scene.duration_seconds,
                    Scene.video_file,
                    Scene.rendered_at,
                )
                .join(Project, Project.id == Scene.project_id)
                .where(
                    Scene.project_id == project_id,
                    Scene.number == int(number),
                    Scene.video_file.is_not(None),
                )
            ).first()
            item = _scene(settings, *row) if row else None
    elif role == "film":
        project = session.get(Project, rest)
        if project is not None and project.video_file:
            item = _film(
                settings,
                project.id,
                project.name,
                project.video_file,
                project.rendered_at,
            )
    return item if item is not None and item.path.is_file() else None


def still_of(item: Item) -> Path | None:
    """The still already made for an entry's file, if there is one."""
    if item.kind == "audio":
        return None
    name = (
        thumbnail_name(item.path.name)
        if item.role == "upload"
        else storage.thumbnail_file(item.path.name)
    )
    still = item.path.with_name(name)
    return still if still.is_file() else None
