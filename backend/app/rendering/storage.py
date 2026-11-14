"""Where rendered clips live: data/media/projects/<project id>/."""

import os
import shutil
from pathlib import Path

from app.core.config import Settings

FINAL_FILE = "final.mp4"
# A quick, rough version of an edit that is not saved yet.
PREVIEW_FILE = "preview.mp4"
# A frame the user picked to stand for the film.
COVER_FILE = "cover.jpg"
EXTENSIONS = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}
MEDIA_TYPES = {extension: mime for mime, extension in EXTENSIONS.items()}
MEDIA_TYPES[".jpg"] = "image/jpeg"


def project_dir(settings: Settings, project_id: str) -> Path:
    return settings.media_dir / "projects" / project_id


def scene_file(number: int, mime: str) -> str:
    extension = EXTENSIONS.get(mime.split(";", 1)[0].strip().lower(), ".mp4")
    return f"scene-{number:02d}{extension}"


def thumbnail_file(clip_name: str) -> str:
    """The still image kept next to a clip (`scene-01.mp4` -> `scene-01.jpg`)."""
    return Path(clip_name).stem + ".jpg"


def media_type(name: str) -> str:
    return MEDIA_TYPES.get(Path(name).suffix, "application/octet-stream")


def write(path: Path, data: bytes) -> None:
    """Write through a temporary file so a crash never leaves half a clip."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".part")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def references_dir(settings: Settings, project_id: str) -> Path:
    """Pictures and videos the user gave as reference material."""
    return settings.data_dir / "projects" / project_id / "references"


def reference_files(settings: Settings, project_id: str, names) -> list[Path]:
    """The reference files that are really on disk, in the given order."""
    folder = references_dir(settings, project_id)
    return [folder / name for name in names if (folder / name).is_file()]


def media_dir(settings: Settings, project_id: str) -> Path:
    """Videos, pictures and audio the user added to the film."""
    return settings.data_dir / "projects" / project_id / "media"


def library_dir(settings: Settings) -> Path:
    """Files uploaded to the media library, belonging to no project."""
    return settings.data_dir / "library"


def remove_project(settings: Settings, project_id: str) -> None:
    shutil.rmtree(project_dir(settings, project_id), ignore_errors=True)
    shutil.rmtree(
        settings.data_dir / "projects" / project_id, ignore_errors=True
    )
