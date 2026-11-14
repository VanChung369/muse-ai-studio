import json
import math
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.models import Project
from app.rendering import film, storage, timeline
from app.rendering.ffmpeg import (
    CaptionError,
    MergeError,
    can_caption,
    find_ffmpeg,
    probe,
)
from app.rendering.tasks import remerge
from app.schemas.project import ProjectStatus

router = APIRouter(prefix="/projects", tags=["Timeline"])
DatabaseSession = Annotated[Session, Depends(get_session)]

Effect = Literal[
    "none", "mono", "sepia", "warm", "cool", "vivid", "vintage", "blur", "vignette"
]
Zoom = Literal["none", "in", "out"]
Size = Literal["small", "medium", "large", "xlarge"]
COLOUR = r"^#[0-9A-Fa-f]{6}$"
KEY = r"^[A-Za-z0-9_-]{1,40}$"


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True)


class Both(BaseModel):
    """Read from a request and written in a response, with the same fields."""

    model_config = ConfigDict(
        alias_generator=to_camel, validate_by_name=True, extra="forbid"
    )


class TimelineItem(CamelModel):
    # Names this entry while it is edited; stable across saves.
    key: str
    # A rendered scene (a scene cut in two appears twice), or a video or
    # picture the user added.
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
    # A colour look laid over the piece.
    effect: Effect
    # A slow push in or pull out over its length.
    zoom: Zoom
    # Mirrored left to right.
    flip: bool
    # Seconds it takes to come up from black, and to go to black.
    fade_in: float
    fade_out: float
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
    fade_in: float
    fade_out: float
    url: str


class CaptionStyle(Both):
    """How captions are drawn into the picture."""

    size: Size = "medium"
    # Letters and their outline, as #RRGGBB.
    color: str = Field(default="#FFFFFF", pattern=COLOUR)
    outline: str = Field(default="#000000", pattern=COLOUR)
    position: Literal["bottom", "middle", "top"] = "bottom"
    bold: bool = False
    # A dark box behind the words instead of an outline around them.
    box: bool = False
    # Asked of the server by name; one it does not have falls back.
    font: Literal[
        "Arial", "Tahoma", "Verdana", "Times New Roman", "Georgia", "Courier New"
    ] = "Arial"


class TimelineCaption(CamelModel):
    # Seconds into the film.
    start: float
    end: float
    text: str


class TimelineTitle(Both):
    """Words placed on the picture for a while."""

    # Seconds into the film.
    start: float = Field(ge=0, le=3600)
    end: float = Field(gt=0, le=3600)
    text: str = Field(max_length=timeline.CAPTION_LENGTH)
    size: Size = "large"
    color: str = Field(default="#FFFFFF", pattern=COLOUR)
    position: Literal[
        "top-left", "top", "top-right", "left", "center", "right",
        "bottom-left", "bottom", "bottom-right",
    ] = "center"  # fmt: skip
    bold: bool = True
    box: bool = False


class TimelineLogo(CamelModel):
    """A picture of the project kept in a corner for the whole film."""

    media_id: str
    corner: Literal["top-left", "top-right", "bottom-left", "bottom-right"]
    # Width as a percentage of the frame's width.
    size: float
    opacity: float
    url: str


class TimelineOutput(Both):
    """The shape and weight of the merged file."""

    # "source" keeps the shape of the scenes.
    aspect: Literal["source", "16:9", "9:16", "1:1"] = "source"
    # In another shape, show the whole picture (bars) or fill the frame (crop).
    fit: Literal["contain", "cover"] = "contain"
    # The frame's shorter edge in pixels; 0 keeps that of the scenes.
    height: Literal[0, 480, 720, 1080] = 0
    quality: Literal["high", "medium", "small"] = "high"


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
    # Lower the added audio while the clips' own sound is heard.
    duck: bool
    captions: list[TimelineCaption]
    # Draw the captions into the picture when merging.
    burn_captions: bool
    caption_style: CaptionStyle
    titles: list[TimelineTitle]
    logo: TimelineLogo | None
    output: TimelineOutput
    # False when this server's FFmpeg cannot draw captions or titles.
    can_burn_captions: bool
    # Length of the film this edit makes.
    total_seconds: float


