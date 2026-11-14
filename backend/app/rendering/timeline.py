"""The edit applied when a film is merged: the order of its pieces, their
trims, speed and look, pieces left out, videos and pictures added between
scenes, audio laid over it, captions, titles, a logo, and the shape of the
file. It never changes the script or the rendered clips, so applying it only
needs another merge.
"""

import json
from dataclasses import dataclass, field

from app.models import Project

# The shortest piece of a clip that may be kept.
MIN_SECONDS = 0.5
SPEEDS = (0.25, 4.0)
# How long a picture may be shown, and for how long when nothing says.
STILL_LIMIT = 30.0
STILL_SECONDS = 3.0
MAX_ITEMS = 60
MAX_TRACKS = 8
MAX_CAPTIONS = 300
MAX_TITLES = 50
CAPTION_LENGTH = 300
# Longest fade of a piece of the picture, and of an audio piece.
MAX_CLIP_FADE = 2.0
MAX_AUDIO_FADE = 10.0
# Caption sizes: height of the letters as a share of the frame's height.
CAPTION_SIZES = {"small": 0.045, "medium": 0.06, "large": 0.08, "xlarge": 0.105}
CAPTION_STYLE = {
    "size": "medium",
    "color": "#FFFFFF",
    "outline": "#000000",
    # "bottom", "middle" or "top".
    "position": "bottom",
    "bold": False,
    # A dark box behind the words instead of an outline around them.
    "box": False,
    "font": "Arial",
}
# The shape and weight of the merged file. `height` is the frame's shorter
# edge in pixels ("720p"), 0 keeping that of the scenes.
OUTPUT = {"aspect": "source", "fit": "contain", "height": 0, "quality": "high"}
LOOK = {"effect": "none", "zoom": "none", "flip": False, "fade_in": 0.0, "fade_out": 0.0}


@dataclass(frozen=True)
class Cut:
    """One piece of the film's picture, in play order: a rendered scene (or
    part of one: a scene cut in two is two pieces), or a video or picture the
    user added."""

    # Exactly one of the two is set.
    scene: int | None = None
    media: str | None = None
    # Names this entry in the editor (a clip can be placed more than once).
    key: str = ""
    # Seconds into the clip. `end` None means "to the clip's end". For a
    # picture, `end` is how long it is shown.
    start: float = 0.0
    end: float | None = None
    enabled: bool = True
    # 2.0 plays twice as fast.
    speed: float = 1.0
    # A colour look (a key of ffmpeg.EFFECTS) or "none".
    effect: str = "none"
    # A slow push "in" or pull "out", or "none".
    zoom: str = "none"
    flip: bool = False
    # Seconds to come up from black and to go to black.
    fade_in: float = 0.0
    fade_out: float = 0.0

    @property
    def plain(self) -> bool:
        """A scene as it was rendered, apart from where it is cut."""
        return (
            self.media is None
            and self.speed == 1.0
            and all(getattr(self, name) == value for name, value in LOOK.items())
        )


@dataclass(frozen=True)
class Track:
    """Audio laid over the film."""

    media: str
    key: str = ""
    # Where in the film it starts.
    offset: float = 0.0
    start: float = 0.0
    end: float | None = None
    volume: float = 1.0
    # Repeat until the film ends.
    loop: bool = False
    fade_in: float = 0.0
    fade_out: float = 0.0


@dataclass(frozen=True)
class Caption:
    # Seconds into the film.
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class Title:
    """Words placed on the picture for a while."""

    start: float
    end: float
    text: str
    # A key of CAPTION_SIZES.
    size: str = "large"
    color: str = "#FFFFFF"
    # One of nine places, "top-left" to "bottom-right" through "center".
    position: str = "center"
    bold: bool = True
    box: bool = False


@dataclass(frozen=True)
class Timeline:
    cuts: list[Cut] = field(default_factory=list)
    tracks: list[Track] = field(default_factory=list)
    # Volume of the sound the clips came with.
    volume: float = 1.0
    # Lower the added audio while the clips' own sound is heard.
    duck: bool = False
    captions: list[Caption] = field(default_factory=list)
    # Draw the captions into the picture when merging.
    burn_captions: bool = True
    # How they are drawn: the keys of CAPTION_STYLE.
    caption_style: dict = field(default_factory=lambda: dict(CAPTION_STYLE))
    titles: list[Title] = field(default_factory=list)
    # A picture kept in a corner: {media, corner, size, opacity}, or None.
    logo: dict | None = None
    # The keys of OUTPUT.
    output: dict = field(default_factory=lambda: dict(OUTPUT))

    @property
    def plain(self) -> bool:
        """Only scenes as they were rendered, in the frame and at the volume
        they have: joining is enough."""
        return (
            not self.tracks
            and self.volume == 1.0
            and not (self.captions and self.burn_captions)
            and not self.titles
            and self.logo is None
            and self.output == OUTPUT
            and all(cut.plain for cut in self.cuts if cut.enabled)
        )


class TimelineError(ValueError):
    pass


