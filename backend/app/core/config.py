from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MUSE_",
        env_file=(PROJECT_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    upstream_url: str = "https://muse.ai"
    browser_path: str | None = None
    upstream_timeout: float = 12
    # Background tasks running at once (each also holds its account).
    task_workers: int = 2
    # Chromium instances at once (generation tasks + a quota check).
    browser_slots: int = 3
    planning_timeout: int = 300

    @field_validator("upstream_url")
    @classmethod
    def validate_upstream(cls, value: str) -> str:
        from urllib.parse import urlsplit

        parsed = urlsplit(value)
        if value.rstrip("/") == "https://muse.ai":
            return value.rstrip("/")
        if (
            parsed.scheme == "http"
            and parsed.hostname in ("127.0.0.1", "localhost", "::1")
            and not parsed.username
            and not parsed.query
            and not parsed.fragment
        ):
            return value.rstrip("/")
        raise ValueError("Use the Muse origin or a loopback HTTP simulation origin.")

    app_name: str = "Muse AI Studio"
    data_dir: Path = PROJECT_DIR / "data"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @field_validator("data_dir", mode="after")
    @classmethod
    def resolve_data_dir(cls, value: Path) -> Path:
        value = value.expanduser()
        return (
            value.resolve() if value.is_absolute() else (PROJECT_DIR / value).resolve()
        )

    @property
    def database_path(self) -> Path:
        return self.data_dir / "muse-ai-studio.db"
