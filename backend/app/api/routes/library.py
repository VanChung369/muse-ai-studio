import os
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.api.dependencies import get_session
from app.models import LibraryAsset
from app.rendering import library, storage
from app.rendering.ffmpeg import (
    MergeError,
    find_ffmpeg,
    inspect,
    thumbnail,
    waveform,
)
from app.rendering.intake import (
    MAX_BYTES,
    TYPES,
    base_name,
    content_type,
    readable,
    thumbnail_name,
    waveform_name,
)

router = APIRouter(prefix="/library", tags=["Media library"])
DatabaseSession = Annotated[Session, Depends(get_session)]

Kind = Literal["image", "video", "audio"]
PAGE_SIZE = 60
ARCHIVE_LIMIT = 100


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True)


class LibraryItem(CamelModel):
    # "upload:<uuid>", "scene:<project id>:<number>" or "film:<project id>".
    id: str
    role: Literal["upload", "scene", "film"]
    kind: Kind
    # Scenes and films are made in Video Studio and stay in their project.
    source: Literal["studio", "upload", "quick", "api"]
    # The file's name, the scene's title, or the project's name for a film.
    title: str
    project_id: str | None
    project_name: str | None
    scene_number: int | None
    # Set for uploads: the id to delete it by.
    asset_id: str | None
    # Length; null for a picture and for a film.
    seconds: float | None
    size: int | None
    url: str
    # A still, for video and pictures.
    thumbnail_url: str | None
    # A drawing of the sound, for audio.
    waveform_url: str | None
    created_at: datetime
    # Only uploads can be deleted here.
    deletable: bool


class LibraryCounts(CamelModel):
    all: int
    image: int
    video: int
    audio: int


class LibraryPage(CamelModel):
    # Newest first.
    items: list[LibraryItem]
    # How many match the kind, the source and the search.
    total: int
    # How many match the source and the search, per kind.
    counts: LibraryCounts


def error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, detail={"code": code, "message": message})


def describe(item: library.Item) -> LibraryItem:
    url, still, drawing = item.urls
    return LibraryItem(
        id=item.id,
        role=item.role,
        kind=item.kind,
        source=item.source,
        title=item.title,
        project_id=item.project_id,
        project_name=item.project_name,
        scene_number=item.scene_number,
        asset_id=item.asset_id,
        seconds=item.seconds,
        size=item.path.stat().st_size,
        url=url,
        thumbnail_url=still,
        waveform_url=drawing,
        created_at=item.created_at,
        deletable=item.role == "upload",
    )


