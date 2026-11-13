"""Run with MUSE_SIMULATION_URL after starting the committed Postman simulation."""

import os

import pytest
import requests
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

SIMULATION = os.environ.get("MUSE_SIMULATION_URL")


@pytest.mark.skipif(
    not SIMULATION,
    reason="Start the Muse Postman simulation and set MUSE_SIMULATION_URL.",
)
def test_account_operations_against_real_http_and_browser(tmp_path):
    def control(mode):
        assert (
            requests.post(
                SIMULATION + "/__control", json={"mode": mode}, timeout=5
            ).status_code
            == 200
        )

    control("healthy")
    with TestClient(
        create_app(
            Settings(
                _env_file=None,
                data_dir=tmp_path,
                upstream_url=SIMULATION,
                upstream_timeout=0.3,
            )
        )
    ) as client:
        created = client.post(
            "/api/accounts",
            json={
                "label": "Simulated account",
                "cookieText": "hatch_sess=simulation-only-fixture",
            },
        ).json()
        path = f"/api/accounts/{created['id']}"
        response = client.post(path + "/test")
        assert response.status_code == 200, response.text
        assert response.json()["ok"] and response.json()["account"]["expiresAt"]
        alive = client.post(path + "/keep-alive").json()
        assert alive["ok"] and alive["vmState"] == "RUNNING"
        quota = client.post(path + "/quota")
        assert quota.status_code == 200, quota.text
        cached = quota.json()["account"]
        assert (
            cached["quota"]["weeklyUsedPct"] == 37
            and cached["quota"]["plan"] == "Free plan"
        )
        assert cached["lastUsedAt"] is None
        for mode, code, status in [
            ("forbidden", "access_denied", 502),
            ("rate-limit", "rate_limited", 502),
            ("html", "invalid_response", 502),
            ("timeout", "upstream_timeout", 504),
        ]:
            control(mode)
            failure = client.post(path + "/test")
            assert failure.status_code == status, failure.text
            assert failure.json()["detail"]["code"] == code
            after = client.get(path).json()
            assert (
                after["sessionStatus"] == "valid" and after["quota"] == cached["quota"]
            )
        control("wake-pending")
        alive = client.post(path + "/keep-alive").json()
        assert not alive["ok"] and alive["code"] == "workspace_not_running"
        control("invalid")
        invalid = client.post(path + "/test").json()
        assert not invalid["ok"] and invalid["account"]["sessionStatus"] == "invalid"
        assert invalid["account"]["quota"] == cached["quota"]
        control("healthy")
        assert (
            client.put(
                path + "/proxy", json={"proxy": {"server": "http://127.0.0.1:9"}}
            ).status_code
            == 200
        )
        failure = client.post(path + "/test")
        assert (
            failure.status_code == 502
            and failure.json()["detail"]["code"] == "proxy_error"
        )
        assert client.get(path).json()["sessionStatus"] == "unverified"
        assert client.put(path + "/proxy", json={"proxy": None}).status_code == 200
        assert client.post(path + "/test").json()["account"]["sessionStatus"] == "valid"
        # Confirm both the server client and browser actually traversed the fixture.
        calls = requests.get(SIMULATION + "/__stats", timeout=5).json()
        assert any(
            call["path"] == "/api/session" and call["hasSession"] for call in calls
        )
        assert any(
            call["path"] == "/api/hatch/vm/wake" and call["method"] == "POST"
            for call in calls
        )
        assert any(
            call["path"] == "/thread/new" and call["hasSession"] for call in calls
        )
