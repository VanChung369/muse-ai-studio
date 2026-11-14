import os
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.models import Account, Project, Scene, Task
from app.rendering import storage
from app.rendering.ffmpeg import find_ffmpeg, frame_at, thumbnail
from app.rendering.tasks import (
    RenderRequestError,
    cancel_render,
    restart_render,
    resume_render,
    start_render,
    sync_project,
    usable_accounts,
)
from app.schemas.project import MAX_SCENES, ProjectStatus
from app.schemas.task import TaskResponse
from app.tasks.kinds import MERGE_VIDEO, RENDER_KINDS

router = APIRouter(prefix="/projects", tags=["Render"])
DatabaseSession = Annotated[Session, Depends(get_session)]

MESSAGES = {
    "project_not_found": "Project not found.",
    "render_not_ready": "Only a project with a saved script that has not been rendered can start.",
    "account_unavailable": "No enabled account with a verified session is available.",
    "render_not_active": "Nothing is rendering for this project.",
    "render_not_resumable": "This project has no stopped render to continue.",
    "confirm_required": "A scene may already have been sent to Muse. Confirm to send it again.",
    "render_not_restartable": "Only a finished or stopped render can be redone, starting at a scene whose earlier scenes all have clips.",
}


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True)


class SceneRender(CamelModel):
    number: int
    title: str
    duration_seconds: int
    # Null until the scene has a clip.
    video_url: str | None
    # A still of the clip, for posters and lists.
    thumbnail_url: str | None
    # Null until a render has been started.
    task: TaskResponse | None


class RenderResponse(CamelModel):
    project_id: str
    status: ProjectStatus
    scene_count: int
    completed_scenes: int
    scenes: list[SceneRender]
    # The final merge step; null until a render has been started.
    merge: TaskResponse | None
    video_url: str | None
    # Enabled accounts with a verified session, picked automatically.
    usable_accounts: int


class RenderResume(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, extra="forbid")
    # Required when a scene was interrupted: it may already exist upstream.
    confirm_duplicate: bool = Field(default=False, strict=True)


def request_error(error: RenderRequestError) -> HTTPException:
    return HTTPException(
        error.status,
        detail={"code": error.code, "message": MESSAGES.get(error.code, error.code)},
    )


def not_found(code: str = "project_not_found") -> HTTPException:
    return HTTPException(
        404, detail={"code": code, "message": MESSAGES.get(code, "Not found.")}
    )


def _version(moment) -> str:
    # Changes when a clip is rendered again, so players do not show a cached one.
    return f"?v={int(moment.timestamp())}" if moment else ""


def render_response(session: Session, project_id: str) -> RenderResponse:
    project = session.get(Project, project_id)
    if project is None:
        raise not_found()
    rows = session.execute(
        select(Task, Account.label)
        .outerjoin(Account, Account.id == Task.account_id)
        .where(Task.project_id == project_id, Task.kind.in_(RENDER_KINDS))
        .order_by(Task.created_at, Task.id)
    ).all()
    by_scene: dict[int | None, TaskResponse] = {}
    for task, label in rows:
        key = None if task.kind == MERGE_VIDEO else task.scene_number
        by_scene[key] = TaskResponse.from_task(task, label)
    base = f"/api/projects/{project_id}"
    return RenderResponse(
        project_id=project.id,
        status=project.status,
        scene_count=project.scene_count,
        completed_scenes=project.completed_scenes,
        scenes=[
            SceneRender(
                number=scene.number,
                title=scene.title,
                duration_seconds=scene.duration_seconds,
                video_url=(
                    f"{base}/scenes/{scene.number}/video{_version(scene.rendered_at)}"
                    if scene.video_file
                    else None
                ),
                thumbnail_url=(
                    f"{base}/scenes/{scene.number}/thumbnail{_version(scene.rendered_at)}"
                    if scene.video_file
                    else None
                ),
                task=by_scene.get(scene.number),
            )
            for scene in project.scenes
        ],
        merge=by_scene.get(None),
        video_url=(
            f"{base}/video{_version(project.rendered_at)}"
            if project.video_file
            else None
        ),
        usable_accounts=usable_accounts(session),
    )


@router.get(
    "/{project_id}/render",
    response_model=RenderResponse,
    responses={404: {"description": "Project not found"}},
)
def get_render(project_id: str, session: DatabaseSession) -> RenderResponse:
    return render_response(session, project_id)


@router.post(
    "/{project_id}/render",
    response_model=RenderResponse,
    status_code=202,
    responses={
        404: {"description": "Project not found"},
        409: {"description": "Not ready to render, or no usable account"},
    },
)
def start_project_render(
    project_id: str, request: Request, session: DatabaseSession
) -> RenderResponse:
    """Render every scene in order, then merge them into one video."""
    try:
        start_render(session, project_id)
    except RenderRequestError as error:
        raise request_error(error) from None
    request.app.state.task_coordinator.wake()
    return render_response(session, project_id)


