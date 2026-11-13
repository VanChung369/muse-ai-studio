import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.main import create_app
from app.models import Account
from app.integrations.muse.client import MuseError, SessionResult


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(_env_file=None, data_dir=tmp_path))) as client:
        yield client


def create_account(client, value="operation-fixture"):
    return client.post(
        "/api/accounts",
        json={"label": "My account", "cookieText": f"hatch_sess={value}"},
    ).json()


class Provider:
    def __init__(self, error=None, quota=None, running=True):
        self.error, self.usage, self.running = error, quota, running
        self.calls = []

    def session(self, cookies, expiries, proxy, wake=False):
        self.calls.append((dict(cookies), proxy, wake))
        if self.error:
            raise self.error
        return SessionResult(
            {**cookies, "hatch_vml": "rotated-fixture"},
            {"hatch_vml": 2000000000},
            "RUNNING" if self.running else "STOPPED",
            code=(
                "keepalive_complete"
                if wake and self.running
                else "workspace_not_running" if wake else "session_valid"
            ),
            ok=self.running or not wake,
        )

    def quota(self, cookies, expiries, proxy):
        result = self.session(cookies, expiries, proxy)
        result.quota = self.usage
        result.code = "quota_updated"
        return result


def test_cookie_expiry_notes_and_public_fields(client):
    expiry = int((datetime.now(UTC) + timedelta(days=2)).timestamp())
    account = client.post(
        "/api/accounts",
        json={
            "label": "Account",
            "cookieText": json.dumps(
                [
                    {
                        "name": "hatch_sess",
                        "value": "fixture",
                        "expirationDate": expiry + 1000,
                    },
                    {
                        "name": "hatch_vml",
                        "value": "workspace",
                        "expirationDate": expiry,
                    },
                ]
            ),
        },
    ).json()
    assert account["expiresAt"] == datetime.fromtimestamp(
        expiry, UTC
    ).isoformat().replace("+00:00", "Z")
    path = f"/api/accounts/{account['id']}"
    saved = client.patch(
        path, json={"notes": " Personal account\nKeep for videos. "}
    ).json()
    assert saved["notes"] == "Personal account\nKeep for videos."
    assert client.patch(path, json={"notes": "x" * 2001}).status_code == 422
    assert client.get(path).json() == saved


def test_successful_test_keepalive_quota_persist_real_fields(client):
    account = create_account(client)
    provider = Provider(
        quota={"plan": "Free plan", "weekly_used_pct": 37, "weekly_reset": "Monday"}
    )
    client.app.state.muse_client = provider
    path = f"/api/accounts/{account['id']}"
    checked = client.post(path + "/test").json()
    assert checked["ok"] and checked["account"]["sessionStatus"] == "valid"
    assert checked["account"]["expiresAt"] and checked["account"]["lastCheckedAt"]
    assert checked["account"]["lastUsedAt"] is None
    alive = client.post(path + "/keep-alive").json()
    assert alive["code"] == "keepalive_complete" and alive["account"]["lastKeepaliveAt"]
    quota = client.post(path + "/quota").json()["account"]
    assert quota["quota"]["weeklyUsedPct"] == 37 and quota["quotaCheckedAt"]
    assert quota["lastUsedAt"] is None
    assert client.get(path).json() == quota
    assert "rotated-fixture" not in json.dumps(quota)


@pytest.mark.parametrize(
    "code,status",
    [
        ("session_invalid", 401),
        ("access_denied", 502),
        ("network_error", 502),
        ("upstream_timeout", 504),
        ("rate_limited", 502),
        ("quota_unavailable", 502),
    ],
)
def test_failures_preserve_health_and_quota_except_auth_failure(client, code, status):
    account = create_account(client)
    path = f"/api/accounts/{account['id']}"
    client.app.state.muse_client = Provider(quota={"weekly_used_pct": 25})
    before = client.post(path + "/quota").json()["account"]
    client.app.state.muse_client = Provider(error=MuseError(code, status))
    response = client.post(path + "/test")
    assert response.status_code == (200 if code == "session_invalid" else status)
    after = client.get(path).json()
    assert after["sessionStatus"] == (
        "invalid" if code == "session_invalid" else "valid"
    )
    assert (
        after["quota"] == before["quota"]
        and after["quotaCheckedAt"] == before["quotaCheckedAt"]
    )
    assert after["lastError"] == code


