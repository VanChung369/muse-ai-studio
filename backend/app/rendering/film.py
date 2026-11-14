"""Turns a project's clips and its timeline into the film: the one place that
decides how, used for the merged film and for a preview of an edit that is
not saved yet.
"""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings
from app.models import Project
from app.rendering import storage, timeline
from app.rendering.ffmpeg import (
    Caption,
    CaptionStyle,
    Logo,
    Segment,
    Soundtrack,
    Title,
    compose,
    merge,
    output_frame,
    probe,
)


class FilmError(Exception):
    """The film cannot be built from what the project has. `code` says why."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Sources:
    """What a project has to build its film from, read in one go so no
    database session is held while FFmpeg runs."""

    project_id: str
    # Scenes without their own sound.
    mute: bool
    # Scene number -> clip file name, None for a scene not rendered.
    scenes: dict[int, str | None]
    # Added media: id -> (kind, file name).
    media: dict[str, tuple[str, str]]


def sources(project: Project) -> Sources:
    return Sources(
        project_id=project.id,
        mute=project.mute,
        scenes={scene.number: scene.video_file for scene in project.scenes},
        media={media.id: (media.kind, media.file) for media in project.media},
    )


def build(
    settings: Settings,
    ffmpeg: str,
    source: Sources,
    edit: timeline.Timeline,
    output: Path,
    check_cancelled: Callable[[], None],
    *,
    preview: bool = False,
) -> int:
    """Write the film `edit` makes to `output` and return how many pieces it
    has. `preview` makes a small, quick, rough version instead.

    Raises FilmError when a scene, a placed file or every piece is missing,
    and lets FFmpeg's own failures (MergeError, CaptionError) through.
    """
    kept = [cut for cut in edit.cuts if cut.enabled]
    folder = storage.project_dir(settings, source.project_id)
    media_folder = storage.media_dir(settings, source.project_id)
    clips = [folder / name for name in source.scenes.values() if name]
    if len(clips) != len(source.scenes) or not all(clip.is_file() for clip in clips):
        raise FilmError("scene_missing")
    if not kept:
        raise FilmError("timeline_empty")

    def look(cut: timeline.Cut) -> dict:
        return {
            "effect": cut.effect,
            "zoom": cut.zoom,
            "flip": cut.flip,
            "fade_in": cut.fade_in,
            "fade_out": cut.fade_out,
        }

    segments = [
        Segment(folder / source.scenes[cut.scene], cut.start, cut.end, cut.speed, **look(cut))
        if cut.media is None
        else Segment(
            media_folder / source.media[cut.media][1],
            cut.start,
            cut.end,
            cut.speed,
            still=source.media[cut.media][0] == "image",
            **look(cut),
        )
        for cut in kept
    ]
    soundtracks = [
        Soundtrack(
            media_folder / source.media[track.media][1],
            track.offset,
            track.start,
            track.end,
            track.volume,
            track.loop,
            track.fade_in,
            track.fade_out,
        )
        for track in edit.tracks
    ]
    logo = None
    if edit.logo:
        logo = Logo(
            media_folder / source.media[edit.logo["media"]][1],
            edit.logo["corner"],
            # Stored as a percentage of the frame's width.
            edit.logo["size"] / 100,
            edit.logo["opacity"],
        )
    placed = [*segments, *soundtracks, *([logo] if logo else [])]
    if not all(item.path.is_file() for item in placed):
        raise FilmError("media_missing")

    if edit.plain and not preview:
        # Only scenes as they were rendered: joined, without re-encoding
        # when nothing is trimmed.
        merge(
            ffmpeg,
            [segment.path for segment in segments],
            output,
            check_cancelled,
            mute=source.mute,
            cuts=[(cut.start, cut.end) for cut in kept],
        )
        return len(segments)

    # The film keeps the frame of its scenes, whatever shape an added video
    # or picture has, unless another shape or size is asked for.
    scene = probe(ffmpeg, clips[0])
    style = edit.caption_style
    compose(
        ffmpeg,
        segments,
        output,
        check_cancelled,
        mute=source.mute,
        volume=edit.volume,
        soundtracks=soundtracks,
        duck=edit.duck,
        captions=[Caption(cue.start, cue.end, cue.text) for cue in edit.captions]
        if edit.burn_captions
        else [],
        caption_style=CaptionStyle(
            size=timeline.CAPTION_SIZES.get(style["size"], 0.06),
            color=style["color"],
            outline=style["outline"],
            position=style["position"],
            bold=style["bold"],
            box=style["box"],
            font=style["font"],
        ),
        titles=[
            Title(
                title.start,
                title.end,
                title.text,
                timeline.CAPTION_SIZES.get(title.size, 0.08),
                title.color,
                title.position,
                title.bold,
                title.box,
            )
            for title in edit.titles
        ],
        logo=logo,
        frame=output_frame(
            (scene.width, scene.height), edit.output["aspect"], edit.output["height"]
        ),
        fit=edit.output["fit"],
        quality=edit.output["quality"],
        preview=preview,
    )
    return len(segments)
