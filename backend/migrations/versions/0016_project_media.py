"""Videos, pictures and audio the user adds to a film."""

from alembic import op
import sqlalchemy as sa

revision = "0016_project_media"
down_revision = "0015_project_references"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_media",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("file", sa.String(80), nullable=False),
        sa.Column("mime", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("seconds", sa.Float(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_project_media_project_id", "project_media", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_project_media_project_id", table_name="project_media")
    op.drop_table("project_media")
