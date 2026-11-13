import json
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.models import Project
from app.rendering import storage, timeline
from app.rendering.ffmpeg import MergeError, find_ffmpeg, probe
from app.rendering.tasks import remerge
from app.schemas.project import ProjectStatus

router = APIRouter(prefix="/projects", tags=["Timeline"])
DatabaseSession = Annotated[Session, Depends(get_session)]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True)


class TimelineItem(CamelModel):
    scene: int
    title: str
    # Length of the rendered clip.
    clip_seconds: float
    # The part of the clip that is kept, in seconds into it.
    start: float
    end: float
    # False leaves the scene out of the film.
    enabled: bool
    video_url: str
    thumbnail_url: str


class TimelineResponse(CamelModel):
    project_id: str
    status: ProjectStatus
    # The timeline can change once the film is finished and not being merged.
    editable: bool
    # Scenes in play order; only scenes that have a clip.
    items: list[TimelineItem]
    # Length of the film these cuts make.
    total_seconds: float


class TimelineCut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, extra="forbid")
    scene: int = Field(strict=True, ge=1, le=30)
    start: float = Field(ge=0, le=600)
    end: float = Field(gt=0, le=600)
    enabled: bool = Field(default=True, strict=True)


class TimelineUpdate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, extra="forbid")
    # Every rendered scene exactly once, in play order.
    items: list[TimelineCut] = Field(min_length=1, max_length=30)


def error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, detail={"code": code, "message": message})


def _clip_seconds(request: Request, project: Project) -> dict[int, float]:
    """Real length of every rendered clip; the script's length when FFmpeg
    is not available to measure it."""
    settings = request.app.state.settings
    ffmpeg = find_ffmpeg(settings)
    folder = storage.project_dir(settings, project.id)
    lengths = {}
    for scene in project.scenes:
        if not scene.video_file:
            continue
        lengths[scene.number] = float(scene.duration_seconds)
        if ffmpeg:
            try:
                lengths[scene.number] = round(
                    probe(ffmpeg, folder / Path(scene.video_file).name).seconds, 2
                )
            except MergeError:
                pass
    return lengths


def timeline_response(
    request: Request, session: Session, project_id: str
) -> TimelineResponse:
    project = session.get(Project, project_id)
    if project is None:
        raise error(404, "project_not_found", "Project not found.")
    lengths = _clip_seconds(request, project)
    scenes = {scene.number: scene for scene in project.scenes}
    base = f"/api/projects/{project_id}/scenes"
    items = []
    for cut in timeline.load(project):
        scene = scenes[cut.scene]
        start, end = timeline.clamp(cut, lengths[cut.scene])
        version = (
            f"?v={int(scene.rendered_at.timestamp())}" if scene.rendered_at else ""
        )
        items.append(
            TimelineItem(
                scene=cut.scene,
                title=scene.title,
                clip_seconds=lengths[cut.scene],
                start=round(start, 2),
                end=round(end, 2),
                enabled=cut.enabled,
                video_url=f"{base}/{cut.scene}/video{version}",
                thumbnail_url=f"{base}/{cut.scene}/thumbnail{version}",
            )
        )
    return TimelineResponse(
        project_id=project.id,
        status=project.status,
        editable=project.status == "completed",
        items=items,
        total_seconds=round(
            sum(item.end - item.start for item in items if item.enabled), 2
        ),
    )


@router.get(
    "/{project_id}/timeline",
    response_model=TimelineResponse,
    responses={404: {"description": "Project not found"}},
)
def get_timeline(
    project_id: str, request: Request, session: DatabaseSession
) -> TimelineResponse:
    return timeline_response(request, session, project_id)


@router.put(
    "/{project_id}/timeline",
    response_model=TimelineResponse,
    responses={
        404: {"description": "Project not found"},
        409: {"description": "The film is not finished, or FFmpeg is missing"},
        422: {"description": "The cuts do not fit the rendered clips"},
    },
)
def save_timeline(
    project_id: str,
    values: TimelineUpdate,
    request: Request,
    session: DatabaseSession,
) -> TimelineResponse:
    """Change scene order, trims and which scenes are kept, then merge the
    film again from its clips. Nothing is rendered again."""
    project = session.get(Project, project_id)
    if project is None:
        raise error(404, "project_not_found", "Project not found.")
    if project.status != "completed":
        raise error(
            409, "timeline_locked", "The timeline can change once the film is finished."
        )
    if find_ffmpeg(request.app.state.settings) is None:
        raise error(409, "ffmpeg_unavailable", "FFmpeg is needed to merge the film.")
    try:
        stored = timeline.validate(
            [item.model_dump() for item in values.items],
            _clip_seconds(request, project),
        )
    except timeline.TimelineError as problem:
        raise error(422, "invalid_timeline", str(problem)) from None
    session.rollback()  # End the read snapshot before writing (WAL).
    # Saved together with the claim on the merge: if the project moved on
    # since the check above, nothing is stored and the caller is told.
    if not remerge(session, project_id, timeline_json=json.dumps(stored)):
        raise error(
            409, "timeline_locked", "The timeline can change once the film is finished."
        )
    request.app.state.task_coordinator.wake()
    session.expire_all()
    return timeline_response(request, session, project_id)
