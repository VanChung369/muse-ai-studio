import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.models import Project
from app.rendering import storage, timeline
from app.rendering.ffmpeg import MergeError, can_caption, find_ffmpeg, probe
from app.rendering.tasks import remerge
from app.schemas.project import ProjectStatus

router = APIRouter(prefix="/projects", tags=["Timeline"])
DatabaseSession = Annotated[Session, Depends(get_session)]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True)


class TimelineItem(CamelModel):
    # Names this entry while it is edited; stable across saves.
    key: str
    # A rendered scene, or a video or picture the user added.
    kind: Literal["scene", "video", "image"]
    scene: int | None
    media_id: str | None
    title: str
    # Length of the clip; for a picture, the longest it may be shown.
    clip_seconds: float
    # The part of the clip that is kept, in seconds into it. For a picture,
    # `end` is how long it is shown.
    start: float
    end: float
    # False leaves the piece out of the film.
    enabled: bool
    # 2 plays twice as fast, so the piece takes half as long in the film.
    speed: float
    video_url: str | None
    thumbnail_url: str | None


class TimelineAudio(CamelModel):
    key: str
    media_id: str
    name: str
    clip_seconds: float
    # A drawing of the file's sound, to show on its track.
    waveform_url: str
    # Where in the film it starts.
    offset: float
    # The part of the file that is used.
    start: float
    end: float
    volume: float
    # Repeat until the film ends.
    loop: bool
    url: str


class CaptionStyle(BaseModel):
    """How captions are drawn into the picture."""

    model_config = ConfigDict(
        alias_generator=to_camel, validate_by_name=True, extra="forbid"
    )
    size: Literal["small", "medium", "large", "xlarge"] = "medium"
    # Letters and their outline, as #RRGGBB.
    color: str = Field(default="#FFFFFF", pattern=r"^#[0-9A-Fa-f]{6}$")
    outline: str = Field(default="#000000", pattern=r"^#[0-9A-Fa-f]{6}$")
    position: Literal["bottom", "middle", "top"] = "bottom"
    bold: bool = False
    # A dark box behind the words instead of an outline around them.
    box: bool = False


class TimelineCaption(CamelModel):
    # Seconds into the film.
    start: float
    end: float
    text: str


class TimelineResponse(CamelModel):
    project_id: str
    status: ProjectStatus
    # The timeline can change once the film is finished and not being merged.
    editable: bool
    # The film's picture in play order: scenes that have a clip, and added
    # videos and pictures.
    items: list[TimelineItem]
    # Audio laid over the film.
    audio: list[TimelineAudio]
    # Volume of the sound the clips came with (1 = unchanged).
    volume: float
    captions: list[TimelineCaption]
    # Draw the captions into the picture when merging.
    burn_captions: bool
    caption_style: CaptionStyle
    # False when this server's FFmpeg cannot draw captions.
    can_burn_captions: bool
    # Length of the film this edit makes.
    total_seconds: float


class Input(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, extra="forbid")


KEY = r"^[A-Za-z0-9_-]{1,40}$"


class TimelineCut(Input):
    # Exactly one of the two: a rendered scene, or an added video or picture.
    scene: int | None = Field(default=None, strict=True, ge=1, le=30)
    media_id: str | None = Field(default=None, min_length=1, max_length=36)
    key: str | None = Field(default=None, pattern=KEY)
    start: float = Field(ge=0, le=600)
    end: float = Field(gt=0, le=600)
    enabled: bool = Field(default=True, strict=True)
    speed: float = Field(default=1.0, ge=timeline.SPEEDS[0], le=timeline.SPEEDS[1])

    @model_validator(mode="after")
    def one_source(self):
        if (self.scene is None) == (self.media_id is None):
            raise ValueError("Give either a scene or an added file.")
        return self


class TimelineSound(Input):
    media_id: str = Field(min_length=1, max_length=36)
    key: str | None = Field(default=None, pattern=KEY)
    offset: float = Field(default=0.0, ge=0, le=3600)
    start: float = Field(default=0.0, ge=0, le=36000)
    end: float = Field(gt=0, le=36000)
    volume: float = Field(default=1.0, ge=0, le=2)
    loop: bool = Field(default=False, strict=True)


class TimelineCue(Input):
    start: float = Field(ge=0, le=3600)
    end: float = Field(gt=0, le=3600)
    text: str = Field(max_length=timeline.CAPTION_LENGTH)


class TimelineUpdate(Input):
    # Every rendered scene exactly once, in play order, with any added
    # videos and pictures between them.
    items: list[TimelineCut] = Field(min_length=1, max_length=timeline.MAX_ITEMS)
    audio: list[TimelineSound] = Field(
        default_factory=list, max_length=timeline.MAX_TRACKS
    )
    volume: float = Field(default=1.0, ge=0, le=2)
    captions: list[TimelineCue] = Field(
        default_factory=list, max_length=timeline.MAX_CAPTIONS
    )
    burn_captions: bool = Field(default=True, strict=True)
    caption_style: CaptionStyle = Field(default_factory=CaptionStyle)


