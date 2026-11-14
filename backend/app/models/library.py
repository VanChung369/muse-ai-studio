from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LibraryAsset(Base):
    """A picture, video or audio file uploaded to the library: kept for any
    project to take a copy of, and belonging to none."""

    __tablename__ = "library_assets"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    # "video", "image" or "audio".
    kind: Mapped[str] = mapped_column(String(10), index=True)
    source: Mapped[str] = mapped_column(
        String(10), default="upload", server_default="upload"
    )
    # The name the user's file had; shown in the interface only.
    name: Mapped[str] = mapped_column(String(200))
    # File name inside the library folder (generated).
    file: Mapped[str] = mapped_column(String(80))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column()
    # Length; None for a picture.
    seconds: Mapped[float | None] = mapped_column(Float)
    # Frame size; None for audio.
    width: Mapped[int | None] = mapped_column()
    height: Mapped[int | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC).replace(tzinfo=None)
    )
