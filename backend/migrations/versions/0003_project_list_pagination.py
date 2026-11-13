"""Add a normalized name key and indexes for paginated project lists."""

import unicodedata

from alembic import op
import sqlalchemy as sa

revision = "0003_project_list_pagination"
down_revision = "0002_projects"
branch_labels = None
depends_on = None


def normalize_search_text(value: str) -> str:
    # Frozen copy of app.core.text.normalize_search_text at this revision.
    decomposed = unicodedata.normalize("NFD", value.lower())
    stripped = "".join(char for char in decomposed if not "\u0300" <= char <= "\u036f")
    return stripped.replace("đ", "d")


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("name_key", sa.String(200), nullable=False, server_default=""))

    # Backfill existing rows with the same normalization the model applies.
    connection = op.get_bind()
    projects = sa.table("projects", sa.column("id", sa.String), sa.column("name", sa.String), sa.column("name_key", sa.String))
    for project_id, name in connection.execute(sa.select(projects.c.id, projects.c.name)).all():
        connection.execute(projects.update().where(projects.c.id == project_id).values(name_key=normalize_search_text(name)))

    with op.batch_alter_table("projects") as batch:
        batch.alter_column("name_key", server_default=None)
        batch.create_index("ix_projects_updated", ["updated_at", "id"])
        batch.create_index("ix_projects_name_key", ["name_key", "id"])


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_index("ix_projects_name_key")
        batch.drop_index("ix_projects_updated")
        batch.drop_column("name_key")