def _stored(project: Project) -> dict:
    saved = json.loads(project.timeline_json) if project.timeline_json else {}
    # The first format was the list of scene cuts alone.
    return {"items": saved} if isinstance(saved, list) else saved


def load(project: Project) -> Timeline:
    """The film's saved edit, fitted to what the project has now."""
    return read(_stored(project), project)


def read(saved: dict, project: Project) -> Timeline:
    """An edit in its stored form (the saved one, or one `validate` just
    returned), fitted to what the project has now.

    Scenes it does not mention (rendered later) follow in script order;
    entries for scenes without a clip, or for media that was deleted, are
    dropped.
    """
    rendered = [scene.number for scene in project.scenes if scene.video_file]
    kinds = {media.id: media.kind for media in project.media}
    cuts, seen, keys = [], set(), set()
    for index, item in enumerate(saved.get("items") or []):
        number, media = item.get("scene"), item.get("media")
        values = {
            "start": float(item.get("start") or 0.0),
            "end": item.get("end"),
            "enabled": bool(item.get("enabled", True)),
            "speed": float(item.get("speed") or 1.0),
            "effect": item.get("effect") or "none",
            "zoom": item.get("zoom") or "none",
            "flip": bool(item.get("flip", False)),
            "fade_in": float(item.get("fade_in") or 0.0),
            "fade_out": float(item.get("fade_out") or 0.0),
        }
        if media is not None:
            if kinds.get(media) not in ("video", "image"):
                continue
            key = item.get("key") or f"m{index}"
        elif number in rendered:
            # The first piece of a scene keeps the scene's own name.
            key = item.get("key") or (
                f"scene-{number}" if number not in seen else f"scene-{number}-{index}"
            )
            seen.add(number)
        else:
            continue
        if key in keys:
            key = f"{key}-{index}"
        keys.add(key)
        cuts.append(Cut(scene=None if media else number, media=media, key=key, **values))
    cuts += [
        Cut(scene=number, key=f"scene-{number}")
        for number in rendered
        if number not in seen
    ]
    tracks = [
        Track(
            media=item["media"],
            key=item.get("key") or f"a{index}",
            offset=float(item.get("offset") or 0.0),
            start=float(item.get("start") or 0.0),
            end=item.get("end"),
            volume=float(item.get("volume", 1.0)),
            loop=bool(item.get("loop", False)),
            fade_in=float(item.get("fade_in") or 0.0),
            fade_out=float(item.get("fade_out") or 0.0),
        )
        for index, item in enumerate(saved.get("audio") or [])
        if kinds.get(item.get("media")) == "audio"
    ]
    captions = saved.get("captions") or {}
    logo = saved.get("logo")
    return Timeline(
        cuts=cuts,
        tracks=tracks,
        volume=float(saved.get("volume", 1.0)),
        duck=bool(saved.get("duck", False)),
        captions=[
            Caption(float(item["start"]), float(item["end"]), str(item["text"]))
            for item in captions.get("cues") or []
        ],
        burn_captions=bool(captions.get("burn", True)),
        # Saved before a key existed: that key keeps its default.
        caption_style={**CAPTION_STYLE, **(captions.get("style") or {})},
        titles=[Title(**item) for item in saved.get("titles") or []],
        # A logo whose picture was deleted is gone with it.
        logo=logo if logo and kinds.get(logo.get("media")) == "image" else None,
        output={**OUTPUT, **(saved.get("output") or {})},
    )


def uses(project: Project, media_id: str) -> bool:
    """Whether the saved timeline places this media file in the film."""
    saved = _stored(project)
    placed = [*(saved.get("items") or []), *(saved.get("audio") or [])]
    if saved.get("logo"):
        placed.append(saved["logo"])
    return any(item.get("media") == media_id for item in placed)


def clamp(cut: Cut, clip_seconds: float) -> tuple[float, float]:
    """The cut's start and end inside a clip of this length (a clip rendered
    again can be shorter than the one the cut was made on)."""
    end = min(cut.end if cut.end is not None else clip_seconds, clip_seconds)
    start = max(0.0, min(cut.start, end - MIN_SECONDS))
    return start, max(end, min(clip_seconds, start + MIN_SECONDS))


def film_seconds(start: float, end: float, speed: float) -> float:
    """How long a kept piece plays for in the film."""
    return (end - start) / speed


def _colour(value: str) -> str:
    return value.upper()


