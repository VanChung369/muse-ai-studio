"""Persist account health, expiry, quota, notes and encrypted proxy routing."""

from alembic import op
import sqlalchemy as sa

revision = "0007_account_operations"
down_revision = "0006_accounts"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("accounts") as batch:
        for name, type_, default in [
            ("session_status", sa.String(16), "unverified"),
            ("notes", sa.Text(), ""),
            ("cookie_expiries", sa.Text(), "{}"),
            ("credential_version", sa.Integer(), "0"),
        ]:
            batch.add_column(
                sa.Column(name, type_, nullable=False, server_default=default)
            )
        for name in (
            "expires_at",
            "last_used_at",
            "last_checked_at",
            "last_keepalive_at",
            "quota_checked_at",
        ):
            batch.add_column(sa.Column(name, sa.DateTime(), nullable=True))
        for name in ("quota_json", "encrypted_proxy"):
            batch.add_column(sa.Column(name, sa.Text(), nullable=True))
        batch.add_column(sa.Column("last_error", sa.String(64), nullable=True))
        batch.create_check_constraint(
            "ck_accounts_status", "session_status IN ('unverified', 'valid', 'invalid')"
        )
        batch.create_check_constraint("ck_accounts_notes", "length(notes) <= 2000")
    with op.batch_alter_table("accounts") as batch:
        for name in (
            "session_status",
            "notes",
            "cookie_expiries",
            "credential_version",
        ):
            batch.alter_column(name, server_default=None)


def downgrade():
    with op.batch_alter_table("accounts") as batch:
        batch.drop_constraint("ck_accounts_status", type_="check")
        batch.drop_constraint("ck_accounts_notes", type_="check")
        for name in (
            "session_status",
            "notes",
            "cookie_expiries",
            "credential_version",
            "expires_at",
            "last_used_at",
            "last_checked_at",
            "last_keepalive_at",
            "quota_checked_at",
            "quota_json",
            "encrypted_proxy",
            "last_error",
        ):
            batch.drop_column(name)
