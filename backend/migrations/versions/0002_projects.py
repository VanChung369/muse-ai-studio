"""Persist project drafts."""

from alembic import op
import sqlalchemy as sa

revision = "0002_projects"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("idea", sa.Text(), nullable=False),
        sa.Column("aspect_ratio", sa.String(5), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 100", name="ck_projects_name"),
        sa.CheckConstraint("length(idea) <= 12000", name="ck_projects_idea"),
        sa.CheckConstraint("duration_seconds BETWEEN 10 AND 300 AND duration_seconds % 5 = 0", name="ck_projects_duration"),
        sa.CheckConstraint("aspect_ratio IN ('16:9', '9:16', '1:1')", name="ck_projects_ratio"),
        sa.CheckConstraint("status IN ('draft', 'planning', 'ready', 'rendering', 'cancelling', 'cancelled', 'failed', 'completed')", name="ck_projects_status"),
    )


def downgrade() -> None:
    op.drop_table("projects")
