from sqlalchemy import CheckConstraint, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Scene(Base):
    __tablename__ = "project_scenes"
    __table_args__ = (
        CheckConstraint("number BETWEEN 1 AND 30", name="ck_project_scenes_number"),
        CheckConstraint("duration_seconds IN (5, 10)", name="ck_project_scenes_duration"),
        CheckConstraint("length(title) BETWEEN 1 AND 300", name="ck_project_scenes_title"),
        CheckConstraint("length(prompt) BETWEEN 1 AND 6000", name="ck_project_scenes_prompt"),
        CheckConstraint("length(narration) <= 600", name="ck_project_scenes_narration"),
    )

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    number: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    prompt: Mapped[str] = mapped_column(Text)
    duration_seconds: Mapped[int] = mapped_column()
    narration: Mapped[str] = mapped_column(Text, default="")
