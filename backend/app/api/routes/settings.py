"""The Settings page: what the user may change, and what the server runs with."""

import os
import re
import shutil
import subprocess
import tomllib
from functools import lru_cache
from pathlib import Path
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Request
from pydantic import ConfigDict, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.core.config import BACKEND_DIR
from app.integrations.muse.chat import find_browser
from app.rendering import storage
from app.rendering.ffmpeg import can_caption, find_ffmpeg
from app.repositories import app_settings
from app.schemas.project import (
    MAX_DURATION,
    AspectRatio,
    ProjectContinuity,
    ProjectLanguage,
    ProjectLook,
)
from app.schemas.task import CamelModel

router = APIRouter(tags=["Settings"])
DatabaseSession = Annotated[Session, Depends(get_session)]


class ProjectDefaults(CamelModel):
    model_config = ConfigDict(extra="forbid")

    duration_seconds: int = Field(strict=True, ge=10, le=MAX_DURATION, multiple_of=5)
    aspect_ratio: AspectRatio
    language: ProjectLanguage
    look: ProjectLook
    continuity: ProjectContinuity


class SettingsResponse(CamelModel):
    project_defaults: ProjectDefaults
    public_url: str | None


class SettingsUpdate(CamelModel):
    model_config = ConfigDict(extra="forbid")

    # Left out: unchanged. `projectDefaults` is always given whole.
    project_defaults: ProjectDefaults | None = None
    # Null or empty: back to using each request's own address.
    public_url: str | None = Field(default=None, max_length=200)

    @field_validator("public_url")
    @classmethod
    def clean_address(cls, value):
        value = (value or "").strip().rstrip("/")
        if not value:
            return None
        parts = urlsplit(value)
        try:
            parts.port
        except ValueError:
            raise ValueError("Enter an address such as https://studio.example.com.") from None
        if (
            parts.scheme not in ("http", "https")
            or not parts.hostname
            or parts.username
            or parts.query
            or parts.fragment
            or re.search(r"\s", value)
        ):
            raise ValueError("Enter an address such as https://studio.example.com.")
        return value


def respond(values: dict) -> SettingsResponse:
    return SettingsResponse(
        project_defaults=ProjectDefaults.model_validate(values["projectDefaults"]),
        public_url=values["publicUrl"],
    )


@router.get("/settings", response_model=SettingsResponse)
def get_settings(session: DatabaseSession) -> SettingsResponse:
    return respond(app_settings.read(session))


@router.patch("/settings", response_model=SettingsResponse)
def update_settings(values: SettingsUpdate, session: DatabaseSession) -> SettingsResponse:
    changes = {}
    if values.project_defaults is not None:
        changes["projectDefaults"] = values.project_defaults.model_dump(by_alias=True)
    if "public_url" in values.model_fields_set:
        changes["publicUrl"] = values.public_url
    return respond(app_settings.write(session, changes))


class FfmpegStatus(CamelModel):
    # None: no FFmpeg was found (films cannot be merged).
    path: str | None
    version: str | None
    # Whether it can draw captions and titles (needs libass).
    captions: bool


class StorageStatus(CamelModel):
    database_bytes: int
    # Scene clips, finished films and files added to projects.
    projects_bytes: int
    library_bytes: int
    free_bytes: int


class Limits(CamelModel):
    task_workers: int
    browser_slots: int
    planning_timeout: int
    render_timeout: int
    thread_scene_limit: int
    session_refresh_minutes: int
    session_refresh_wake: bool


class SystemResponse(CamelModel):
    version: str
    data_dir: str
    database_revision: str | None
    ffmpeg: FfmpegStatus
    # The Chromium the app drives Muse with; None when there is none.
    browser_path: str | None
    storage: StorageStatus
    # Set in the environment (MUSE_…) and read when the server starts.
    limits: Limits


@lru_cache(maxsize=1)
def app_version() -> str:
    try:
        with (BACKEND_DIR / "pyproject.toml").open("rb") as file:
            return str(tomllib.load(file)["project"]["version"])
    except (OSError, KeyError, tomllib.TOMLDecodeError):
        return "unknown"


@lru_cache(maxsize=4)
def ffmpeg_status(path: str) -> tuple[str | None, bool]:
    """Version and caption support of this binary (asked once per path)."""
    try:
        banner = subprocess.run(  # noqa: S603 - fixed arguments, no shell
            [path, "-version"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=30,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None, False
    found = re.match(r"ffmpeg version (\S+)", banner)
    return (found.group(1) if found else None), can_caption(path)


def folder_bytes(folder: Path) -> int:
    total = 0
    try:
        for entry in os.scandir(folder):
            try:
                if entry.is_dir(follow_symlinks=False):
                    total += folder_bytes(Path(entry.path))
                else:
                    total += entry.stat(follow_symlinks=False).st_size
            except OSError:
                continue  # Removed while it was being counted.
    except OSError:
        return total
    return total


@router.get("/system", response_model=SystemResponse)
def system_status(request: Request, session: DatabaseSession) -> SystemResponse:
    settings = request.app.state.settings
    revision = session.execute(text("SELECT version_num FROM alembic_version")).scalar()
    session.rollback()
    ffmpeg = find_ffmpeg(settings)
    version, captions = ffmpeg_status(ffmpeg) if ffmpeg else (None, False)
    data = settings.data_dir
    library = storage.library_dir(settings)
    database = sum(
        file.stat().st_size for file in data.glob(settings.database_path.name + "*") if file.is_file()
    )
    # Everything in the data folder that is not the library or the database
    # belongs to projects (clips, films, added media, reference files).
    everything = folder_bytes(data)
    library_size = folder_bytes(library)
    loose = sum(file.stat().st_size for file in data.iterdir() if file.is_file())
    return SystemResponse(
        version=app_version(),
        data_dir=str(data),
        database_revision=revision,
        ffmpeg=FfmpegStatus(path=ffmpeg, version=version, captions=captions),
        browser_path=find_browser(settings.browser_path),
        storage=StorageStatus(
            database_bytes=database,
            projects_bytes=max(everything - library_size - loose, 0),
            library_bytes=library_size,
            free_bytes=shutil.disk_usage(data).free,
        ),
        limits=Limits(
            task_workers=settings.task_workers,
            browser_slots=settings.browser_slots,
            planning_timeout=settings.planning_timeout,
            render_timeout=settings.render_timeout,
            thread_scene_limit=settings.thread_scene_limit,
            session_refresh_minutes=settings.session_refresh_minutes,
            session_refresh_wake=settings.session_refresh_wake,
        ),
    )
