"""Films longer than five minutes, and more frame shapes.

A film may be up to an hour long (a warning, not a limit, tells the user
what a long film costs), so a script may hold up to 720 scenes; and the
frame may also be 4:3, 3:4, 4:5 or 21:9.
"""

from alembic import op

revision = "0019_long_films"
down_revision = "0018_quick_create"
branch_labels = None
depends_on = None

DURATION = "duration_seconds BETWEEN 10 AND {} AND duration_seconds % 5 = 0"
OLD_RATIOS = "aspect_ratio IN ('16:9', '9:16', '1:1')"
NEW_RATIOS = "aspect_ratio IN ('16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '21:9')"


def _limits(duration: int, ratios: str, scenes: int) -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_constraint("ck_projects_duration", type_="check")
        batch.drop_constraint("ck_projects_ratio", type_="check")
        batch.drop_constraint("ck_projects_scene_count", type_="check")
        batch.create_check_constraint("ck_projects_duration", DURATION.format(duration))
        batch.create_check_constraint("ck_projects_ratio", ratios)
        batch.create_check_constraint(
            "ck_projects_scene_count", f"scene_count BETWEEN 0 AND {scenes}"
        )
    with op.batch_alter_table("project_scenes") as batch:
        batch.drop_constraint("ck_project_scenes_number", type_="check")
        batch.create_check_constraint(
            "ck_project_scenes_number", f"number BETWEEN 1 AND {scenes}"
        )


def upgrade() -> None:
    _limits(3600, NEW_RATIOS, 720)


def downgrade() -> None:
    # Films the older limits cannot hold are fitted to them: there is no
    # other way back.
    op.execute("DELETE FROM project_scenes WHERE number > 30")
    op.execute(
        "UPDATE projects SET scene_count = "
        "(SELECT count(*) FROM project_scenes WHERE project_scenes.project_id = projects.id)"
    )
    op.execute("UPDATE projects SET duration_seconds = 300 WHERE duration_seconds > 300")
    op.execute(f"UPDATE projects SET aspect_ratio = '16:9' WHERE NOT ({OLD_RATIOS})")
    _limits(300, OLD_RATIOS, 30)
