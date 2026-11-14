"""What an uploaded media file must be, shared by a project's media and the
library."""

from pathlib import Path

from app.rendering.ffmpeg import MediaInfo

MAX_BYTES = 200 * 1024 * 1024
# What can be cut into a film or laid over it: type -> (kind, file extension).
TYPES = {
    "video/mp4": ("video", ".mp4"),
    "video/webm": ("video", ".webm"),
    "video/quicktime": ("video", ".mov"),
    "image/png": ("image", ".png"),
    "image/jpeg": ("image", ".jpg"),
    "image/webp": ("image", ".webp"),
    "audio/mpeg": ("audio", ".mp3"),
    "audio/mp3": ("audio", ".mp3"),
    "audio/wav": ("audio", ".wav"),
    "audio/x-wav": ("audio", ".wav"),
    "audio/wave": ("audio", ".wav"),
    "audio/mp4": ("audio", ".m4a"),
    "audio/x-m4a": ("audio", ".m4a"),
    "audio/aac": ("audio", ".aac"),
    "audio/ogg": ("audio", ".ogg"),
}


def content_type(header: str | None) -> str:
    """The media type of a Content-Type header, without its parameters."""
    return (header or "").split(";", 1)[0].strip().lower()


def base_name(name: str, fallback: str) -> str:
    """Only the base name: a path in the name must never reach the disk."""
    base = Path(name.replace("\\", "/")).name[:200]
    # "." and ".." are folders, not names.
    return base if base.strip(". ") else fallback


def waveform_name(file: str) -> str:
    """The drawing of an audio file's sound, kept next to it."""
    return Path(file).stem + ".wave.png"


def thumbnail_name(file: str) -> str:
    """The still kept next to a video or picture (never the file's own name)."""
    return Path(file).stem + ".thumb.jpg"


def readable(info: MediaInfo | None, kind: str) -> bool:
    """Whether the bytes really are what their type says: a video has a
    picture and a length, a picture a frame, audio a sound and a length."""
    return info is not None and bool(
        (kind == "video" and info.width and info.seconds)
        or (kind == "image" and info.width)
        or (kind == "audio" and info.has_audio and info.seconds)
    )
