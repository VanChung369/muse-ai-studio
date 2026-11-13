"""The language spoken in a project's film."""

from alembic import op
import sqlalchemy as sa

revision = "0012_project_language"
down_revision = "0011_project_thread"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(
            sa.Column("language", sa.String(8), nullable=False, server_default="auto")
        )
    with op.batch_alter_table("projects") as batch:
        batch.alter_column("language", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("language")