def error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, detail={"code": code, "message": message})


@lru_cache(maxsize=4)
def _captions_supported(ffmpeg: str) -> bool:
    return can_caption(ffmpeg)


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
    media = {item.id: item for item in project.media}
    edit = timeline.load(project)
    base = f"/api/projects/{project_id}"
    items = []
    for cut in edit.cuts:
        common = {"key": cut.key, "enabled": cut.enabled}
        if cut.media is None:
            scene = scenes[cut.scene]
            start, end = timeline.clamp(cut, lengths[cut.scene])
            version = (
                f"?v={int(scene.rendered_at.timestamp())}" if scene.rendered_at else ""
            )
            items.append(
                TimelineItem(
                    kind="scene",
                    scene=cut.scene,
                    media_id=None,
                    title=scene.title,
                    clip_seconds=lengths[cut.scene],
                    start=round(start, 2),
                    end=round(end, 2),
                    speed=cut.speed,
                    video_url=f"{base}/scenes/{cut.scene}/video{version}",
                    thumbnail_url=f"{base}/scenes/{cut.scene}/thumbnail{version}",
                    **common,
                )
            )
            continue
        file = media[cut.media]
        if file.kind == "image":
            length = timeline.STILL_LIMIT
            start = 0.0
            end = min(cut.end or timeline.STILL_SECONDS, length)
        else:
            length = round(file.seconds or 0.0, 2)
            start, end = timeline.clamp(cut, length)
        items.append(
            TimelineItem(
                kind=file.kind,
                scene=None,
                media_id=file.id,
                title=file.name,
                clip_seconds=length,
                start=round(start, 2),
                end=round(end, 2),
                speed=1.0 if file.kind == "image" else cut.speed,
                video_url=None if file.kind == "image" else f"{base}/media/{file.id}",
                thumbnail_url=f"{base}/media/{file.id}/thumbnail",
                **common,
            )
        )
    audio = []
    for track in edit.tracks:
        file = media[track.media]
        length = round(file.seconds or 0.0, 2)
        end = min(track.end if track.end is not None else length, length)
        audio.append(
            TimelineAudio(
                key=track.key,
                media_id=file.id,
                name=file.name,
                clip_seconds=length,
                offset=round(track.offset, 2),
                start=round(min(track.start, end), 2),
                end=round(end, 2),
                volume=track.volume,
                loop=track.loop,
                url=f"{base}/media/{file.id}",
                waveform_url=f"{base}/media/{file.id}/waveform",
            )
        )
    ffmpeg = find_ffmpeg(request.app.state.settings)
    return TimelineResponse(
        project_id=project.id,
        status=project.status,
        editable=project.status == "completed",
        items=items,
        audio=audio,
        volume=edit.volume,
        captions=[
            TimelineCaption(start=cue.start, end=cue.end, text=cue.text)
            for cue in edit.captions
        ],
        burn_captions=edit.burn_captions,
        caption_style=CaptionStyle(**edit.caption_style),
        can_burn_captions=bool(ffmpeg) and _captions_supported(ffmpeg),
        total_seconds=round(
            sum(
                timeline.film_seconds(item.start, item.end, item.speed)
                for item in items
                if item.enabled
            ),
            2,
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
        409: {
            "description": "The film is not finished, FFmpeg is missing, or it "
            "cannot draw captions"
        },
        422: {"description": "The edit does not fit the clips and files"},
    },
)
def save_timeline(
    project_id: str,
    values: TimelineUpdate,
    request: Request,
    session: DatabaseSession,
) -> TimelineResponse:
    """Change the film's edit (order, trims, speed, left-out pieces, added
    videos and pictures, the soundtrack, captions), then merge the film again
    from its clips. Nothing is rendered again."""
    project = session.get(Project, project_id)
    if project is None:
        raise error(404, "project_not_found", "Project not found.")
    if project.status != "completed":
        raise error(
            409, "timeline_locked", "The timeline can change once the film is finished."
        )
    ffmpeg = find_ffmpeg(request.app.state.settings)
    if ffmpeg is None:
        raise error(409, "ffmpeg_unavailable", "FFmpeg is needed to merge the film.")
    try:
        stored = timeline.validate(
            values.model_dump(),
            _clip_seconds(request, project),
            {item.id: (item.kind, item.seconds) for item in project.media},
        )
    except timeline.TimelineError as problem:
        raise error(422, "invalid_timeline", str(problem)) from None
    captions = stored["captions"]
    if captions["cues"] and captions["burn"] and not _captions_supported(ffmpeg):
        raise error(
            409,
            "captions_unavailable",
            "This server's FFmpeg cannot draw captions into the picture.",
        )
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
