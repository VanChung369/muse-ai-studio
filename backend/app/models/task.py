from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

TASK_STATUSES = ("queued", "running", "succeeded", "failed", "cancelled", "interrupted")
SUGGESTED_ACTIONS = ("retry", "relogin", "switch_account", "check_proxy")


class Task(Base):
    """One unit of background work, persisted before it runs.

    `submitted_at` records that a request may already exist upstream (for
    example a Muse generation job). After a restart such a task becomes
    `interrupted` instead of being sent again automatically.
    """

    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')",
            name="ck_tasks_status",
        ),
        CheckConstraint(
            "suggested_action IS NULL OR suggested_action IN ('retry', 'relogin', 'switch_account', 'check_proxy')",
            name="ck_tasks_suggested_action",
        ),
        CheckConstraint(
            "attempts >= 0 AND max_attempts BETWEEN 1 AND 5", name="ck_tasks_attempts"
        ),
        CheckConstraint("length(title) BETWEEN 1 AND 200", name="ck_tasks_title"),
        # Dispatcher scan and newest-first listing.
        Index("ix_tasks_status_created", "status", "created_at", "id"),
        Index("ix_tasks_created", "created_at", "id"),
        Index("ix_tasks_project", "project_id"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="queued")
    title: Mapped[str] = mapped_column(String(200))
    # Non-secret handler input and output; credentials never go here.
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    checkpoint_json: Mapped[str] = mapped_column(Text, default="{}")
    result_json: Mapped[str | None] = mapped_column(Text)

    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL")
    )
    scene_number: Mapped[int | None] = mapped_column()
    account_id: Mapped[str | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL")
    )
    requires_account: Mapped[bool] = mapped_column(default=False)
    depends_on_id: Mapped[str | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL")
    )

    attempts: Mapped[int] = mapped_column(default=0)
    max_attempts: Mapped[int] = mapped_column(default=1)
    cancel_requested: Mapped[bool] = mapped_column(default=False)
    # Only when upstream reports real progress; never simulated.
    progress_pct: Mapped[float | None] = mapped_column(Float)

    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(String(500))
    retryable: Mapped[bool] = mapped_column(default=False)
    suggested_action: Mapped[str | None] = mapped_column(String(32))

    upstream_ref: Mapped[str | None] = mapped_column(String(200))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    run_after: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC)
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC)
    )
