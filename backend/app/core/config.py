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
        return value.resolve() if value.is_absolute() else (PROJECT_DIR / value).resolve()

    @property
    def database_path(self) -> Path:
        return self.data_dir / "muse-ai-studio.db"
