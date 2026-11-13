from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Media(Base):
    """A file the user added to a film from outside its script: a video or a
    picture to cut in between scenes, or audio for the soundtrack."""

    __tablename__ = "project_media"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    # "video", "image" or "audio".
    kind: Mapped[str] = mapped_column(String(10))
    # The name the user's file had; shown in the interface only.
    name: Mapped[str] = mapped_column(String(200))
    # File name inside the project's media folder (generated).
    file: Mapped[str] = mapped_column(String(80))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column()
    # Length; None for a picture.
    seconds: Mapped[float | None] = mapped_column(Float)
    # Frame size; None for audio.
    width: Mapped[int | None] = mapped_column()
    height: Mapped[int | None] = mapped_column()
    # "upload", or "muse" for audio Muse generated.
    source: Mapped[str] = mapped_column(String(10), default="upload")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC).replace(tzinfo=None)
    )
