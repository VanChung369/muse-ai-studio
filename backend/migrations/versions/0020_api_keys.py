"""Keys for the public generation API, recoverable through the account vault."""

from alembic import op
import sqlalchemy as sa

revision = "0020_api_keys"
down_revision = "0019_long_films"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "api_keys",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("key_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("encrypted_key", sa.Text(), nullable=False),
        sa.Column("last4", sa.String(4), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime()),
        sa.Column("revoked_at", sa.DateTime()),
    )


def downgrade() -> None:
    op.drop_table("api_keys")
