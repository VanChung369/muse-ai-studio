import json
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import Field, field_validator, model_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.api.routes.library import LibraryItem, describe
from app.models import Account, Task
from app.rendering import library
from app.rendering.quick_create import MAX_COUNT, QuickCreateError, enqueue
from app.schemas.task import CamelModel, TaskResponse
from app.tasks.kinds import QUICK_KINDS

router = APIRouter(prefix="/quick-create", tags=["Quick Create"])
DatabaseSession = Annotated[Session, Depends(get_session)]


class QuickRequest(CamelModel):
    kind: Literal["image", "video"]
    prompt: str = Field(min_length=1, max_length=4000)
    aspect_ratio: Literal["16:9", "9:16", "1:1"] = "1:1"
    count: int = Field(default=1, ge=1, le=MAX_COUNT, strict=True)
    reference_asset_id: str | None = Field(default=None, min_length=1, max_length=36)

    @field_validator("prompt")
    @classmethod
    def clean_prompt(cls, value):
        if not value.strip():
            raise ValueError("Enter a prompt.")
        return value.strip()

    @model_validator(mode="after")
    def single_video(self):
        if self.kind == "video" and self.count != 1:
            raise ValueError("A video request creates one video.")
        return self


class QuickBatch(CamelModel):
    id: str
    kind: Literal["image", "video"]
    prompt: str
    aspect_ratio: str
    count: int
    completed_count: int
    created_at: datetime
    tasks: list[TaskResponse]
    items: list[LibraryItem]


def batches(session, settings, batch_ids):
    rows = session.execute(
        select(Task, Account.label)
        .outerjoin(Account, Account.id == Task.account_id)
        .where(
            Task.kind.in_(QUICK_KINDS),
            func.json_extract(Task.payload_json, "$.batchId").in_(batch_ids),
        )
        .order_by(Task.created_at, Task.id)
    ).all()
    grouped = {batch_id: [] for batch_id in batch_ids}
    for task, label in rows:
        grouped[json.loads(task.payload_json)["batchId"]].append((task, label))
    result = []
    for batch_id, group in grouped.items():
        if not group:
            continue
        group.sort(key=lambda row: json.loads(row[0].payload_json)["index"])
        payload = json.loads(group[0][0].payload_json)
        items = []
        completed = 0
        for task, _ in group:
            outcome = json.loads(task.result_json or "{}")
            checkpoint = json.loads(task.checkpoint_json or "{}")
            ids = outcome.get("assetIds", checkpoint.get("assetIds", []))
            if not ids and outcome.get("assetId"):
                ids = [outcome["assetId"]]
            completed += len(ids)
            for asset_id in ids:
                if (
                    item := library.find(session, settings, f"upload:{asset_id}")
                ):
                    items.append(describe(item))
        result.append(
            QuickBatch(
                id=batch_id,
                kind=payload["kind"],
                prompt=payload["prompt"],
                aspect_ratio=payload["aspectRatio"],
                count=payload["count"],
                completed_count=completed,
                created_at=TaskResponse.from_task(*group[0]).created_at,
                tasks=[TaskResponse.from_task(*row) for row in group],
                items=items,
            )
        )
    return result


@router.get("", response_model=list[QuickBatch])
def recent(
    request: Request,
    session: DatabaseSession,
    limit: Annotated[int, Query(ge=1, le=30)] = 20,
):
    batch = func.json_extract(Task.payload_json, "$.batchId")
    ids = list(
        session.scalars(
            select(batch)
            .where(
                Task.kind.in_(QUICK_KINDS),
                func.coalesce(func.json_extract(Task.payload_json, "$.hidden"), 0) == 0,
            )
            .group_by(batch)
            .order_by(func.max(Task.created_at).desc())
            .limit(limit)
        )
    )
    return batches(session, request.app.state.settings, ids)


@router.post("", response_model=QuickBatch, status_code=202)
def create(values: QuickRequest, request: Request, session: DatabaseSession):
    try:
        batch_id = enqueue(session, values, request.app.state.settings)
    except QuickCreateError as error:
        raise HTTPException(
            error.status, detail={"code": error.code, "message": str(error)}
        ) from None
    response = batches(session, request.app.state.settings, [batch_id])[0]
    request.app.state.task_coordinator.wake()
    return response


def set_hidden(session, batch_id: str, hidden: bool):
    """Remove a whole card from recent results, keeping its tasks and files."""
    changed = session.execute(
        update(Task).where(
            Task.kind.in_(QUICK_KINDS),
            func.json_extract(Task.payload_json, "$.batchId") == batch_id,
        ).values(payload_json=func.json_set(Task.payload_json, "$.hidden", int(hidden)))
    ).rowcount
    if not changed:
        session.rollback()
        raise HTTPException(404, detail={"code": "quick_create_not_found", "message": "This request does not exist."})
    session.commit()
    return Response(status_code=204)


@router.delete("/{batch_id}", status_code=204, response_class=Response)
def dismiss(batch_id: str, session: DatabaseSession):
    return set_hidden(session, batch_id, True)


@router.post("/{batch_id}/restore", status_code=204, response_class=Response)
def restore(batch_id: str, session: DatabaseSession):
    return set_hidden(session, batch_id, False)
