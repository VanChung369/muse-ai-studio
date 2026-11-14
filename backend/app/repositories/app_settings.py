"""Settings kept in the database, with what applies until one is saved."""

import json
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from app.models import AppSetting

# What a new project starts from when the request does not say.
PROJECT_DEFAULTS = {
    "durationSeconds": 60,
    "aspectRatio": "16:9",
    "language": "auto",
    "look": "auto",
    "continuity": "reference",
}


def read(session: Session) -> dict:
    stored = {
        row.key: json.loads(row.value_json) for row in session.scalars(select(AppSetting))
    }
    saved = stored.get("projectDefaults")
    return {
        # A value saved by an older version may lack a newer field.
        "projectDefaults": {
            **PROJECT_DEFAULTS,
            **(saved if isinstance(saved, dict) else {}),
        },
        # The address other machines reach this app at, or None to use the
        # address of each request.
        "publicUrl": stored.get("publicUrl") or None,
    }


def write(session: Session, changes: dict) -> dict:
    """Save the given settings (name -> value) and return all of them."""
    try:
        for key, value in changes.items():
            # An upsert is a write from its first statement, so it never has
            # to turn a read snapshot into SQLite's write lock.
            statement = insert(AppSetting).values(
                key=key, value_json=json.dumps(value), updated_at=datetime.now(UTC)
            )
            session.execute(
                statement.on_conflict_do_update(
                    index_elements=[AppSetting.key],
                    set_={
                        "value_json": statement.excluded.value_json,
                        "updated_at": statement.excluded.updated_at,
                    },
                )
            )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return read(session)