class Input(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, extra="forbid")


class TimelineCut(Input):
    # Exactly one of the two: a rendered scene, or an added video or picture.
    scene: int | None = Field(default=None, strict=True, ge=1, le=30)
    media_id: str | None = Field(default=None, min_length=1, max_length=36)
    key: str | None = Field(default=None, pattern=KEY)
    start: float = Field(ge=0, le=600)
    end: float = Field(gt=0, le=600)
    enabled: bool = Field(default=True, strict=True)
    speed: float = Field(default=1.0, ge=timeline.SPEEDS[0], le=timeline.SPEEDS[1])
    effect: Effect = "none"
    zoom: Zoom = "none"
    flip: bool = Field(default=False, strict=True)
    fade_in: float = Field(default=0.0, ge=0, le=timeline.MAX_CLIP_FADE)
    fade_out: float = Field(default=0.0, ge=0, le=timeline.MAX_CLIP_FADE)

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
    fade_in: float = Field(default=0.0, ge=0, le=timeline.MAX_AUDIO_FADE)
    fade_out: float = Field(default=0.0, ge=0, le=timeline.MAX_AUDIO_FADE)


class TimelineCue(Input):
    start: float = Field(ge=0, le=3600)
    end: float = Field(gt=0, le=3600)
    text: str = Field(max_length=timeline.CAPTION_LENGTH)


class LogoInput(Input):
    media_id: str = Field(min_length=1, max_length=36)
    corner: Literal["top-left", "top-right", "bottom-left", "bottom-right"] = (
        "top-right"
    )
    size: float = Field(default=14, ge=5, le=40)
    opacity: float = Field(default=1.0, ge=0.1, le=1)


class TimelineUpdate(Input):
    # Every rendered scene at least once, in play order, with any added
    # videos and pictures between them.
    items: list[TimelineCut] = Field(min_length=1, max_length=timeline.MAX_ITEMS)
    audio: list[TimelineSound] = Field(
        default_factory=list, max_length=timeline.MAX_TRACKS
    )
    volume: float = Field(default=1.0, ge=0, le=2)
    duck: bool = Field(default=False, strict=True)
    captions: list[TimelineCue] = Field(
        default_factory=list, max_length=timeline.MAX_CAPTIONS
    )
    burn_captions: bool = Field(default=True, strict=True)
    caption_style: CaptionStyle = Field(default_factory=CaptionStyle)
    titles: list[TimelineTitle] = Field(
        default_factory=list, max_length=timeline.MAX_TITLES
    )
    logo: LogoInput | None = None
    output: TimelineOutput = Field(default_factory=TimelineOutput)


class PreviewResponse(CamelModel):
    # Where to watch it; changes with every preview.
    url: str
    seconds: float


def error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, detail={"code": code, "message": message})


@lru_cache(maxsize=4)
def _captions_supported(ffmpeg: str) -> bool:
    return can_caption(ffmpeg)


def _media_seconds(seconds: float | None) -> float:
    """An added file's length as the editor is told it: rounded down, so a
    piece trimmed right up to the end is never longer than the file is
    (and then refused as shorter than the shortest piece)."""
    return math.floor((seconds or 0.0) * 100 + 1e-6) / 100


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
        common = {
            "key": cut.key,
            "enabled": cut.enabled,
            "effect": cut.effect,
            "zoom": cut.zoom,
            "flip": cut.flip,
            "fade_in": cut.fade_in,
            "fade_out": cut.fade_out,
        }
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
            length = _media_seconds(file.seconds)
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
        length = _media_seconds(file.seconds)
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
                fade_in=track.fade_in,
                fade_out=track.fade_out,
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
        duck=edit.duck,
        captions=[
            TimelineCaption(start=cue.start, end=cue.end, text=cue.text)
            for cue in edit.captions
        ],
        burn_captions=edit.burn_captions,
        caption_style=CaptionStyle(**edit.caption_style),
        titles=[
            TimelineTitle(
                start=title.start,
                end=title.end,
                text=title.text,
                size=title.size,
                color=title.color,
                position=title.position,
                bold=title.bold,
                box=title.box,
            )
            for title in edit.titles
        ],
        logo=TimelineLogo(
            media_id=edit.logo["media"],
            corner=edit.logo["corner"],
            size=edit.logo["size"],
            opacity=edit.logo["opacity"],
            url=f"{base}/media/{edit.logo['media']}",
        )
        if edit.logo
        else None,
        output=TimelineOutput(**edit.output),
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