def validate(
    values: dict,
    clip_seconds: dict[int, float],
    media: dict[str, tuple[str, float | None]],
) -> dict:
    """Check a timeline sent by the editor against what exists and return
    what to store.

    `clip_seconds` is the length of every rendered scene's clip; `media` maps
    each added file's id to its kind and length. Every rendered scene must
    appear at least once (more than once when it was cut into pieces), so
    the order is complete.
    """
    items = values["items"]
    numbers = [item["scene"] for item in items if item.get("media_id") is None]
    if set(numbers) != set(clip_seconds):
        raise TimelineError("List every rendered scene, and only rendered scenes.")
    if not any(item["enabled"] for item in items):
        raise TimelineError("Keep at least one piece in the film.")
    stored_items, keys, seen = [], set(), set()
    for index, item in enumerate(items):
        media_id = item.get("media_id")
        speed = item.get("speed", 1.0)
        if media_id is None:
            number = item["scene"]
            kind, length = "scene", clip_seconds[number]
            key = item.get("key") or (
                f"scene-{number}" if number not in seen else f"scene-{number}-{index}"
            )
            seen.add(number)
        else:
            if item.get("scene") is not None:
                raise TimelineError("An entry is a scene or an added file, not both.")
            kind, length = media.get(media_id, (None, None))
            if kind not in ("video", "image"):
                raise TimelineError("Only videos and pictures go in the picture track.")
            key = item.get("key") or f"m{index}"
        if key in keys:
            raise TimelineError("Two entries share a key.")
        keys.add(key)
        if kind == "image":
            # A picture has no length of its own: `end` is how long it shows.
            length, speed, item = STILL_LIMIT, 1.0, {**item, "start": 0.0}
        if length is None:
            raise TimelineError("An added video has no known length.")
        # A little slack: the editor works with rounded lengths.
        if item["end"] > length + 0.11:
            raise TimelineError("A piece cannot end after its clip does.")
        end = min(item["end"], length)
        if end - item["start"] < MIN_SECONDS - 1e-6:
            raise TimelineError("Keep at least half a second of each piece.")
        whole = kind != "image" and item["start"] < 0.01 and end > length - 0.01
        entry = {
            "key": key,
            "start": 0.0 if whole else round(item["start"], 3),
            # Null keeps following the clip if it is rendered again.
            "end": None
            if whole or (kind != "image" and end > length - 0.01)
            else round(end, 3),
            "enabled": item["enabled"],
            "speed": round(speed, 3),
            "effect": item.get("effect", "none"),
            "zoom": item.get("zoom", "none"),
            "flip": bool(item.get("flip", False)),
            "fade_in": round(item.get("fade_in", 0.0), 2),
            "fade_out": round(item.get("fade_out", 0.0), 2),
        }
        stored_items.append(
            {"scene": item["scene"], **entry}
            if media_id is None
            else {"media": media_id, **entry}
        )

    stored_audio, keys = [], set()
    for index, track in enumerate(values.get("audio") or []):
        kind, length = media.get(track["media_id"], (None, None))
        if kind != "audio" or length is None:
            raise TimelineError("Only audio files go in the audio track.")
        if track["end"] > length + 0.11:
            raise TimelineError("An audio piece cannot end after its file does.")
        end = min(track["end"], length)
        if end - track["start"] < MIN_SECONDS - 1e-6:
            raise TimelineError("Keep at least half a second of each audio file.")
        key = track.get("key") or f"a{index}"
        if key in keys:
            raise TimelineError("Two entries share a key.")
        keys.add(key)
        stored_audio.append(
            {
                "media": track["media_id"],
                "key": key,
                "offset": round(track["offset"], 3),
                "start": round(track["start"], 3),
                "end": None if end > length - 0.01 else round(end, 3),
                "volume": round(track["volume"], 3),
                "loop": track["loop"],
                "fade_in": round(track.get("fade_in", 0.0), 2),
                "fade_out": round(track.get("fade_out", 0.0), 2),
            }
        )

    def shown(entries: list[dict], what: str) -> list[dict]:
        """Timed words with text, in time order."""
        kept = []
        for entry in entries:
            text = "\n".join(
                line.strip() for line in entry["text"].splitlines() if line.strip()
            )
            if not text:
                continue
            if entry["end"] - entry["start"] < 0.2:
                raise TimelineError(f"A {what} must stay on screen for a moment.")
            kept.append(
                {
                    **entry,
                    "start": round(entry["start"], 3),
                    "end": round(entry["end"], 3),
                    "text": text,
                }
            )
        return sorted(kept, key=lambda entry: entry["start"])

    logo = values.get("logo")
    if logo is not None:
        if media.get(logo["media_id"], (None, None))[0] != "image":
            raise TimelineError("The logo must be a picture of this project.")
        logo = {
            "media": logo["media_id"],
            "corner": logo["corner"],
            "size": round(logo["size"], 1),
            "opacity": round(logo["opacity"], 2),
        }
    style = values.get("caption_style") or {}
    return {
        "items": stored_items,
        "audio": stored_audio,
        "volume": round(values.get("volume", 1.0), 3),
        "duck": bool(values.get("duck", False)),
        "captions": {
            "burn": bool(values.get("burn_captions", True)),
            "cues": shown(values.get("captions") or [], "caption"),
            "style": {
                **CAPTION_STYLE,
                **{
                    name: _colour(value) if name in ("color", "outline") else value
                    for name, value in style.items()
                    if name in CAPTION_STYLE
                },
            },
        },
        "titles": [
            {**title, "color": _colour(title["color"])}
            for title in shown(values.get("titles") or [], "title")
        ],
        "logo": logo,
        "output": {**OUTPUT, **(values.get("output") or {})},
    }
