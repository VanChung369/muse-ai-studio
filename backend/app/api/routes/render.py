from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.models import Account, Project, Scene, Task
from app.rendering import storage
from app.rendering.tasks import (
    RenderRequestError,
    cancel_render,
    resume_render,
    start_render,
    sync_project,
    usable_accounts,
)
from app.schemas.project import ProjectStatus
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
}


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True)


class SceneRender(CamelModel):
    number: int
    title: str
    duration_seconds: int
    # Null until the scene has a clip.
    video_url: str | None
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
            session, project_id, confirm_duplicate=bool(values and values.confirm_duplicate)
        )
    except RenderRequestError as error:
        raise request_error(error) from None
    sync_project(session, project_id)
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
