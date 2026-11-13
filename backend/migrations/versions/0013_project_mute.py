"""A project's film can be silent."""

from alembic import op
import sqlalchemy as sa

revision = "0013_project_mute"
down_revision = "0012_project_language"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(
            sa.Column("mute", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    with op.batch_alter_table("projects") as batch:
        batch.alter_column("mute", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("mute")