@router.get("", response_model=LibraryPage)
def list_library(
    request: Request,
    session: DatabaseSession,
    kind: Kind | None = None,
    source: Literal["studio", "upload", "quick", "api"] | None = None,
    q: Annotated[str, Query(max_length=200)] = "",
    limit: Annotated[int, Query(ge=1, le=200)] = PAGE_SIZE,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Every video made in Video Studio and every file uploaded to the
    library, newest first."""
    found = [
        item
        for item in library.catalogue(session, request.app.state.settings)
        if library.matches(item, source, q.strip())
    ]
    session.rollback()
    of_kind = [item for item in found if kind is None or item.kind == kind]
    shown = []
    for item in of_kind[offset : offset + limit]:
        try:
            shown.append(describe(item))
        except OSError:
            # Deleted since it was listed a moment ago.
            continue
    return LibraryPage(
        items=shown,
        total=len(of_kind),
        counts=LibraryCounts(
            all=len(found),
            **{
                name: sum(1 for item in found if item.kind == name)
                for name in ("image", "video", "audio")
            },
        ),
    )


def _count(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(LibraryAsset))


def too_many() -> HTTPException:
    return error(
        409, "too_many_files", f"The library can hold {library.MAX_ASSETS} files."
    )


@router.post(
    "",
    response_model=LibraryItem,
    status_code=201,
    responses={
        409: {"description": "The library is full, or FFmpeg is missing"},
        413: {"description": "File too large"},
        415: {"description": "Not a supported video, picture or audio type"},
        422: {"description": "Empty, or not readable as that kind of media"},
    },
)
async def add_to_library(
    request: Request,
    session: DatabaseSession,
    name: Annotated[str, Query(min_length=1, max_length=200)],
):
    """Upload one file as the raw request body, with its type in Content-Type
    and its original name in `name`."""
    mime = content_type(request.headers.get("content-type"))
    if mime not in TYPES:
        raise error(415, "unsupported_file", "Upload a video, a picture or audio.")
    kind, extension = TYPES[mime]
    settings = request.app.state.settings
    count = _count(session)
    session.rollback()  # No transaction is held while the upload streams in.
    if count >= library.MAX_ASSETS:
        raise too_many()
    # The file's length and frame size are read once, here.
    ffmpeg = find_ffmpeg(settings)
    if ffmpeg is None:
        raise error(
            409, "ffmpeg_unavailable", "FFmpeg is needed to read uploaded media."
        )

    folder = storage.library_dir(settings)
    folder.mkdir(parents=True, exist_ok=True)
    file = f"{uuid4().hex}{extension}"
    target, temporary = folder / file, folder / (file + ".part")
    still = folder / thumbnail_name(file)
    size = 0
    try:
        with temporary.open("wb") as stream:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise error(
                        413, "file_too_large", "A media file can be 200 MB at most."
                    )
                stream.write(chunk)
        if size == 0:
            raise error(422, "empty_file", "The file is empty.")
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)

    try:
        try:
            info = inspect(ffmpeg, target)
        except MergeError:
            info = None
        if not readable(info, kind):
            raise error(
                422, "unreadable_file", f"This file could not be read as {kind}."
            )
        if kind != "audio":
            thumbnail(ffmpeg, target, still)  # Best effort; the list copes without.
        asset = LibraryAsset(
            kind=kind,
            name=base_name(name, file),
            file=file,
            mime=mime,
            size=size,
            seconds=None if kind == "image" else round(info.seconds, 3),
            width=None if kind == "audio" else info.width,
            height=None if kind == "audio" else info.height,
        )
        session.add(asset)
        session.flush()
        # Counted again now that this request holds the write lock: uploads
        # that streamed in at the same time cannot all slip past the limit.
        if _count(session) > library.MAX_ASSETS:
            raise too_many()
        session.commit()
        session.refresh(asset)
        item = library.find(session, settings, f"upload:{asset.id}")
    except Exception:
        session.rollback()
        target.unlink(missing_ok=True)
        still.unlink(missing_ok=True)
        raise
    return describe(item)


@router.get(
    "/archive",
    response_class=FileResponse,
    responses={404: {"description": "None of the files exist"}},
)
def download_archive(
    request: Request,
    session: DatabaseSession,
    ids: Annotated[list[str], Query(min_length=1, max_length=ARCHIVE_LIMIT)],
):
    """The chosen files in one zip archive."""
    settings = request.app.state.settings
    found = [library.find(session, settings, item_id) for item_id in dict.fromkeys(ids)]
    session.rollback()
    items = [item for item in found if item is not None]
    if not items:
        raise error(404, "library_item_not_found", "None of these files exist.")
    handle = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    handle.close()
    taken: set[str] = set()
    # Media is already compressed: store it as it is.
    with zipfile.ZipFile(handle.name, "w", zipfile.ZIP_STORED) as archive:
        for item in items:
            name = Path(item.file_name)
            stem = "".join("_" if char in '\\/:*?"<>|' else char for char in name.stem)
            # Never an entry called "." or "..".
            stem = stem if stem.strip(". ") else "file"
            unique, number = f"{stem}{name.suffix}", 2
            while unique.lower() in taken:
                unique, number = f"{stem} ({number}){name.suffix}", number + 1
            taken.add(unique.lower())
            try:
                archive.write(item.path, unique)
            except OSError:
                # Deleted since it was found: the others still download.
                continue
    return FileResponse(
        handle.name,
        media_type="application/zip",
        filename="library.zip",
        background=BackgroundTask(os.unlink, handle.name),
    )


def _asset(session: Session, asset_id: str) -> LibraryAsset:
    asset = session.get(LibraryAsset, asset_id)
    if asset is None:
        raise error(404, "library_item_not_found", "This file is not in the library.")
    return asset


def _serve(path: Path, mime: str, name: str | None = None) -> FileResponse:
    if not path.is_file():
        raise error(404, "library_item_not_found", "This file is not in the library.")
    return FileResponse(
        path,
        media_type=mime,
        filename=name,
        headers={
            "Cache-Control": "private, max-age=3600",
            # The type was declared by the uploader: never let a browser
            # guess a different one from the bytes.
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get(
    "/assets/{asset_id}/file",
    response_class=FileResponse,
    responses={404: {"description": "Not in the library"}},
)
def get_asset(
    asset_id: str, request: Request, session: DatabaseSession, download: bool = False
):
    asset = _asset(session, asset_id)
    path = storage.library_dir(request.app.state.settings) / asset.file
    mime, name = asset.mime, asset.name
    session.rollback()
    return _serve(path, mime, name if download else None)


@router.get(
    "/assets/{asset_id}/thumbnail",
    response_class=FileResponse,
    responses={404: {"description": "No still for this file"}},
)
def get_asset_thumbnail(asset_id: str, request: Request, session: DatabaseSession):
    asset = _asset(session, asset_id)
    folder = storage.library_dir(request.app.state.settings)
    kind, file, mime = asset.kind, asset.file, asset.mime
    session.rollback()
    still = folder / thumbnail_name(file)
    if still.is_file():
        return _serve(still, "image/jpeg")
    if kind == "image":
        return _serve(folder / file, mime)  # No still was made: the picture itself.
    raise error(404, "library_item_not_found", "This file has no still.")


@router.get(
    "/assets/{asset_id}/waveform",
    response_class=FileResponse,
    responses={404: {"description": "Not audio, or it could not be drawn"}},
)
def get_asset_waveform(asset_id: str, request: Request, session: DatabaseSession):
    """The sound of an audio file drawn as a wide, see-through PNG."""
    asset = _asset(session, asset_id)
    settings = request.app.state.settings
    folder = storage.library_dir(settings)
    kind, file = asset.kind, asset.file
    session.rollback()
    drawing = folder / waveform_name(file)
    if kind == "audio" and not drawing.is_file():
        # Drawn the first time it is asked for, then kept.
        ffmpeg = find_ffmpeg(settings)
        if ffmpeg:
            waveform(ffmpeg, folder / file, drawing)
    if kind != "audio" or not drawing.is_file():
        raise error(404, "library_item_not_found", "This file has no waveform.")
    return _serve(drawing, "image/png")


@router.delete(
    "/assets/{asset_id}",
    status_code=204,
    response_class=Response,
    responses={404: {"description": "Not in the library"}},
)
def delete_asset(asset_id: str, request: Request, session: DatabaseSession):
    """Remove an uploaded file. Projects that took a copy keep their copy."""
    asset = _asset(session, asset_id)
    folder = storage.library_dir(request.app.state.settings)
    file = asset.file
    try:
        session.delete(asset)
        session.commit()
    except Exception:
        session.rollback()
        raise
    for name in (file, thumbnail_name(file), waveform_name(file)):
        (folder / name).unlink(missing_ok=True)
    return Response(status_code=204)