def _checked(
    request: Request, project: Project, values: TimelineUpdate, ffmpeg: str
) -> dict:
    """The edit in the form it is stored in, or the refusal it earns."""
    try:
        stored = timeline.validate(
            values.model_dump(),
            _clip_seconds(request, project),
            {item.id: (item.kind, item.seconds) for item in project.media},
        )
    except timeline.TimelineError as problem:
        raise error(422, "invalid_timeline", str(problem)) from None
    captions = stored["captions"]
    drawn = (captions["cues"] and captions["burn"]) or stored["titles"]
    if drawn and not _captions_supported(ffmpeg):
        raise error(
            409,
            "captions_unavailable",
            "This server's FFmpeg cannot draw captions or titles into the picture.",
        )
    return stored


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
    """Change the film's edit (order, trims, speed, looks, left-out pieces,
    added videos and pictures, the soundtrack, captions, titles, the logo and
    the shape of the file), then merge the film again from its clips. Nothing
    is rendered again."""
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
    stored = _checked(request, project, values, ffmpeg)
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


# One preview at a time per project: they write the same file.
_previewing: set[str] = set()
_previewing_lock = threading.Lock()


@router.post(
    "/{project_id}/timeline/preview",
    response_model=PreviewResponse,
    responses={
        404: {"description": "Project not found"},
        409: {
            "description": "FFmpeg is missing or cannot draw captions, a scene or "
            "file is missing, or a preview is already being made"
        },
        422: {"description": "The edit does not fit, or could not be built"},
    },
)
def preview_timeline(
    project_id: str,
    values: TimelineUpdate,
    request: Request,
    session: DatabaseSession,
) -> PreviewResponse:
    """Build a small, quick version of the film this edit would make. The
    edit is not saved and the finished film is not touched."""
    project = session.get(Project, project_id)
    if project is None:
        raise error(404, "project_not_found", "Project not found.")
    settings = request.app.state.settings
    ffmpeg = find_ffmpeg(settings)
    if ffmpeg is None:
        raise error(409, "ffmpeg_unavailable", "FFmpeg is needed to build a preview.")
    stored = _checked(request, project, values, ffmpeg)
    edit = timeline.read(stored, project)
    source = film.sources(project)
    session.rollback()  # No transaction is held while FFmpeg runs.

    with _previewing_lock:
        if project_id in _previewing:
            raise error(409, "preview_busy", "A preview is already being made.")
        _previewing.add(project_id)
    output = storage.project_dir(settings, project_id) / storage.PREVIEW_FILE
    try:
        film.build(settings, ffmpeg, source, edit, output, lambda: None, preview=True)
        seconds = probe(ffmpeg, output).seconds
    except film.FilmError as problem:
        raise error(409, problem.code, "The film cannot be built right now.") from None
    except CaptionError:
        raise error(
            409, "captions_unavailable", "This server's FFmpeg cannot draw captions."
        ) from None
    except MergeError:
        raise error(422, "preview_failed", "The preview could not be built.") from None
    finally:
        with _previewing_lock:
            _previewing.discard(project_id)
    return PreviewResponse(
        url=f"/api/projects/{project_id}/timeline/preview.mp4?v={time.time_ns()}",
        seconds=round(seconds, 2),
    )


@router.get(
    "/{project_id}/timeline/preview.mp4",
    response_class=FileResponse,
    responses={404: {"description": "No preview has been made"}},
)
def get_preview(project_id: str, request: Request):
    """The latest preview made for the project."""
    path = (
        storage.project_dir(request.app.state.settings, Path(project_id).name)
        / storage.PREVIEW_FILE
    )
    if not path.is_file():
        raise error(404, "media_not_found", "No preview has been made.")
    return FileResponse(
        path, media_type="video/mp4", headers={"Cache-Control": "no-store"}
    )
