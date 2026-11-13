from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint(
            "session_status IN ('unverified', 'valid', 'invalid')",
            name="ck_accounts_status",
        ),
        CheckConstraint("length(notes) <= 2000", name="ck_accounts_notes"),
        CheckConstraint("length(label) BETWEEN 1 AND 100", name="ck_accounts_label"),
        CheckConstraint(
            "cookie_count BETWEEN 1 AND 100", name="ck_accounts_cookie_count"
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    label: Mapped[str] = mapped_column(String(100))
    enabled: Mapped[bool] = mapped_column(default=True)
    encrypted_cookies: Mapped[str] = mapped_column(Text)
    session_fingerprint: Mapped[str] = mapped_column(String(64), unique=True)
    cookie_count: Mapped[int] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC)
    )

    session_status: Mapped[str] = mapped_column(String(16), default="unverified")
    notes: Mapped[str] = mapped_column(Text, default="")
    cookie_expiries: Mapped[str] = mapped_column(Text, default="{}")
    credential_version: Mapped[int] = mapped_column(default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_keepalive_at: Mapped[datetime | None] = mapped_column(DateTime)
    quota_checked_at: Mapped[datetime | None] = mapped_column(DateTime)
    quota_json: Mapped[str | None] = mapped_column(Text)
    encrypted_proxy: Mapped[str | None] = mapped_column(Text)
    last_error: Mapped[str | None] = mapped_column(String(64))
