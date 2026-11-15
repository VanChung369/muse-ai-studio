"""Remember which reference files a project's Muse conversation has seen.

A changed set of files is then sent into the same conversation instead of
starting a new one. Projects already in a conversation have seen the files
they have now (a change used to start a new conversation)."""

from alembic import op
import sqlalchemy as sa

revision = "0022_thread_references"
down_revision = "0021_app_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("muse_thread_references", sa.Text(), nullable=True))
    op.execute(
        "UPDATE projects SET muse_thread_references = ("
        " SELECT json_group_object(file, name) FROM project_references"
        " WHERE project_references.project_id = projects.id"
        ") WHERE muse_thread_path IS NOT NULL"
    )


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("muse_thread_references")
