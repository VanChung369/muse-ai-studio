"""Persist background tasks for the coordinator."""

from alembic import op
import sqlalchemy as sa

revision = "0008_tasks"
down_revision = "0007_account_operations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("checkpoint_json", sa.Text(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("scene_number", sa.Integer(), nullable=True),
        sa.Column(
            "account_id",
            sa.String(36),
            sa.ForeignKey("accounts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("requires_account", sa.Boolean(), nullable=False),
        sa.Column(
            "depends_on_id",
            sa.String(36),
            sa.ForeignKey("tasks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("progress_pct", sa.Float(), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_message", sa.String(500), nullable=True),
        sa.Column("retryable", sa.Boolean(), nullable=False),
        sa.Column("suggested_action", sa.String(32), nullable=True),
        sa.Column("upstream_ref", sa.String(200), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("run_after", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')",
            name="ck_tasks_status",
        ),
        sa.CheckConstraint(
            "suggested_action IS NULL OR suggested_action IN ('retry', 'relogin', 'switch_account', 'check_proxy')",
            name="ck_tasks_suggested_action",
        ),
        sa.CheckConstraint(
            "attempts >= 0 AND max_attempts BETWEEN 1 AND 5", name="ck_tasks_attempts"
        ),
        sa.CheckConstraint("length(title) BETWEEN 1 AND 200", name="ck_tasks_title"),
    )
    op.create_index("ix_tasks_status_created", "tasks", ["status", "created_at", "id"])
    op.create_index("ix_tasks_created", "tasks", ["created_at", "id"])
    op.create_index("ix_tasks_project", "tasks", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_project", table_name="tasks")
    op.drop_index("ix_tasks_created", table_name="tasks")
    op.drop_index("ix_tasks_status_created", table_name="tasks")
    op.drop_table("tasks")
