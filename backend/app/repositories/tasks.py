import base64
import binascii
import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.orm import Session

from app.models import Account, Task
from app.tasks.coordinator import utcnow

# UI filter groups -> statuses (design board 23).
TASK_FILTERS = {
    "all": None,
    "running": ("running",),
    "queued": ("queued",),
    # "Cần xử lý": failures and interruptions that need a decision.
    "attention": ("failed", "interrupted"),
    "succeeded": ("succeeded",),
    "cancelled": ("cancelled",),
}
FINISHED = ("succeeded", "failed", "cancelled", "interrupted")


class InvalidCursorError(ValueError):
    pass


class TaskStateError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class TaskPage:
    items: list[tuple[Task, str | None]]
    total: int
    next_cursor: str | None


def create_task(
    session: Session,
    *,
    kind: str,
    title: str,
    payload: dict | None = None,
    project_id: str | None = None,
    scene_number: int | None = None,
    account_id: str | None = None,
    requires_account: bool = False,
    depends_on_id: str | None = None,
    max_attempts: int = 1,
) -> Task:
    """Persist a task before it runs; the caller commits and wakes the coordinator."""
    task = Task(
        kind=kind,
        title=title[:200],
        payload_json=json.dumps(payload or {}),
        project_id=project_id,
        scene_number=scene_number,
        account_id=account_id,
        requires_account=requires_account,
        depends_on_id=depends_on_id,
        max_attempts=max_attempts,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    session.add(task)
    session.flush()
    return task


def _with_account_label():
    return select(Task, Account.label).outerjoin(Account, Task.account_id == Account.id)


def get_task(session: Session, task_id: str) -> tuple[Task, str | None] | None:
    row = session.execute(_with_account_label().where(Task.id == task_id)).first()
    return (row[0], row[1]) if row else None


def _encode_cursor(task: Task) -> str:
    payload = json.dumps([task.created_at.isoformat(), task.id], separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def _after(cursor: str):
    try:
        created, task_id = json.loads(
            base64.urlsafe_b64decode((cursor + "=" * (-len(cursor) % 4)).encode())
        )
        created = datetime.fromisoformat(created)
    except (binascii.Error, UnicodeDecodeError, ValueError, TypeError) as error:
        raise InvalidCursorError from error
    return or_(
        Task.created_at < created,
        and_(Task.created_at == created, Task.id > str(task_id)),
    )


def list_tasks(
    session: Session,
    *,
    status: str = "all",
    project_id: str | None = None,
    limit: int = 25,
    cursor: str | None = None,
) -> TaskPage:
    filters = []
    if TASK_FILTERS[status]:
        filters.append(Task.status.in_(TASK_FILTERS[status]))
    if project_id:
        filters.append(Task.project_id == project_id)
    total = session.scalar(select(func.count()).select_from(Task).where(*filters)) or 0
    page_filters = [*filters, _after(cursor)] if cursor else filters
    rows = session.execute(
        _with_account_label()
        .where(*page_filters)
        .order_by(Task.created_at.desc(), Task.id)
        .limit(limit + 1)
    ).all()
    items = [(row[0], row[1]) for row in rows[:limit]]
    next_cursor = _encode_cursor(items[-1][0]) if len(rows) > limit else None
    return TaskPage(items=items, total=total, next_cursor=next_cursor)


def count_by_filter(session: Session, project_id: str | None = None) -> dict[str, int]:
    columns = [func.count()]
    for statuses in [value for value in TASK_FILTERS.values() if value]:
        columns.append(
            func.coalesce(func.sum(case((Task.status.in_(statuses), 1), else_=0)), 0)
        )
    query = select(*columns).select_from(Task)
    if project_id:
        query = query.where(Task.project_id == project_id)
    row = session.execute(query).one()
    return dict(zip(TASK_FILTERS, row, strict=True))


def request_cancel(session: Session, task_id: str) -> bool:
    """Queued -> cancelled now; running -> cancel after the current step.

    Writes before reading (see the coordinator's claim) so a concurrent
    commit cannot make this request fail with "database is locked".
    """
    now = utcnow()
    try:
        cancelled = session.execute(
            update(Task)
            .where(Task.id == task_id, Task.status == "queued")
            .values(
                status="cancelled",
                cancel_requested=True,
                finished_at=now,
                updated_at=now,
            )
        ).rowcount
        if not cancelled:
            cancelled = session.execute(
                update(Task)
                .where(Task.id == task_id, Task.status == "running")
                .values(cancel_requested=True, updated_at=now)
            ).rowcount
        if cancelled:
            session.commit()
            return True
        exists = session.scalar(select(Task.id).where(Task.id == task_id)) is not None
        session.rollback()
    except Exception:
        session.rollback()
        raise
    if not exists:
        return False
    raise TaskStateError("task_finished", "This task has already finished.")


def requeue_values(switch_account: bool = False) -> dict:
    """Column values that put a finished task back in the queue."""
    values = dict(
        status="queued",
        cancel_requested=False,
        attempts=0,
        run_after=None,
        started_at=None,
        finished_at=None,
        error_code=None,
        error_message=None,
        suggested_action=None,
        retryable=False,
        progress_pct=None,
        updated_at=utcnow(),
    )
    if switch_account:
        # Let the coordinator pick another account (least recently used).
        values["account_id"] = case(
            (Task.requires_account.is_(True), None), else_=Task.account_id
        )
    return values


def retry_task(
    session: Session,
    task_id: str,
    *,
    switch_account: bool = False,
    confirm_duplicate: bool = False,
) -> bool:
    """Queue a failed, interrupted, or cancelled task again (attempt budget reset)."""
    retryable = ["failed", "cancelled"] + (["interrupted"] if confirm_duplicate else [])
    values = requeue_values(switch_account)
    try:
        if session.execute(
            update(Task)
            .where(Task.id == task_id, Task.status.in_(retryable))
            .values(**values)
        ).rowcount:
            session.commit()
            return True
        current = session.scalar(select(Task.status).where(Task.id == task_id))
        session.rollback()
    except Exception:
        session.rollback()
        raise
    if current is None:
        return False
    if current == "interrupted":
        # The previous request may have reached Muse; resending could create
        # a duplicate. The user must confirm explicitly.
        raise TaskStateError(
            "confirm_required",
            "This task may already have been sent. Confirm to send it again.",
        )
    raise TaskStateError(
        "task_not_retryable",
        "Only failed, interrupted, or cancelled tasks can be retried.",
    )
