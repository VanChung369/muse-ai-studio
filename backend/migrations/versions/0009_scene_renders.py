"""Store rendered scene clips and the merged project video."""

from alembic import op
import sqlalchemy as sa

revision = "0009_scene_renders"
down_revision = "0008_tasks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("project_scenes") as batch:
        batch.add_column(sa.Column("video_file", sa.String(100), nullable=True))
        batch.add_column(sa.Column("rendered_at", sa.DateTime(), nullable=True))
    with op.batch_alter_table("projects") as batch:
        batch.add_column(
            sa.Column(
                "completed_scenes", sa.Integer(), nullable=False, server_default="0"
            )
        )
        batch.add_column(sa.Column("video_file", sa.String(100), nullable=True))
        batch.add_column(sa.Column("rendered_at", sa.DateTime(), nullable=True))
    with op.batch_alter_table("projects") as batch:
        batch.alter_column("completed_scenes", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("rendered_at")
        batch.drop_column("video_file")
        batch.drop_column("completed_scenes")
    with op.batch_alter_table("project_scenes") as batch:
        batch.drop_column("rendered_at")
        batch.drop_column("video_file")
