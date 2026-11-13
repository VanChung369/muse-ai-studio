"""The edit applied when a project's film is merged."""

from alembic import op
import sqlalchemy as sa

revision = "0014_project_timeline"
down_revision = "0013_project_mute"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("timeline_json", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("timeline_json")
