"""Store each project's scene count instead of counting scenes per query."""

from alembic import op
import sqlalchemy as sa

revision = "0005_project_scene_count"
down_revision = "0004_project_scripts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("scene_count", sa.Integer(), nullable=False, server_default="0"))
        batch.create_check_constraint("ck_projects_scene_count", "scene_count BETWEEN 0 AND 30")
    op.execute(
        "UPDATE projects SET scene_count = "
        "(SELECT count(*) FROM project_scenes WHERE project_scenes.project_id = projects.id)"
    )
    with op.batch_alter_table("projects") as batch:
        batch.alter_column("scene_count", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_constraint("ck_projects_scene_count", type_="check")
        batch.drop_column("scene_count")
