import threading
import time
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.core.config import Settings
from app.main import create_app
from app.models import Account, Task
from app.repositories import tasks as task_repo
from app.tasks.coordinator import TaskCancelled, TaskDeferred, TaskFailure, utcnow


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, data_dir=tmp_path)


def make_app(settings, **handlers):
    app = create_app(settings)
    coordinator = app.state.task_coordinator
    coordinator.poll_interval = 0.02
    coordinator.retry_delay = coordinator.retry_delay * 0
    for kind, handler in handlers.items():
        coordinator.register(kind, handler)
    return app


def add_task(client, **fields):
    with client.app.state.database.sessions() as session:
        task = task_repo.create_task(
            session, **{"kind": "demo", "title": "Demo task", **fields}
        )
        session.commit()
        task_id = task.id
    client.app.state.task_coordinator.wake()
    return task_id


def wait_for(client, task_id, *statuses, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        task = client.get(f"/api/tasks/{task_id}").json()
        if task["status"] in statuses:
            return task
        time.sleep(0.02)
    raise AssertionError(f"task stayed {task['status']}, expected {statuses}")


def import_account(client, label, value, verified=True):
    """Import an account; by default mark its session valid (as Test would),
    since the coordinator only picks confirmed sessions automatically."""
    account = client.post(
        "/api/accounts", json={"label": label, "cookieText": f"hatch_sess={value}"}
    ).json()
    if verified:
        with client.app.state.database.sessions() as session:
            session.execute(
                update(Account).where(Account.id == account["id"]).values(session_status="valid")
            )
            session.commit()
    return account


def test_task_runs_and_records_result(settings):
    seen = []

    def demo(ctx):
        seen.append((ctx.payload, ctx.attempt))
        ctx.save_checkpoint({"step": 1})
        return {"mediaId": "m-1"}

    with TestClient(make_app(settings, demo=demo)) as client:
        task_id = add_task(client, payload={"prompt": "hello"})
        task = wait_for(client, task_id, "succeeded")
        assert seen == [({"prompt": "hello"}, 1)]
        assert task["result"] == {"mediaId": "m-1"} and task["attempts"] == 1
        assert (
            task["startedAt"].endswith("Z")
            and task["finishedAt"]
            and task["error"] is None
        )


def test_dependent_tasks_run_in_order(settings):
    order, gate = [], threading.Event()

    def demo(ctx):
        if ctx.scene_number == 1:
            gate.wait(2)
        order.append(ctx.scene_number)

    with TestClient(make_app(settings, demo=demo)) as client:
        first = add_task(client, scene_number=1)
        second = add_task(client, scene_number=2, depends_on_id=first)
        time.sleep(0.2)
        assert (
            client.get(f"/api/tasks/{second}").json()["status"] == "queued"
        )  # Waits for scene 1.
        gate.set()
        wait_for(client, second, "succeeded")
        assert order == [1, 2]


def test_failure_needs_attention_with_suggested_action(settings):
    def demo(ctx):
        raise TaskFailure(
            "session_invalid", "Login expired.", suggested_action="relogin"
        )

    with TestClient(make_app(settings, demo=demo)) as client:
        task_id = add_task(client)
        task = wait_for(client, task_id, "failed")
        assert task["error"] == {"code": "session_invalid", "message": "Login expired."}
        assert task["suggestedAction"] == "relogin" and task["retryable"] is False
        listed = client.get("/api/tasks", params={"status": "attention"}).json()
        assert [item["id"] for item in listed["items"]] == [task_id]
        assert listed["counts"]["attention"] == 1
        assert client.get("/api/tasks/summary").json()["attention"] == 1


def test_retryable_failures_retry_up_to_max_attempts(settings):
    calls = []

    def demo(ctx):
        calls.append(ctx.attempt)
        if ctx.attempt < 2:
            raise TaskFailure("rate_limited", retryable=True)
        return {"ok": True}

    def always(ctx):
        raise TaskFailure("rate_limited", retryable=True)

    with TestClient(make_app(settings, demo=demo, always=always)) as client:
        task = wait_for(client, add_task(client, max_attempts=3), "succeeded")
        assert calls == [1, 2] and task["attempts"] == 2
        exhausted = wait_for(
            client, add_task(client, kind="always", max_attempts=2), "failed"
        )
        assert exhausted["attempts"] == 2 and exhausted["retryable"] is True


def test_cancel_queued_now_and_running_after_current_step(settings):
    started, release = threading.Event(), threading.Event()

    def demo(ctx):
        started.set()
        release.wait(2)
        ctx.raise_if_cancelled()  # Between steps.
        return {"next": "step"}

    with TestClient(make_app(settings, demo=demo)) as client:
        client.app.state.task_coordinator.max_workers = 1
        running = add_task(client)
        assert started.wait(2)
        queued = add_task(client)
        assert (
            client.post(f"/api/tasks/{queued}/cancel").json()["status"] == "cancelled"
        )
        cancelling = client.post(f"/api/tasks/{running}/cancel").json()
        assert (
            cancelling["status"] == "running" and cancelling["cancelRequested"] is True
        )
        release.set()
        assert wait_for(client, running, "cancelled")["finishedAt"]
        response = client.post(f"/api/tasks/{running}/cancel")
        assert (
            response.status_code == 409
            and response.json()["detail"]["code"] == "task_finished"
        )


def test_account_tasks_lock_their_account(settings):
    active, peak, lock = [0], [0], threading.Lock()

    def demo(ctx):
        with lock:
            active[0] += 1
            peak[0] = max(peak[0], active[0])
        time.sleep(0.15)
        with lock:
            active[0] -= 1
        return {"account": ctx.account_id}

    with TestClient(make_app(settings, demo=demo)) as client:
        account = import_account(client, "Only", "one")
        ids = [add_task(client, account_id=account["id"]) for _ in range(3)]
        for task_id in ids:
            wait_for(client, task_id, "succeeded")
        assert peak[0] == 1  # Never two tasks on one account.
        # An account check holding the lock blocks generation too.
        operations = client.app.state.account_operations
        assert operations.try_acquire(account["id"])
        blocked = add_task(client, account_id=account["id"])
        time.sleep(0.2)
        assert client.get(f"/api/tasks/{blocked}").json()["status"] == "queued"
        operations.release(account["id"])
        client.app.state.task_coordinator.wake()
        wait_for(client, blocked, "succeeded")


def test_requires_account_picks_a_usable_account(settings):
    def demo(ctx):
        return {"account": ctx.account_id}

    with TestClient(make_app(settings, demo=demo)) as client:
        disabled = import_account(client, "Disabled", "d")
        client.patch(f"/api/accounts/{disabled['id']}", json={"enabled": False})
        waiting = add_task(client, requires_account=True)
        time.sleep(0.2)
        assert (
            client.get(f"/api/tasks/{waiting}").json()["status"] == "queued"
        )  # None usable yet.
        usable = import_account(client, "Usable", "u")
        client.app.state.task_coordinator.wake()
        task = wait_for(client, waiting, "succeeded")
        assert task["accountId"] == usable["id"] and task["accountLabel"] == "Usable"
        assert (
            client.get(f"/api/accounts/{usable['id']}").json()["lastUsedAt"] is not None
        )


def test_restart_recovery_never_resends_submitted_work(settings):
    with TestClient(make_app(settings)) as client:
        client.app.state.task_coordinator.stop()  # Keep tasks where we put them.
        ids = {
            name: add_task(client, title=name)
            for name in ("fresh", "submitted", "cancelling")
        }
        with client.app.state.database.sessions() as session:
            session.execute(update(Task).values(status="running", started_at=utcnow()))
            session.execute(
                update(Task)
                .where(Task.id == ids["submitted"])
                .values(submitted_at=utcnow())
            )
            session.execute(
                update(Task)
                .where(Task.id == ids["cancelling"])
                .values(cancel_requested=True)
            )
            session.commit()
    ran = []
    with TestClient(
        make_app(settings, demo=lambda ctx: ran.append(ctx.task_id))
    ) as client:
        assert wait_for(
            client, ids["fresh"], "succeeded"
        )  # Nothing was sent: safe to requeue.
        interrupted = client.get(f"/api/tasks/{ids['submitted']}").json()
        assert (
            interrupted["status"] == "interrupted" and interrupted["submitted"] is True
        )
        assert (
            interrupted["error"]["code"] == "interrupted"
            and interrupted["suggestedAction"] == "retry"
        )
        assert (
            client.get(f"/api/tasks/{ids['cancelling']}").json()["status"]
            == "cancelled"
        )
        assert ran == [ids["fresh"]]

        # Resending an interrupted task needs explicit confirmation.
        response = client.post(f"/api/tasks/{ids['submitted']}/retry")
        assert (
            response.status_code == 409
            and response.json()["detail"]["code"] == "confirm_required"
        )
        retried = client.post(
            f"/api/tasks/{ids['submitted']}/retry", json={"confirmDuplicate": True}
        ).json()
        assert retried["status"] in ("queued", "running", "succeeded")
        wait_for(client, ids["submitted"], "succeeded")


def test_retry_resets_attempts_and_can_switch_account(settings):
    fail = [True]

    def demo(ctx):
        if fail[0]:
            raise TaskFailure("access_denied", suggested_action="switch_account")
        return {"account": ctx.account_id}

    with TestClient(make_app(settings, demo=demo)) as client:
        first = import_account(client, "First", "a")
        second = import_account(client, "Second", "b")
        task_id = add_task(client, account_id=first["id"], requires_account=True)
        wait_for(client, task_id, "failed")
        assert (
            client.post(f"/api/tasks/{task_id}/retry", json={"bogus": True}).status_code
            == 422
        )
        fail[0] = False
        client.post(f"/api/tasks/{task_id}/retry", json={"switchAccount": True})
        task = wait_for(client, task_id, "succeeded")
        assert (
            task["attempts"] == 1 and task["accountId"] == second["id"]
        )  # Least recently used.
        response = client.post(f"/api/tasks/{task_id}/retry")
        assert (
            response.status_code == 409
            and response.json()["detail"]["code"] == "task_not_retryable"
        )


def test_unknown_kind_and_crashes_fail_instead_of_hanging(settings):
    def crash(ctx):
        raise RuntimeError("secret detail must not leak")

    with TestClient(make_app(settings, crash=crash)) as client:
        unknown = wait_for(client, add_task(client, kind="nope"), "failed")
        assert unknown["error"]["code"] == "unknown_kind"
        crashed = wait_for(client, add_task(client, kind="crash"), "failed")
        assert crashed["error"] == {"code": "internal_error", "message": "RuntimeError"}


def test_list_pagination_filters_and_errors(settings):
    with TestClient(make_app(settings)) as client:
        client.app.state.task_coordinator.stop()
        ids = [add_task(client, title=f"Task {index}") for index in range(5)]
        # Tasks created within one clock tick share created_at and fall back
        # to the ID tie-break; space them out so "newest first" is defined.
        start = utcnow()
        with client.app.state.database.engine.begin() as connection:
            for index, task_id in enumerate(ids):
                connection.execute(
                    update(Task)
                    .where(Task.id == task_id)
                    .values(created_at=start + timedelta(seconds=index))
                )
        first = client.get("/api/tasks", params={"limit": 2}).json()
        assert first["total"] == 5 and len(first["items"]) == 2 and first["nextCursor"]
        names, cursor = [], None
        while True:
            page = client.get(
                "/api/tasks",
                params={"limit": 2, **({"cursor": cursor} if cursor else {})},
            ).json()
            names += [item["id"] for item in page["items"]]
            cursor = page["nextCursor"]
            if not cursor:
                break
        assert names == list(reversed(ids))
        assert first["counts"] == {
            "all": 5,
            "running": 0,
            "queued": 5,
            "attention": 0,
            "succeeded": 0,
            "cancelled": 0,
        }
        assert client.get("/api/tasks", params={"cursor": "bad!"}).status_code == 400
        assert client.get("/api/tasks", params={"status": "weird"}).status_code == 422
        assert client.get("/api/tasks/missing").status_code == 404
        assert client.post("/api/tasks/missing/cancel").status_code == 404


def test_unverified_accounts_are_not_picked_automatically(settings):
    with TestClient(make_app(settings, demo=lambda ctx: {"account": ctx.account_id})) as client:
        import_account(client, "Unverified", "u", verified=False)
        waiting = add_task(client, requires_account=True)
        time.sleep(0.2)
        assert client.get(f"/api/tasks/{waiting}").json()["status"] == "queued"


def test_deleting_an_account_fails_its_queued_tasks(settings):
    with TestClient(make_app(settings)) as client:
        client.app.state.task_coordinator.stop()
        account = import_account(client, "Gone", "g")
        task_id = add_task(client, account_id=account["id"], requires_account=True)
        assert client.delete(f"/api/accounts/{account['id']}").status_code == 204
        task = client.get(f"/api/tasks/{task_id}").json()
        assert task["status"] == "failed" and task["error"]["code"] == "account_deleted"
        assert task["suggestedAction"] == "switch_account" and task["retryable"] is True


def test_deferred_task_requeues_without_spending_an_attempt(settings):
    calls = []

    def demo(ctx):
        calls.append(ctx.attempt)
        if len(calls) == 1:
            raise TaskDeferred("browser_busy", delay=0)
        return {"ok": True}

    with TestClient(make_app(settings, demo=demo)) as client:
        task = wait_for(client, add_task(client), "succeeded")
        assert calls == [1, 1] and task["attempts"] == 1


def test_cancel_reaches_a_polling_handler_without_db_polling(settings):
    started = threading.Event()
    checks = []

    def demo(ctx):
        started.set()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            checks.append(1)
            ctx.raise_if_cancelled()
            time.sleep(0.01)

    with TestClient(make_app(settings, demo=demo)) as client:
        task_id = add_task(client)
        assert started.wait(2)
        started_at = time.monotonic()
        client.post(f"/api/tasks/{task_id}/cancel")
        wait_for(client, task_id, "cancelled")
        assert time.monotonic() - started_at < 1  # Event, not the 2 s DB interval.


def test_shutdown_does_not_wait_for_running_handlers(settings):
    release = threading.Event()

    def slow(ctx):
        release.wait(10)

    client = TestClient(make_app(settings, slow=slow))
    with client:
        task_id = add_task(client, kind="slow")
        wait_for(client, task_id, "running")
        stopped_at = time.monotonic()
    # Daemon workers: leaving the app (lifespan shutdown) did not wait for it.
    # Recovery of what was left running is covered by the restart test.
    assert time.monotonic() - stopped_at < 3
    release.set()


def test_accounts_report_their_running_tasks(settings):
    release = threading.Event()

    def slow(ctx):
        release.wait(10)

    with TestClient(make_app(settings, slow=slow)) as client:
        busy = import_account(client, "Busy", "busy-fixture")
        idle = import_account(client, "Idle", "idle-fixture")
        task_id = add_task(
            client, kind="slow", requires_account=True, account_id=busy["id"]
        )
        wait_for(client, task_id, "running")
        add_task(client, kind="slow", requires_account=True, account_id=busy["id"])

        def running():
            listed = client.get("/api/accounts").json()["items"]
            return {item["id"]: item["runningTasks"] for item in listed}

        # The second task is queued behind the first: only running ones count.
        assert running() == {busy["id"]: 1, idle["id"]: 0}
        assert client.get(f"/api/accounts/{busy['id']}").json()["runningTasks"] == 1
        client.post(f"/api/tasks/{task_id}/cancel")
        release.set()
        wait_for(client, task_id, "cancelled", "succeeded")
