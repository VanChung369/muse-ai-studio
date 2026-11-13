"""Music wishes and reference material for a project."""

from alembic import op
import sqlalchemy as sa

revision = "0015_project_references"
down_revision = "0014_project_timeline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(
            sa.Column("music", sa.String(500), nullable=False, server_default="")
        )
    with op.batch_alter_table("projects") as batch:
        batch.alter_column("music", server_default=None)
    op.create_table(
        "project_references",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("file", sa.String(80), nullable=False),
        sa.Column("mime", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_project_references_project_id", "project_references", ["project_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_project_references_project_id", table_name="project_references")
    op.drop_table("project_references")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("music")
