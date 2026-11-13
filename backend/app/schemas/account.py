from datetime import UTC, datetime
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

# Large enough for a full browser cookie export; non-muse.ai cookies are skipped.
MAX_COOKIE_TEXT = 1_048_576


class AccountImport(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        str_strip_whitespace=True,
        hide_input_in_errors=True,
    )

    label: str = Field(min_length=1, max_length=100)
    cookie_text: SecretStr = Field(min_length=1, max_length=MAX_COOKIE_TEXT)


class AccountPatch(BaseModel):
    model_config = ConfigDict(
        extra="forbid", str_strip_whitespace=True, hide_input_in_errors=True
    )

    label: str | None = Field(default=None, min_length=1, max_length=100)
    notes: str | None = Field(default=None, max_length=2000)
    enabled: bool | None = Field(default=None, strict=True)

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set or any(
            getattr(self, name) is None for name in self.model_fields_set
        ):
            raise ValueError("Provide a label, notes, or enabled flag.")
        return self


class ProxyPublic(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True)
    server: str
    username: str
    has_password: bool


class AccountQuota(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True)
    plan: str | None = None
    weekly_used_pct: float = Field(ge=0, le=100)
    weekly_reset: str | None = None
    extra_used_pct: float | None = Field(default=None, ge=0, le=100)
    extra_left: str | None = None
    extra_expires: str | None = None


class CookieUpdate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, extra="forbid", hide_input_in_errors=True
    )
    cookie_text: SecretStr = Field(min_length=1, max_length=MAX_COOKIE_TEXT)


class ProxyInput(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    server: str = Field(max_length=2048)
    username: str = Field(default="", max_length=256)
    password: SecretStr | None = Field(default=None, max_length=1024)

    @model_validator(mode="before")
    @classmethod
    def parse_url(cls, value):
        from app.integrations.muse.proxy import split_proxy_url

        return split_proxy_url(value) if isinstance(value, dict) else value

    @field_validator("server")
    @classmethod
    def normalize_server(cls, value):
        from app.integrations.muse.proxy import normalize_server

        return normalize_server(value)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value):
        if ":" in value or any(ord(char) < 32 for char in value):
            raise ValueError("Invalid proxy username.")
        return _require_latin1(value)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value):
        if value is not None:
            _require_latin1(value.get_secret_value())
        return value

    @model_validator(mode="after")
    def validate_socks_lengths(self):
        # SOCKS5 username/password auth stores each length in one byte.
        if self.server.startswith(("socks5://", "socks5h://")):
            password = self.password.get_secret_value() if self.password else ""
            if len(self.username.encode("latin-1")) > 255 or len(password.encode("latin-1")) > 255:
                raise ValueError("SOCKS5 credentials must not exceed 255 bytes.")
        return self


def _require_latin1(value: str) -> str:
    # Proxies receive credentials as Latin-1 bytes (HTTP Basic and SOCKS5);
    # reject others when saving instead of failing on every later operation.
    try:
        value.encode("latin-1")
    except UnicodeEncodeError:
        raise ValueError("Proxy credentials must use Latin-1 characters.") from None
    return value


class ProxyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    proxy: ProxyInput | None


class AccountResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, from_attributes=True, validate_by_name=True
    )

    id: str
    label: str
    enabled: bool
    cookie_count: int
    session_status: Literal["unverified", "valid", "invalid"] = "unverified"
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    last_checked_at: datetime | None = None
    last_keepalive_at: datetime | None = None
    quota_checked_at: datetime | None = None
    notes: str = ""
    last_error: str | None = None
    credential_version: int = 0
    proxy: ProxyPublic | None = None
    quota: AccountQuota | None = None
    created_at: datetime
    updated_at: datetime

    @field_validator(
        "created_at",
        "updated_at",
        "expires_at",
        "last_used_at",
        "last_checked_at",
        "last_keepalive_at",
        "quota_checked_at",
    )
    @classmethod
    def ensure_utc(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        return (
            value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        )


class AccountListResponse(BaseModel):
    items: list[AccountResponse]
    total: int


class AccountActionResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True)
    account: AccountResponse
    ok: bool
    code: str
    vm_state: str | None = None