@router.post(
    "/{project_id}/render/cancel",
    response_model=RenderResponse,
    responses={
        404: {"description": "Project not found"},
        409: {"description": "Nothing is rendering"},
    },
)
def cancel_project_render(
    project_id: str, request: Request, session: DatabaseSession
) -> RenderResponse:
    """Waiting scenes stop now, the running one after its current step.
    Finished scenes are kept."""
    try:
        running = cancel_render(session, project_id)
    except RenderRequestError as error:
        raise request_error(error) from None
    sync_project(session, project_id)
    coordinator = request.app.state.task_coordinator
    for task_id in running:
        coordinator.notify_cancel(task_id)
    coordinator.wake()
    return render_response(session, project_id)


@router.post(
    "/{project_id}/render/resume",
    response_model=RenderResponse,
    responses={
        404: {"description": "Project not found"},
        409: {"description": "Nothing to continue, or confirmation required"},
    },
)
def resume_project_render(
    project_id: str,
    request: Request,
    session: DatabaseSession,
    values: RenderResume | None = None,
) -> RenderResponse:
    """Continue a failed or cancelled render from the first unfinished scene."""
    try:
        resume_render(
            session,
            project_id,
            confirm_duplicate=bool(values and values.confirm_duplicate),
        )
    except RenderRequestError as error:
        raise request_error(error) from None
    sync_project(session, project_id)
    request.app.state.task_coordinator.wake()
    return render_response(session, project_id)


class RenderRestart(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, extra="forbid")
    # This scene and every later one are rendered again.
    from_scene: int = Field(strict=True, ge=1, le=MAX_SCENES)


@router.post(
    "/{project_id}/render/restart",
    response_model=RenderResponse,
    responses={
        404: {"description": "Project not found"},
        409: {"description": "Still rendering, never rendered, or no usable account"},
    },
)
def restart_project_render(
    project_id: str, values: RenderRestart, request: Request, session: DatabaseSession
) -> RenderResponse:
    """Render again from one scene to the last, keeping the earlier scenes.
    The current clips of the redone scenes and the merged video are deleted."""
    try:
        stale = restart_render(session, project_id, values.from_scene)
    except RenderRequestError as error:
        raise request_error(error) from None
    folder = storage.project_dir(request.app.state.settings, project_id)
    for name in stale:
        (folder / Path(name).name).unlink(missing_ok=True)
    request.app.state.task_coordinator.wake()
    return render_response(session, project_id)


