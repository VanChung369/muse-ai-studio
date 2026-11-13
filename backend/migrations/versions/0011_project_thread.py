"""Remember the Muse conversation each project is rendered in."""

from alembic import op
import sqlalchemy as sa

revision = "0011_project_thread"
down_revision = "0010_render_options"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("muse_thread_path", sa.String(120), nullable=True))
        batch.add_column(
            sa.Column("muse_thread_account_id", sa.String(36), nullable=True)
        )
        batch.add_column(
            sa.Column(
                "muse_thread_scenes", sa.Integer(), nullable=False, server_default="0"
            )
        )
    with op.batch_alter_table("projects") as batch:
        batch.alter_column("muse_thread_scenes", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("muse_thread_scenes")
        batch.drop_column("muse_thread_account_id")
        batch.drop_column("muse_thread_path")
