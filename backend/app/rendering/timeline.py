"""The edit applied when a film is merged: scene order, trims, and which
scenes are left out. It never changes the script or the rendered clips, so
applying it only needs another merge.
"""

import json
from dataclasses import dataclass

from app.models import Project

# The shortest piece of a clip that may be kept.
MIN_SECONDS = 0.5


@dataclass(frozen=True)
class Cut:
    scene: int
    # Seconds into the clip. `end` None means "to the clip's end".
    start: float = 0.0
    end: float | None = None
    enabled: bool = True


class TimelineError(ValueError):
    pass


def load(project: Project) -> list[Cut]:
    """The film's cuts in play order, covering every scene that has a clip.

    Scenes the saved timeline does not mention (rendered later) follow in
    script order; entries for scenes that no longer have a clip are dropped.
    """
    rendered = [scene.number for scene in project.scenes if scene.video_file]
    saved = json.loads(project.timeline_json) if project.timeline_json else []
    cuts, seen = [], set()
    for item in saved:
        number = item.get("scene")
        if number in rendered and number not in seen:
            seen.add(number)
            cuts.append(
                Cut(
                    scene=number,
                    start=float(item.get("start") or 0.0),
                    end=item.get("end"),
                    enabled=bool(item.get("enabled", True)),
                )
            )
    cuts += [Cut(scene=number) for number in rendered if number not in seen]
    return cuts


def clamp(cut: Cut, clip_seconds: float) -> tuple[float, float]:
    """The cut's start and end inside a clip of this length (a clip rendered
    again can be shorter than the one the cut was made on)."""
    end = min(cut.end if cut.end is not None else clip_seconds, clip_seconds)
    start = max(0.0, min(cut.start, end - MIN_SECONDS))
    return start, max(end, min(clip_seconds, start + MIN_SECONDS))


def validate(items: list[dict], clip_seconds: dict[int, float]) -> list[dict]:
    """Check a timeline sent by the editor against the clips that exist and
    return what to store. Every rendered scene must appear exactly once, so
    the order is complete."""
    numbers = [item["scene"] for item in items]
    if sorted(numbers) != sorted(clip_seconds):
        raise TimelineError("List every rendered scene exactly once.")
    if not any(item["enabled"] for item in items):
        raise TimelineError("Keep at least one scene in the film.")
    stored = []
    for item in items:
        length = clip_seconds[item["scene"]]
        # A little slack: the editor works with rounded lengths.
        if item["end"] > length + 0.11:
            raise TimelineError("A scene cannot end after its clip does.")
        end = min(item["end"], length)
        if end - item["start"] < MIN_SECONDS - 1e-6:
            raise TimelineError("Keep at least half a second of each scene.")
        whole = item["start"] < 0.01 and end > length - 0.01
        stored.append(
            {
                "scene": item["scene"],
                "start": 0.0 if whole else round(item["start"], 3),
                # Null keeps following the clip if it is rendered again.
                "end": None if whole or end > length - 0.01 else round(end, 3),
                "enabled": item["enabled"],
            }
        )
    return stored
