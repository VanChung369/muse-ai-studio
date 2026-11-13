"""Where rendered clips live: data/media/projects/<project id>/."""

import os
import shutil
from pathlib import Path

from app.core.config import Settings

FINAL_FILE = "final.mp4"
EXTENSIONS = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}
MEDIA_TYPES = {extension: mime for mime, extension in EXTENSIONS.items()}


def project_dir(settings: Settings, project_id: str) -> Path:
    return settings.media_dir / "projects" / project_id


def scene_file(number: int, mime: str) -> str:
    extension = EXTENSIONS.get(mime.split(";", 1)[0].strip().lower(), ".mp4")
    return f"scene-{number:02d}{extension}"


def media_type(name: str) -> str:
    return MEDIA_TYPES.get(Path(name).suffix, "application/octet-stream")


def write(path: Path, data: bytes) -> None:
    """Write through a temporary file so a crash never leaves half a clip."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".part")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def remove_project(settings: Settings, project_id: str) -> None:
    shutil.rmtree(project_dir(settings, project_id), ignore_errors=True)
