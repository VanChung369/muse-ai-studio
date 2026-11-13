"""Store encrypted Muse sessions and public account metadata."""

from alembic import op
import sqlalchemy as sa

revision = "0006_accounts"
down_revision = "0005_project_scene_count"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("encrypted_cookies", sa.Text(), nullable=False),
        sa.Column("session_fingerprint", sa.String(64), nullable=False, unique=True),
        sa.Column("cookie_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("length(label) BETWEEN 1 AND 100", name="ck_accounts_label"),
        sa.CheckConstraint(
            "cookie_count BETWEEN 1 AND 100", name="ck_accounts_cookie_count"
        ),
    )


def downgrade() -> None:
    op.drop_table("accounts")