def _file(request: Request, project_id: str, name: str | None, download: str):
    folder = storage.project_dir(request.app.state.settings, project_id)
    # Stored names are generated by the render handlers; never trust a path.
    path = folder / Path(name).name if name else None
    if path is None or not path.is_file():
        raise HTTPException(
            404, detail={"code": "media_not_found", "message": "No video yet."}
        )
    return FileResponse(
        path,
        media_type=storage.media_type(path.name),
        filename=download + path.suffix if download else None,
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get(
    "/{project_id}/scenes/{number}/video",
    response_class=FileResponse,
    responses={404: {"description": "Project or clip not found"}},
)
def get_scene_video(
    project_id: str,
    number: int,
    request: Request,
    session: DatabaseSession,
    download: bool = False,
):
    scene = session.get(Scene, (project_id, number))
    if scene is None:
        raise not_found()
    name = scene.video_file
    session.rollback()
    return _file(request, project_id, name, f"scene-{number:02d}" if download else "")


def _thumbnail(request: Request, project_id: str, clip_name: str | None):
    """The still kept next to a clip, made now if it is missing (clips rendered
    before thumbnails existed, or when FFmpeg was not installed yet)."""
    settings = request.app.state.settings
    folder = storage.project_dir(settings, project_id)
    clip = folder / Path(clip_name).name if clip_name else None
    if clip is None or not clip.is_file():
        raise HTTPException(
            404, detail={"code": "media_not_found", "message": "No video yet."}
        )
    target = folder / storage.thumbnail_file(clip.name)
    if not target.is_file():
        ffmpeg = find_ffmpeg(settings)
        if ffmpeg is None or not thumbnail(ffmpeg, clip, target):
            raise HTTPException(
                404,
                detail={
                    "code": "media_not_found",
                    "message": "No thumbnail available.",
                },
            )
    return FileResponse(
        target,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get(
    "/{project_id}/scenes/{number}/thumbnail",
    response_class=FileResponse,
    responses={404: {"description": "Project, clip or thumbnail not found"}},
)
def get_scene_thumbnail(
    project_id: str, number: int, request: Request, session: DatabaseSession
):
    scene = session.get(Scene, (project_id, number))
    if scene is None:
        raise not_found()
    name = scene.video_file
    session.rollback()
    return _thumbnail(request, project_id, name)


@router.get(
    "/{project_id}/scenes.zip",
    response_class=FileResponse,
    responses={404: {"description": "Project not found, or nothing rendered yet"}},
)
def download_scenes(project_id: str, request: Request, session: DatabaseSession):
    """Every rendered scene clip in one archive (`scene-01.mp4`, ...)."""
    project = session.get(Project, project_id)
    if project is None:
        raise not_found()
    files = [(scene.number, scene.video_file) for scene in project.scenes]
    session.rollback()
    folder = storage.project_dir(request.app.state.settings, project_id)
    clips = [
        (number, folder / Path(name).name)
        for number, name in files
        if name and (folder / Path(name).name).is_file()
    ]
    if not clips:
        raise HTTPException(
            404, detail={"code": "media_not_found", "message": "No video yet."}
        )
    handle = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    handle.close()
    # Clips are already compressed: store them as they are.
    with zipfile.ZipFile(handle.name, "w", zipfile.ZIP_STORED) as archive:
        for number, clip in clips:
            archive.write(clip, f"scene-{number:02d}{clip.suffix}")
    return FileResponse(
        handle.name,
        media_type="application/zip",
        filename="scenes.zip",
        background=BackgroundTask(os.unlink, handle.name),
    )


@router.get(
    "/{project_id}/cover",
    response_class=FileResponse,
    responses={404: {"description": "Project not found, or nothing rendered yet"}},
)
def get_project_cover(project_id: str, request: Request, session: DatabaseSession):
    """The frame the user picked as the cover, or a still of the first
    scene that has a clip."""
    if session.get(Project, project_id) is None:
        raise not_found()
    chosen = (
        storage.project_dir(request.app.state.settings, project_id)
        / storage.COVER_FILE
    )
    if chosen.is_file():
        session.rollback()
        # Its address never changes: always ask whether it did.
        return FileResponse(
            chosen, media_type="image/jpeg", headers={"Cache-Control": "no-cache"}
        )
    name = session.scalar(
        select(Scene.video_file)
        .where(Scene.project_id == project_id, Scene.video_file.is_not(None))
        .order_by(Scene.number)
        .limit(1)
    )
    session.rollback()
    return _thumbnail(request, project_id, name)


@router.get(
    "/{project_id}/video",
    response_class=FileResponse,
    responses={404: {"description": "Project or video not found"}},
)
def get_project_video(
    project_id: str, request: Request, session: DatabaseSession, download: bool = False
):
    project = session.get(Project, project_id)
    if project is None:
        raise not_found()
    name = project.video_file
    session.rollback()
    return _file(request, project_id, name, "video" if download else "")


def _cover_changed(session: Session, project_id: str) -> None:
    """The cover's address carries the project's last change, so a new
    cover is not hidden behind the copy a browser kept of the old one."""
    session.execute(
        update(Project)
        .where(Project.id == project_id)
        .values(updated_at=datetime.now(UTC))
    )
    session.commit()


class CoverRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, extra="forbid")
    # Seconds into the finished film.
    seconds: float = Field(ge=0, le=36000)


@router.post(
    "/{project_id}/cover",
    status_code=204,
    responses={
        404: {"description": "Project not found, or it has no finished film"},
        409: {"description": "FFmpeg is missing"},
        422: {"description": "No frame at that time"},
    },
)
def set_project_cover(
    project_id: str, values: CoverRequest, request: Request, session: DatabaseSession
):
    """Use the finished film's frame at `seconds` as the project's cover."""
    project = session.get(Project, project_id)
    if project is None:
        raise not_found()
    name = project.video_file
    session.rollback()
    settings = request.app.state.settings
    folder = storage.project_dir(settings, project_id)
    film = folder / Path(name).name if name else None
    if film is None or not film.is_file():
        raise HTTPException(
            404, detail={"code": "media_not_found", "message": "No video yet."}
        )
    ffmpeg = find_ffmpeg(settings)
    if ffmpeg is None:
        raise HTTPException(
            409,
            detail={"code": "ffmpeg_unavailable", "message": "FFmpeg is needed."},
        )
    if not frame_at(ffmpeg, film, values.seconds, folder / storage.COVER_FILE):
        raise HTTPException(
            422,
            detail={"code": "cover_failed", "message": "No frame at that time."},
        )
    _cover_changed(session, project_id)


@router.delete(
    "/{project_id}/cover",
    status_code=204,
    responses={404: {"description": "Project not found"}},
)
def clear_project_cover(project_id: str, request: Request, session: DatabaseSession):
    """Go back to the cover picked automatically."""
    if session.get(Project, project_id) is None:
        raise not_found()
    session.rollback()
    folder = storage.project_dir(request.app.state.settings, project_id)
    chosen = folder / storage.COVER_FILE
    if chosen.is_file():
        chosen.unlink(missing_ok=True)
        _cover_changed(session, project_id)
