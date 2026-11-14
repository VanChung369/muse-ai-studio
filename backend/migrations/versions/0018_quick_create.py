"""Keep the origin of files made with Quick Create."""

from alembic import op
import sqlalchemy as sa

revision = "0018_quick_create"
down_revision = "0017_library_assets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("library_assets", sa.Column(
        "source", sa.String(10), nullable=False, server_default="upload"
    ))


def downgrade() -> None:
    op.drop_column("library_assets", "source")