def test_keepalive_acknowledgment_is_not_running_confirmation(client):
    account = create_account(client)
    client.app.state.muse_client = Provider(running=False)
    result = client.post(f"/api/accounts/{account['id']}/keep-alive").json()
    assert not result["ok"] and result["code"] == "workspace_not_running"
    assert result["account"]["sessionStatus"] == "valid"


def test_cookie_replacement_keeps_identity_and_rejects_duplicates(client):
    account = create_account(client)
    other = create_account(client, "other-fixture")
    path = f"/api/accounts/{account['id']}"
    client.app.state.muse_client = Provider(quota={"weekly_used_pct": 10})
    client.patch(path, json={"notes": "Preserve this", "enabled": False})
    client.post(path + "/quota")
    response = client.put(
        path + "/cookies", json={"cookieText": "hatch_sess=replacement-fixture"}
    )
    assert response.status_code == 200
    updated = response.json()
    assert updated["id"] == account["id"] and updated["label"] == account["label"]
    assert updated["notes"] == "Preserve this" and not updated["enabled"]
    assert updated["sessionStatus"] == "unverified" and updated["quota"] is None
    assert updated["expiresAt"] is None and updated["lastCheckedAt"] is None
    assert (
        client.put(
            path + "/cookies", json={"cookieText": "hatch_sess=other-fixture"}
        ).status_code
        == 409
    )
    assert client.get(path).json() == updated
    assert "replacement-fixture" not in json.dumps(updated)


def test_proxy_credentials_are_encrypted_preserved_and_used(client):
    account = create_account(client)
    path = f"/api/accounts/{account['id']}"
    proxy = {
        "server": "http://127.0.0.1:7890",
        "username": "user",
        "password": "proxy-secret-fixture",
    }
    response = client.put(path + "/proxy", json={"proxy": proxy})
    assert response.status_code == 200 and "proxy-secret-fixture" not in response.text
    assert response.json()["proxy"] == {
        "server": proxy["server"],
        "username": "user",
        "hasPassword": True,
    }
    provider = Provider()
    client.app.state.muse_client = provider
    client.post(path + "/test")
    assert provider.calls[-1][1] == proxy
    response = client.put(
        path + "/proxy", json={"proxy": {"server": proxy["server"], "username": "user"}}
    )
    assert (
        response.status_code == 200 and response.json()["sessionStatus"] == "unverified"
    )
    client.post(path + "/test")
    assert provider.calls[-1][1]["password"] == "proxy-secret-fixture"
    assert (
        client.put(
            path + "/proxy",
            json={"proxy": {"server": "http://other.example:7890", "username": "user"}},
        ).status_code
        == 422
    )
    assert client.put(path + "/proxy", json={"proxy": None}).json()["proxy"] is None
    client.post(path + "/test")
    assert provider.calls[-1][1] is None


def test_account_busy_blocks_remote_cookie_proxy_and_delete(client):
    account = create_account(client)
    path = f"/api/accounts/{account['id']}"
    with client.app.state.account_operations.acquire(account["id"]):
        assert client.post(path + "/test").status_code == 409
        assert client.post(path + "/quota").status_code == 409
        assert (
            client.put(
                path + "/cookies", json={"cookieText": "hatch_sess=new-fixture"}
            ).status_code
            == 409
        )
        assert client.put(path + "/proxy", json={"proxy": None}).status_code == 409
        assert client.delete(path).status_code == 409
    assert client.get(path).json() == account


def test_stale_remote_result_does_not_overwrite_credentials(client):
    account = create_account(client)
    path = f"/api/accounts/{account['id']}"

    class ConcurrentProvider(Provider):
        def session(self, *args, **kwargs):
            with client.app.state.database.engine.begin() as connection:
                from sqlalchemy import update

                connection.execute(
                    update(Account)
                    .where(Account.id == account["id"])
                    .values(credential_version=99)
                )
            return super().session(*args, **kwargs)

    client.app.state.muse_client = ConcurrentProvider()
    assert client.post(path + "/test").status_code == 409
    after = client.get(path).json()
    assert after["credentialVersion"] == 99 and after["sessionStatus"] == "unverified"
