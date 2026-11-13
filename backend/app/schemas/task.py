import json
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.models import Task

TaskStatus = Literal[
    "queued", "running", "succeeded", "failed", "cancelled", "interrupted"
]
TaskFilter = Literal["all", "running", "queued", "attention", "succeeded", "cancelled"]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True)


class TaskError(CamelModel):
    code: str
    message: str | None = None


class TaskResponse(CamelModel):
    id: str
    kind: str
    status: TaskStatus
    # True while a running task is finishing its current step before stopping.
    cancel_requested: bool
    title: str
    project_id: str | None
    scene_number: int | None
    account_id: str | None
    account_label: str | None
    depends_on_id: str | None
    attempts: int
    max_attempts: int
    progress_pct: float | None
    error: TaskError | None
    retryable: bool
    suggested_action: (
        Literal["retry", "relogin", "switch_account", "check_proxy"] | None
    )
    # A request may exist upstream; retrying an interrupted task needs confirmation.
    submitted: bool
    result: dict | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None

    @field_validator("created_at", "started_at", "finished_at")
    @classmethod
    def ensure_utc(cls, value: datetime | None) -> datetime | None:
        return (
            value.replace(tzinfo=UTC)
            if value is not None and value.tzinfo is None
            else value
        )

    @classmethod
    def from_task(cls, task: Task, account_label: str | None) -> "TaskResponse":
        return cls(
            id=task.id,
            kind=task.kind,
            status=task.status,
            cancel_requested=task.cancel_requested,
            title=task.title,
            project_id=task.project_id,
            scene_number=task.scene_number,
            account_id=task.account_id,
            account_label=account_label,
            depends_on_id=task.depends_on_id,
            attempts=task.attempts,
            max_attempts=task.max_attempts,
            progress_pct=task.progress_pct,
            error=(
                TaskError(code=task.error_code, message=task.error_message)
                if task.error_code
                else None
            ),
            retryable=task.retryable,
            suggested_action=task.suggested_action,
            submitted=task.submitted_at is not None,
            result=json.loads(task.result_json) if task.result_json else None,
            created_at=task.created_at,
            started_at=task.started_at,
            finished_at=task.finished_at,
        )


class TaskCounts(CamelModel):
    all: int
    running: int
    queued: int
    attention: int
    succeeded: int
    cancelled: int


class TaskListResponse(CamelModel):
    items: list[TaskResponse]
    total: int
    next_cursor: str | None
    counts: TaskCounts


class TaskRetry(CamelModel):
    model_config = ConfigDict(
        alias_generator=to_camel, validate_by_name=True, extra="forbid"
    )
    # Clear the pinned account so the coordinator picks another one.
    switch_account: bool = Field(default=False, strict=True)
    # Required for interrupted tasks: the earlier request may have reached Muse.
    confirm_duplicate: bool = Field(default=False, strict=True)
