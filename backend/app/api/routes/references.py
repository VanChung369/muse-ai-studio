import os
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.models import Project, Reference
from app.rendering import storage
from app.schemas.project import ProjectReference

router = APIRouter(prefix="/projects", tags=["Reference material"])
DatabaseSession = Annotated[Session, Depends(get_session)]

MAX_FILES = 6
MAX_BYTES = 50 * 1024 * 1024
# What the Muse composer accepts as a chat upload: pictures and videos.
EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}


def error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, detail={"code": code, "message": message})


def _project(session: Session, project_id: str, *, changing: bool = False) -> Project:
    if changing:
        session.execute(
            text("UPDATE projects SET status = status WHERE id = :id"),
            {"id": project_id},
        )
    project = session.get(Project, project_id, populate_existing=changing)
    if project is None:
        raise error(404, "project_not_found", "Project not found.")
    if changing and project.status in ("rendering", "cancelling"):
        raise error(
            409,
            "project_busy",
            "This project is rendering. Wait or cancel the render first.",
        )
    return project


@router.get(
    "/{project_id}/references",
    response_model=list[ProjectReference],
    responses={404: {"description": "Project not found"}},
)
def list_references(project_id: str, session: DatabaseSession):
    return _project(session, project_id).references


@router.post(
    "/{project_id}/references",
    response_model=ProjectReference,
    status_code=201,
    responses={
        404: {"description": "Project not found"},
        409: {
            "description": "Rendering, or the project already has the most files allowed"
        },
        413: {"description": "File too large"},
        415: {"description": "Not a supported picture or video"},
    },
)
async def add_reference(
    project_id: str,
    request: Request,
    session: DatabaseSession,
    name: Annotated[str, Query(min_length=1, max_length=200)],
):
    """Upload one file as the raw request body, with its type in Content-Type
    and its original name in `name`."""
    mime = (request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    extension = EXTENSIONS.get(mime)
    if extension is None:
        raise error(415, "unsupported_file", "Upload a picture or a video.")
    _project(session, project_id, changing=True)
    count = session.scalar(
        select(func.count())
        .select_from(Reference)
        .where(Reference.project_id == project_id)
    )
    session.rollback()  # No transaction is held while the upload streams in.
    if count >= MAX_FILES:
        raise error(
            409, "too_many_files", f"A project can have {MAX_FILES} reference files."
        )

    folder = storage.references_dir(request.app.state.settings, project_id)
    folder.mkdir(parents=True, exist_ok=True)
    file = f"{uuid4().hex}{extension}"
    temporary = folder / (file + ".part")
    size = 0
    try:
        with temporary.open("wb") as target:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise error(
                        413, "file_too_large", "A reference file can be 50 MB at most."
                    )
                target.write(chunk)
        if size == 0:
            raise error(422, "empty_file", "The file is empty.")
        os.replace(temporary, folder / file)
    finally:
        temporary.unlink(missing_ok=True)

    reference = Reference(
        project_id=project_id,
        # Only the base name: a path in the name must never reach the disk.
        name=Path(name.replace("\\", "/")).name[:200] or file,
        file=file,
        mime=mime,
        size=size,
    )
    try:
        _project(session, project_id, changing=True)
        session.add(reference)
        session.flush()
        # Counted again now that this request holds the write lock: uploads
        # that streamed in at the same time cannot all slip past the limit.
        count = session.scalar(
            select(func.count())
            .select_from(Reference)
            .where(Reference.project_id == project_id)
        )
        if count > MAX_FILES:
            raise error(
                409,
                "too_many_files",
                f"A project can have {MAX_FILES} reference files.",
            )
        _restart_conversation(session, project_id)
        session.commit()
        session.refresh(reference)
    except Exception:
        session.rollback()
        (folder / file).unlink(missing_ok=True)
        raise
    return reference


def _restart_conversation(session: Session, project_id: str) -> None:
    """Reference files go out with the first message of a Muse conversation.
    When they change, the project's next message starts a new conversation,
    so the files Muse sees are the ones the project has now."""
    session.execute(
        update(Project)
        .where(Project.id == project_id)
        .values(
            muse_thread_path=None, muse_thread_account_id=None, muse_thread_scenes=0
        )
        .execution_options(synchronize_session=False)
    )


def _reference(session: Session, project_id: str, reference_id: str) -> Reference:
    reference = session.get(Reference, reference_id)
    if reference is None or reference.project_id != project_id:
        raise error(404, "reference_not_found", "Reference file not found.")
    return reference


@router.get(
    "/{project_id}/references/{reference_id}",
    response_class=FileResponse,
    responses={404: {"description": "Project or file not found"}},
)
def get_reference(
    project_id: str, reference_id: str, request: Request, session: DatabaseSession
):
    reference = _reference(session, project_id, reference_id)
    path = (
        storage.references_dir(request.app.state.settings, project_id) / reference.file
    )
    mime = reference.mime
    session.rollback()
    if not path.is_file():
        raise error(404, "reference_not_found", "Reference file not found.")
    return FileResponse(
        path,
        media_type=mime,
        headers={
            "Cache-Control": "private, max-age=3600",
            # The type was declared by the uploader: never let a browser
            # guess a different one from the bytes.
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete(
    "/{project_id}/references/{reference_id}",
    status_code=204,
    response_class=Response,
    responses={
        404: {"description": "Project or file not found"},
        409: {"description": "The project is rendering"},
    },
)
def delete_reference(
    project_id: str, reference_id: str, request: Request, session: DatabaseSession
):
    _project(session, project_id, changing=True)
    reference = _reference(session, project_id, reference_id)
    path = (
        storage.references_dir(request.app.state.settings, project_id) / reference.file
    )
    try:
        session.delete(reference)
        _restart_conversation(session, project_id)
        session.commit()
    except Exception:
        session.rollback()
        raise
    path.unlink(missing_ok=True)
    return Response(status_code=204)
