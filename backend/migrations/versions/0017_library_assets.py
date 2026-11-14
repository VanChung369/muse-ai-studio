"""Files uploaded to the media library."""

from alembic import op
import sqlalchemy as sa

revision = "0017_library_assets"
down_revision = "0016_project_media"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "library_assets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("file", sa.String(80), nullable=False),
        sa.Column("mime", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("seconds", sa.Float(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_library_assets_kind", "library_assets", ["kind"])


def downgrade() -> None:
    op.drop_index("ix_library_assets_kind", table_name="library_assets")
    op.drop_table("library_assets")
