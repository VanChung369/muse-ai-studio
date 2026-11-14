"""Settings changed in the app: defaults for new projects, the public address."""

from alembic import op
import sqlalchemy as sa

revision = "0021_app_settings"
down_revision = "0020_api_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value_json", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
