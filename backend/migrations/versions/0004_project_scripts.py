"""Store editable scripts and scene timelines."""

from alembic import op
import sqlalchemy as sa

revision = "0004_project_scripts"
down_revision = "0003_project_list_pagination"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("character_bible", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("visual_style", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("script_revision", sa.Integer(), nullable=False, server_default="0"))
        batch.create_check_constraint("ck_projects_character_bible", "length(character_bible) <= 10000")
        batch.create_check_constraint("ck_projects_visual_style", "length(visual_style) <= 3000")
        batch.create_check_constraint("ck_projects_script_revision", "script_revision >= 0")
    # Existing rows now have values; application defaults handle future inserts.
    with op.batch_alter_table("projects") as batch:
        batch.alter_column("character_bible", server_default=None)
        batch.alter_column("visual_style", server_default=None)
        batch.alter_column("script_revision", server_default=None)
    op.create_table(
        "project_scenes",
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("number", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("narration", sa.Text(), nullable=False),
        sa.CheckConstraint("number BETWEEN 1 AND 30", name="ck_project_scenes_number"),
        sa.CheckConstraint("duration_seconds IN (5, 10)", name="ck_project_scenes_duration"),
        sa.CheckConstraint("length(title) BETWEEN 1 AND 300", name="ck_project_scenes_title"),
        sa.CheckConstraint("length(prompt) BETWEEN 1 AND 6000", name="ck_project_scenes_prompt"),
        sa.CheckConstraint("length(narration) <= 600", name="ck_project_scenes_narration"),
    )


def downgrade() -> None:
    op.drop_table("project_scenes")
    with op.batch_alter_table("projects") as batch:
        batch.drop_constraint("ck_projects_script_revision", type_="check")
        batch.drop_constraint("ck_projects_visual_style", type_="check")
        batch.drop_constraint("ck_projects_character_bible", type_="check")
        batch.drop_column("script_revision")
        batch.drop_column("visual_style")
        batch.drop_column("character_bible")
