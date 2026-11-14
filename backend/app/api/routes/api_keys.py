import hashlib
import secrets
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import Field, field_validator
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.models import ApiKey
from app.schemas.task import CamelModel
from app.tasks.coordinator import utcnow

router = APIRouter(prefix="/api-keys", tags=["API keys"])
DatabaseSession = Annotated[Session, Depends(get_session)]


class KeyRequest(CamelModel):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class KeyResponse(CamelModel):
    id: str
    name: str
    masked: str
    created_at: datetime
    last_used_at: datetime | None

    @field_validator("created_at", "last_used_at")
    @classmethod
    def ensure_utc(cls, value):
        return value.replace(tzinfo=UTC) if value and value.tzinfo is None else value


class CreatedKey(KeyResponse):
    key: str


class RevealedKey(CamelModel):
    key: str


def key_hash(key):
    return hashlib.sha256(key.encode()).hexdigest()


def describe(key):
    return KeyResponse(
        id=key.id,
        name=key.name,
        masked="sk-muse-…" + key.last4,
        created_at=key.created_at,
        last_used_at=key.last_used_at,
    )


def not_found():
    return HTTPException(
        404,
        detail={"code": "api_key_not_found", "message": "This API key does not exist."},
    )


@router.get("", response_model=list[KeyResponse])
def list_keys(session: DatabaseSession):
    return [
        describe(key)
        for key in session.scalars(
            select(ApiKey)
            .where(ApiKey.revoked_at.is_(None))
            # Two keys made in the same instant still list the later one first.
            .order_by(ApiKey.created_at.desc(), text("rowid DESC"))
        )
    ]


@router.post("", response_model=CreatedKey, status_code=201)
def create(values: KeyRequest, request: Request, session: DatabaseSession):
    secret = "sk-muse-" + secrets.token_hex(24)
    key = ApiKey(
        name=values.name,
        key_hash=key_hash(secret),
        last4=secret[-4:],
        encrypted_key=request.app.state.account_vault.encrypt_text(secret),
    )
    try:
        session.add(key)
        session.flush()  # Take the write lock before counting concurrent creates.
        count = session.scalar(
            select(func.count()).select_from(ApiKey).where(ApiKey.revoked_at.is_(None))
        )
        if count > 20:
            raise HTTPException(
                409,
                detail={
                    "code": "too_many_keys",
                    "message": "You can have up to 20 active API keys.",
                },
            )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return CreatedKey(**describe(key).model_dump(), key=secret)


@router.post("/{key_id}/reveal", response_model=RevealedKey)
def reveal(key_id: str, request: Request, session: DatabaseSession):
    key = session.get(ApiKey, key_id)
    if key is None or key.revoked_at is not None:
        raise not_found()
    return RevealedKey(
        key=request.app.state.account_vault.decrypt_text(key.encrypted_key)
    )


@router.delete("/{key_id}", status_code=204, response_class=Response)
def revoke(key_id: str, session: DatabaseSession):
    changed = session.execute(
        update(ApiKey)
        .where(ApiKey.id == key_id, ApiKey.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    ).rowcount
    if not changed:
        session.rollback()
        raise not_found()
    session.commit()
    return Response(status_code=204)
