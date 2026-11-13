from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.accounts.refresher import SessionRefresher
from app.core.config import Settings
from app.integrations.muse.client import MuseError, SessionResult
from app.main import create_app
from app.models import Account


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(_env_file=None, data_dir=tmp_path))) as client:
        yield client


class Provider:
    """Stands in for Muse: rotates the workspace cookie to a far-future expiry."""

    def __init__(self, error=None):
        self.error = error
        self.calls = []

    def session(self, cookies, expiries, proxy, wake=False):
        self.calls.append(wake)
        if self.error:
            raise self.error
        return SessionResult(
            {**cookies, "hatch_vml": "rotated-fixture"},
            {"hatch_vml": 2000000000},
            "RUNNING",
        )


def utcnow():
    return datetime.now(UTC).replace(tzinfo=None)


def create_account(client, value="refresh-fixture", verified=True):
    account = client.post(
        "/api/accounts",
        json={"label": "My account", "cookieText": f"hatch_sess={value}"},
    ).json()
    if verified:
        assert client.post(f"/api/accounts/{account['id']}/test").json()["ok"]
    return account


def set_fields(client, account_id, **values):
    with client.app.state.database.engine.begin() as connection:
        connection.execute(
            update(Account).where(Account.id == account_id).values(**values)
        )


def refresher(client, hours=6):
    return SessionRefresher(client.app, timedelta(hours=hours))


def test_overdue_verified_session_is_rechecked_and_rotated_cookies_saved(client):
    client.app.state.muse_client = provider = Provider()
    account = create_account(client)
    old = utcnow() - timedelta(hours=7)
    set_fields(client, account["id"], last_checked_at=old, expires_at=None)
    provider.calls.clear()

    assert refresher(client).run_once() == 1

    assert provider.calls == [False]  # A session check, not a workspace wake.
    after = client.get(f"/api/accounts/{account['id']}").json()
    assert after["sessionStatus"] == "valid" and after["lastError"] is None
    assert after["expiresAt"] == "2033-05-18T03:33:20Z"
    assert datetime.fromisoformat(after["lastCheckedAt"]).replace(tzinfo=None) > old
    assert after["lastKeepaliveAt"] is None


def test_wake_option_runs_keep_alive(client):
    client.app.state.muse_client = provider = Provider()
    account = create_account(client)
    set_fields(client, account["id"], last_checked_at=utcnow() - timedelta(hours=7))
    provider.calls.clear()

    assert SessionRefresher(client.app, timedelta(hours=6), wake=True).run_once() == 1

    assert provider.calls == [True]
    assert client.get(f"/api/accounts/{account['id']}").json()["lastKeepaliveAt"]


def test_unverified_disabled_invalid_and_fresh_accounts_are_left_alone(client):
    client.app.state.muse_client = provider = Provider()
    old = utcnow() - timedelta(days=2)
    unverified = create_account(client, "unverified-fixture", verified=False)
    disabled = create_account(client, "disabled-fixture")
    invalid = create_account(client, "invalid-fixture")
    fresh = create_account(client, "fresh-fixture")
    set_fields(client, unverified["id"], last_checked_at=old)
    set_fields(client, disabled["id"], last_checked_at=old, enabled=False)
    set_fields(client, invalid["id"], last_checked_at=old, session_status="invalid")
    provider.calls.clear()

    assert refresher(client).run_once() == 0

    assert provider.calls == []
    assert client.get(f"/api/accounts/{fresh['id']}").json()["sessionStatus"] == "valid"


def test_session_expiring_before_the_next_check_is_rechecked_early(client):
    client.app.state.muse_client = provider = Provider()
    account = create_account(client)
    now = utcnow()
    set_fields(
        client,
        account["id"],
        last_checked_at=now - timedelta(minutes=40),
        expires_at=now + timedelta(hours=2),
    )
    provider.calls.clear()
    job = refresher(client)

    assert job.run_once() == 1
    # Checked moments ago: nothing more to do until the retry gap passes.
    assert job.run_once() == 0
    assert len(provider.calls) == 1


def test_recent_check_of_expiring_session_waits_for_the_retry_gap(client):
    client.app.state.muse_client = provider = Provider()
    account = create_account(client)
    now = utcnow()
    set_fields(
        client,
        account["id"],
        last_checked_at=now - timedelta(minutes=10),
        expires_at=now + timedelta(hours=2),
    )
    provider.calls.clear()

    assert refresher(client).run_once() == 0
    assert provider.calls == []


def test_rejected_session_is_marked_invalid_and_not_retried(client):
    client.app.state.muse_client = Provider()
    account = create_account(client)
    set_fields(client, account["id"], last_checked_at=utcnow() - timedelta(hours=7))
    client.app.state.muse_client = provider = Provider(
        error=MuseError("session_invalid", 401)
    )
    job = refresher(client)

    assert job.run_once() == 1
    after = client.get(f"/api/accounts/{account['id']}").json()
    assert after["sessionStatus"] == "invalid"
    assert after["lastError"] == "session_invalid"
    assert job.run_once(utcnow() + timedelta(days=1)) == 0
    assert len(provider.calls) == 1


def test_busy_account_is_skipped_then_checked_on_the_next_round(client):
    client.app.state.muse_client = provider = Provider()
    account = create_account(client)
    set_fields(client, account["id"], last_checked_at=utcnow() - timedelta(hours=7))
    provider.calls.clear()
    job = refresher(client)

    with client.app.state.account_operations.acquire(account["id"]):
        assert job.run_once() == 0
    assert provider.calls == []
    assert job.run_once() == 1


def test_unsaved_check_does_not_hit_muse_again_within_the_retry_gap(client):
    client.app.state.muse_client = Provider()
    account = create_account(client)
    set_fields(client, account["id"], last_checked_at=utcnow() - timedelta(hours=7))

    class Unexpected(Provider):
        def session(self, *args, **kwargs):
            self.calls.append(None)
            raise RuntimeError("unexpected upstream failure")

    client.app.state.muse_client = provider = Unexpected()
    job = refresher(client)
    now = utcnow()

    assert job.run_once(now) == 0
    assert job.run_once(now + timedelta(minutes=5)) == 0
    assert len(provider.calls) == 1
    assert job.run_once(now + timedelta(minutes=31)) == 0
    assert len(provider.calls) == 2


def test_refresher_runs_with_the_app_and_can_be_disabled(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path / "on")
    with TestClient(create_app(settings)) as client:
        thread = client.app.state.session_refresher._thread
        assert thread is not None and thread.is_alive()
    assert not thread.is_alive()

    settings = Settings(
        _env_file=None, data_dir=tmp_path / "off", session_refresh_minutes=0
    )
    with TestClient(create_app(settings)) as client:
        assert client.app.state.session_refresher._thread is None
