"""Per-project render options: the visual look and scene-to-scene continuity."""

from alembic import op
import sqlalchemy as sa

revision = "0010_render_options"
down_revision = "0009_scene_renders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(
            sa.Column("look", sa.String(16), nullable=False, server_default="auto")
        )
        batch.add_column(
            sa.Column(
                "continuity", sa.String(16), nullable=False, server_default="reference"
            )
        )
        batch.create_check_constraint(
            "ck_projects_look",
            "look IN ('auto', 'realistic', 'cinematic', 'documentary', "
            "'commercial', 'animation3d', 'anime')",
        )
        batch.create_check_constraint(
            "ck_projects_continuity", "continuity IN ('off', 'reference', 'seamless')"
        )
    with op.batch_alter_table("projects") as batch:
        batch.alter_column("look", server_default=None)
        batch.alter_column("continuity", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_constraint("ck_projects_continuity", type_="check")
        batch.drop_constraint("ck_projects_look", type_="check")
        batch.drop_column("continuity")
        batch.drop_column("look")
