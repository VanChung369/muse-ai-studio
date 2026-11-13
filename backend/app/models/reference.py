from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Reference(Base):
    """A file the user gave as reference material for a film: a picture or a
    video of a character, product, location or look to keep consistent."""

    __tablename__ = "project_references"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    # The name the user's file had; shown in the interface only.
    name: Mapped[str] = mapped_column(String(200))
    # File name inside the project's references folder (generated).
    file: Mapped[str] = mapped_column(String(80))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC).replace(tzinfo=None)
    )
