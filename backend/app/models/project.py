from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.core.text import normalize_search_text
from app.db.base import Base
from app.models.scene import Scene


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="ck_projects_name"),
        CheckConstraint("length(idea) <= 12000", name="ck_projects_idea"),
        CheckConstraint(
            "duration_seconds BETWEEN 10 AND 300 AND duration_seconds % 5 = 0",
            name="ck_projects_duration",
        ),
        CheckConstraint(
            "aspect_ratio IN ('16:9', '9:16', '1:1')", name="ck_projects_ratio"
        ),
        CheckConstraint(
            "status IN ('draft', 'planning', 'ready', 'rendering', 'cancelling', 'cancelled', 'failed', 'completed')",
            name="ck_projects_status",
        ),
        CheckConstraint(
            "length(character_bible) <= 10000", name="ck_projects_character_bible"
        ),
        CheckConstraint(
            "length(visual_style) <= 3000", name="ck_projects_visual_style"
        ),
        CheckConstraint("script_revision >= 0", name="ck_projects_script_revision"),
        CheckConstraint("scene_count BETWEEN 0 AND 30", name="ck_projects_scene_count"),
        CheckConstraint(
            "look IN ('auto', 'realistic', 'cinematic', 'documentary', 'commercial', 'animation3d', 'anime')",
            name="ck_projects_look",
        ),
        CheckConstraint(
            "continuity IN ('off', 'reference', 'seamless')",
            name="ck_projects_continuity",
        ),
        # Keyset pagination orders (see app/repositories/projects.py).
        Index("ix_projects_updated", "updated_at", "id"),
        Index("ix_projects_name_key", "name_key", "id"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    name: Mapped[str] = mapped_column(String(100))
    # Lowercase, accent-free copy of `name` for search and name sorting.
    name_key: Mapped[str] = mapped_column(String(200))
    idea: Mapped[str] = mapped_column(Text, default="")
    aspect_ratio: Mapped[str] = mapped_column(String(5), default="16:9")
    duration_seconds: Mapped[int] = mapped_column(default=60)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    character_bible: Mapped[str] = mapped_column(Text, default="")
    visual_style: Mapped[str] = mapped_column(Text, default="")
    script_revision: Mapped[int] = mapped_column(default=0)
    scenes: Mapped[list[Scene]] = relationship(
        order_by=Scene.number,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    # Stored rather than counted per query; save_script keeps it in sync.
    scene_count: Mapped[int] = mapped_column(default=0)
    # Render options (app/rendering/prompt.py): the film's visual look, and
    # how each scene uses a frame of the one before it.
    look: Mapped[str] = mapped_column(String(16), default="auto")
    continuity: Mapped[str] = mapped_column(String(16), default="reference")
    # The Muse conversation this film is rendered in, the account that
    # owns it, and how many scenes it already holds.
    muse_thread_path: Mapped[str | None] = mapped_column(String(120))
    muse_thread_account_id: Mapped[str | None] = mapped_column(String(36))
    muse_thread_scenes: Mapped[int] = mapped_column(default=0)
    # Scenes with a rendered clip; the render handlers keep it in sync.
    completed_scenes: Mapped[int] = mapped_column(default=0)
    # Merged film, a file name inside the project's media folder.
    video_file: Mapped[str | None] = mapped_column(String(100))
    rendered_at: Mapped[datetime | None] = mapped_column(DateTime)

    @validates("name")
    def _sync_name_key(self, _key: str, value: str) -> str:
        self.name_key = normalize_search_text(value)
        return value
