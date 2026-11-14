"""In-process task coordinator backed by the `tasks` table.

Rules (docs/architecture.md, "Tác vụ và khôi phục"):
- A task is stored before it runs; claiming it is one atomic UPDATE, so the
  same task never runs twice.
- Concurrency is bounded (`max_workers`) and an account runs one task at a
  time; the account lock is shared with account API operations.
- Cancellation is cooperative: queued tasks stop immediately, running ones
  after their current step (handlers call `ctx.raise_if_cancelled()`).
  Completed work is kept.
- After a restart, tasks that were running are requeued only if nothing was
  sent upstream yet (`submitted_at` is NULL). Otherwise they become
  `interrupted` and wait for the user; requests are never resent blindly.
- Handlers run in worker threads with their own short DB sessions; no
  transaction is held across upstream I/O.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import case, or_, select, text, update
from sqlalchemy.orm import aliased

from app.core.account_operations import AccountOperations
from app.db.session import Database
from app.models import Account, Task

logger = logging.getLogger(__name__)


def utcnow() -> datetime:
    # Stored as naive UTC, like the other tables.
    return datetime.now(UTC).replace(tzinfo=None)


class TaskFailure(Exception):
    """A handler failure with a user-facing code and optional recovery hint."""

    def __init__(
        self,
        code: str,
        message: str = "",
        *,
        retryable: bool = False,
        suggested_action: str | None = None,
    ):
        super().__init__(message or code)
        self.code, self.message = code, message
        self.retryable, self.suggested_action = retryable, suggested_action


class TaskCancelled(Exception):
    pass


class TaskDeferred(Exception):
    """Nothing was sent upstream and the task cannot run right now (for
    example the browser slot is busy). Requeue it after `delay` seconds
    without spending an attempt."""

    def __init__(self, reason: str, delay: float = 10.0):
        super().__init__(reason)
        self.reason, self.delay = reason, delay


@dataclass
class TaskContext:
    coordinator: TaskCoordinator
    task_id: str
    kind: str
    payload: dict
    checkpoint: dict
    attempt: int
    account_id: str | None
    project_id: str | None
    scene_number: int | None
    # Set by TaskCoordinator.notify_cancel (the cancel API) for an instant answer.
    cancel_event: threading.Event = field(default_factory=threading.Event)
    _next_db_check: float = 0.0

    def cancel_requested(self) -> bool:
        """Cheap enough for tight polling loops: the in-memory event answers
        immediately; the database (other cancel paths, e.g. a project-level
        cancel) is consulted at most every CANCEL_DB_INTERVAL seconds."""
        if self.cancel_event.is_set():
            return True
        now = time.monotonic()
        if now < self._next_db_check:
            return False
        self._next_db_check = now + CANCEL_DB_INTERVAL
        with self.coordinator.database.sessions() as session:
            requested = bool(
                session.scalar(
                    select(Task.cancel_requested).where(Task.id == self.task_id)
                )
            )
        if requested:
            self.cancel_event.set()
        return requested

    def raise_if_cancelled(self) -> None:
        """Call between steps: cancellation takes effect after the current one."""
        if self.cancel_requested():
            raise TaskCancelled

    def save_checkpoint(self, checkpoint: dict) -> None:
        self.checkpoint = checkpoint
        self.coordinator._update(self.task_id, checkpoint_json=json.dumps(checkpoint))

    def mark_submitted(self, upstream_ref: str | None = None) -> None:
        """Record that a request may now exist upstream (call BEFORE sending).

        From here on a restart makes this task `interrupted`, not requeued.
        """
        self.coordinator._update(
            self.task_id, submitted_at=utcnow(), upstream_ref=upstream_ref
        )

    def report_progress(self, percent: float | None) -> None:
        """Only for progress the upstream actually reports; never simulate."""
        self.coordinator._update(self.task_id, progress_pct=percent)


Handler = Callable[[TaskContext], dict | None]
CANCEL_DB_INTERVAL = 2.0


@dataclass
class _Claim:
    task_id: str
    account_id: str | None
    context: TaskContext

    @property
    def kind(self) -> str:
        return self.context.kind


@dataclass
class TaskCoordinator:
    database: Database
    account_operations: AccountOperations
    max_workers: int = 2
    poll_interval: float = 1.0
    retry_delay: timedelta = timedelta(seconds=30)
    handlers: dict[str, Handler] = field(default_factory=dict)
    # Called after a task of that kind stops running, whatever the outcome.
    listeners: dict[str, Callable[[TaskContext], None]] = field(default_factory=dict)

    def __post_init__(self):
        self._wake = threading.Event()
        self._stopping = threading.Event()
        self._lock = threading.Lock()
        self._running = 0
        self._dispatcher: threading.Thread | None = None
        self._contexts: dict[str, TaskContext] = {}

    # -- lifecycle --------------------------------------------------------

    def register(
        self,
        kind: str,
        handler: Handler,
        on_settled: Callable[[TaskContext], None] | None = None,
    ) -> None:
        self.handlers[kind] = handler
        if on_settled is not None:
            self.listeners[kind] = on_settled

    def start(self) -> None:
        self.recover()
        self._stopping.clear()
        self._dispatcher = threading.Thread(
            target=self._dispatch_loop, name="task-dispatcher", daemon=True
        )
        self._dispatcher.start()

    def stop(self) -> None:
        """Stop claiming new tasks. Handler threads are daemons, so shutdown
        never waits for a long generation; anything still running is
        resolved by recover() on the next start."""
        self._stopping.set()
        self._wake.set()
        if self._dispatcher:
            self._dispatcher.join(timeout=2)

    def wake(self) -> None:
        self._wake.set()

    def notify_cancel(self, task_id: str) -> None:
        """Tell a running handler about a cancel request without a DB poll."""
        with self._lock:
            context = self._contexts.get(task_id)
        if context is not None:
            context.cancel_event.set()

    def recover(self) -> dict[str, int]:
        """Resolve tasks left `running` by a previous process."""
        now = utcnow()
        with self.database.sessions() as session:
            running = Task.status == "running"
            cancelled = session.execute(
                update(Task)
                .where(
                    Task.status.in_(("queued", "running")),
                    Task.cancel_requested.is_(True),
                )
                .values(status="cancelled", finished_at=now)
            ).rowcount
            interrupted = session.execute(
                update(Task)
                .where(running, Task.submitted_at.is_not(None))
                .values(
                    status="interrupted",
                    finished_at=now,
                    retryable=True,
                    suggested_action="retry",
                    error_code="interrupted",
                    error_message="The app stopped after this request was sent to Muse. Check the result before retrying.",
                )
            ).rowcount
            requeued = session.execute(
                update(Task)
                .where(running)
                .values(status="queued", started_at=None, progress_pct=None)
            ).rowcount
            session.commit()
        if cancelled or interrupted or requeued:
            logger.info(
                "Recovered tasks: %s cancelled, %s interrupted, %s requeued",
                cancelled,
                interrupted,
                requeued,
            )
        return {
            "cancelled": cancelled,
            "interrupted": interrupted,
            "requeued": requeued,
        }

    # -- dispatch ---------------------------------------------------------

    def _dispatch_loop(self) -> None:
        while not self._stopping.is_set():
            self._wake.clear()
            try:
                while not self._stopping.is_set() and self._free_slots() > 0:
                    claim = self._claim_next()
                    if claim is None:
                        break
                    with self._lock:
                        self._running += 1
                        self._contexts[claim.task_id] = claim.context
                    threading.Thread(
                        target=self._run,
                        args=(claim,),
                        name=f"task-{claim.kind}",
                        daemon=True,
                    ).start()
            except Exception:  # noqa: BLE001 - keep dispatching after a DB hiccup
                logger.exception("Task dispatcher error")
            self._wake.wait(self.poll_interval)

    def _free_slots(self) -> int:
        with self._lock:
            return self.max_workers - self._running

    def _claim_next(self) -> _Claim | None:
        now = utcnow()
        dependency = aliased(Task)
        with self.database.sessions() as session:
            candidates = session.execute(
                select(Task.id, Task.account_id, Task.requires_account)
                .outerjoin(dependency, Task.depends_on_id == dependency.id)
                .where(
                    Task.status == "queued",
                    or_(Task.run_after.is_(None), Task.run_after <= now),
                    # Sequential work (scene N waits for N-1). A failed or
                    # cancelled dependency keeps this task waiting.
                    or_(Task.depends_on_id.is_(None), dependency.status == "succeeded"),
                )
                .order_by(Task.created_at, Task.id)
            ).all()
            usable_accounts = (
                self._usable_accounts(session)
                if any(c.requires_account for c in candidates)
                else []
            )
            # End the read snapshot before writing: in WAL mode a transaction
            # that has read cannot start writing once another connection
            # committed meanwhile ("database is locked", no busy wait).
            session.rollback()
            for candidate in candidates:
                account_id = self._lock_account(candidate, usable_accounts)
                if account_id is False:
                    continue  # Account busy or none available: try later.
                try:
                    claim = self._claim(session, candidate, account_id, now)
                except Exception:
                    session.rollback()
                    if account_id:
                        self.account_operations.release(account_id)
                    raise
                if claim is not None:
                    return claim
                if account_id:
                    self.account_operations.release(account_id)
        return None

    def _claim(
        self, session, candidate, account_id: str | None, now: datetime
    ) -> _Claim | None:
        dependency = aliased(Task)
        claimed = session.execute(
            update(Task)
            .where(
                Task.id == candidate.id,
                Task.status == "queued",
                Task.cancel_requested.is_(False),
                or_(Task.run_after.is_(None), Task.run_after <= now),
                or_(
                    Task.depends_on_id.is_(None),
                    select(dependency.id)
                    .where(
                        dependency.id == Task.depends_on_id,
                        dependency.status == "succeeded",
                    )
                    .exists(),
                ),
            )
            .values(
                status="running",
                started_at=now,
                finished_at=None,
                attempts=Task.attempts + 1,
                account_id=account_id,
                error_code=None,
                error_message=None,
                suggested_action=None,
                progress_pct=None,
                # Each attempt starts with nothing sent upstream yet.
                submitted_at=None,
                upstream_ref=None,
            )
        ).rowcount
        if claimed != 1:
            session.rollback()  # Another claimer won, or it was cancelled.
            return None
        if candidate.requires_account and account_id:
            session.execute(
                update(Account).where(Account.id == account_id).values(last_used_at=now)
            )
        task = session.get(Task, candidate.id)
        context = TaskContext(
            coordinator=self,
            task_id=task.id,
            kind=task.kind,
            payload=json.loads(task.payload_json),
            checkpoint=json.loads(task.checkpoint_json),
            attempt=task.attempts,
            account_id=account_id,
            project_id=task.project_id,
            scene_number=task.scene_number,
        )
        session.commit()
        return _Claim(task.id, account_id, context)

    @staticmethod
    def _usable_accounts(session) -> list[str]:
        # Least recently used healthy accounts first.
        return list(
            session.scalars(
                select(Account.id)
                # Only sessions confirmed by Test/Keep alive; imported
                # (unverified) sessions are never picked automatically.
                .where(
                    Account.enabled.is_(True), Account.session_status == "valid"
                ).order_by(
                    Account.last_used_at.is_not(None),
                    Account.last_used_at,
                    Account.created_at,
                )
            )
        )

    def _lock_account(self, candidate, usable_accounts: list[str]) -> str | None | bool:
        """Lock the task's account. Returns the account ID, None when the
        task needs no account, or False when it cannot run yet."""
        if candidate.account_id:
            return (
                candidate.account_id
                if self.account_operations.try_acquire(candidate.account_id)
                else False
            )
        if not candidate.requires_account:
            return None
        for account_id in usable_accounts:
            if self.account_operations.try_acquire(account_id):
                return account_id
        return False

    # -- execution --------------------------------------------------------

    def _run(self, claim: _Claim) -> None:
        context = claim.context
        try:
            handler = self.handlers.get(context.kind)
            if handler is None:
                raise TaskFailure(
                    "unknown_kind", f"No handler for task kind {context.kind!r}."
                )
            # A step that finishes is kept even if cancel arrived meanwhile.
            result = handler(context)
            self._finish(
                context.task_id, "succeeded", result_json=json.dumps(result or {})
            )
        except TaskCancelled:
            self._finish(context.task_id, "cancelled")
        except TaskDeferred as deferred:
            # Not an attempt: give it back and try again later.
            self._update(
                context.task_id,
                status=case(
                    (Task.cancel_requested.is_(True), "cancelled"), else_="queued"
                ),
                finished_at=case(
                    (Task.cancel_requested.is_(True), utcnow()), else_=None
                ),
                started_at=None,
                attempts=Task.attempts - 1,
                run_after=utcnow() + timedelta(seconds=deferred.delay),
            )
        except TaskFailure as failure:
            self._fail(context, failure)
        except Exception as error:  # noqa: BLE001 - never leave a task running
            logger.exception("Task %s (%s) crashed", context.task_id, context.kind)
            self._fail(context, TaskFailure("internal_error", type(error).__name__))
        finally:
            if claim.account_id:
                self.account_operations.release(claim.account_id)
            with self._lock:
                self._running -= 1
                self._contexts.pop(context.task_id, None)
            listener = self.listeners.get(context.kind)
            if listener is not None:
                try:
                    listener(context)
                except Exception:  # noqa: BLE001 - a listener must not stop dispatch
                    logger.exception("Listener for task %s failed", context.task_id)
            self._wake.set()

    def _fail(self, context: TaskContext, failure: TaskFailure) -> None:
        fields = dict(
            error_code=failure.code,
            error_message=failure.message[:500] or None,
            retryable=failure.retryable,
            suggested_action=failure.suggested_action,
        )
        with self.database.sessions() as session:
            # Serialize the retry decision with cancellation (SQLite WAL).
            session.execute(
                text("UPDATE tasks SET status = status WHERE id = :id"),
                {"id": context.task_id},
            )
            task = session.get(Task, context.task_id)
            if task is None:
                return
            # `retryable` is the handler's statement that resending is safe
            # (the upstream request definitely failed). Unknown outcomes only
            # arise after a restart and are handled by recover().
            retry_automatically = (
                failure.retryable
                and task.attempts < task.max_attempts
                and not task.cancel_requested
            )
            now = utcnow()
            if retry_automatically:
                fields.update(
                    status="queued",
                    started_at=None,
                    run_after=now + self.retry_delay * context.attempt,
                )
            else:
                fields.update(
                    status="cancelled" if task.cancel_requested else "failed",
                    finished_at=now,
                )
            session.execute(
                update(Task)
                .where(Task.id == context.task_id)
                .values(updated_at=now, **fields)
            )
            session.commit()

    def _finish(self, task_id: str, status: str, **fields) -> None:
        self._update(task_id, status=status, finished_at=utcnow(), **fields)

    def _update(self, task_id: str, **fields) -> None:
        with self.database.sessions() as session:
            session.execute(
                update(Task)
                .where(Task.id == task_id)
                .values(updated_at=utcnow(), **fields)
            )
            session.commit()
