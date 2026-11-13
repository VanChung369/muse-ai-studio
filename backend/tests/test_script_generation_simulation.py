"""Optional real HTTP/Chromium checks against the committed planner fixture."""

import os
import time

import pytest
import requests
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.core.config import Settings
from app.main import create_app
from app.models import Account

ORIGIN = os.environ.get("MUSE_PLANNING_SIMULATION_URL")


def terminal(client, task_id, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        task = client.get("/api/tasks/" + task_id).json()
        if task["status"] in ("succeeded", "failed", "cancelled"):
            return task
        time.sleep(0.1)
    raise AssertionError("Generation task did not finish")


@pytest.mark.skipif(not ORIGIN, reason="Start the Muse planning Postman simulation.")
def test_real_composer_proposal_apply_invalid_reply_and_cancel(tmp_path):
    with TestClient(
        create_app(
            Settings(
                _env_file=None,
                data_dir=tmp_path,
                upstream_url=ORIGIN,
                planning_timeout=20,
            )
        )
    ) as client:
        account = client.post(
            "/api/accounts",
            json={
                "label": "Fixture account",
                "cookieText": "hatch_sess=simulation-planner-fixture",
            },
        ).json()
        with client.app.state.database.engine.begin() as connection:
            connection.execute(
                update(Account)
                .where(Account.id == account["id"])
                .values(session_status="valid")
            )
        project = client.post(
            "/api/projects",
            json={
                "name": "Coffee film",
                "idea": "A farmer at sunrise",
                "durationSeconds": 15,
            },
        ).json()
        path = f"/api/projects/{project['id']}"

        def start(revision):
            return client.post(
                path + "/script-generation",
                json={
                    "accountId": account["id"],
                    "idea": project["idea"],
                    "expectedRevision": revision,
                },
            ).json()["id"]

        assert (
            requests.post(ORIGIN + "/__control", json={"mode": "healthy"}).status_code
            == 200
        )
        task = terminal(client, start(0))
        assert task["status"] == "succeeded", task
        assert client.get(path).json()["scenes"] == []
        assert [
            scene["durationSeconds"] for scene in task["result"]["script"]["scenes"]
        ] == [10, 5]
        assert requests.get(ORIGIN + "/__stats").json()["sent"] == 1
        saved = client.put(path + "/script", json=task["result"]["script"]).json()
        assert saved["sceneCount"] == 2 and saved["scriptRevision"] == 1
        requests.post(ORIGIN + "/__control", json={"mode": "invalid"})
        invalid = terminal(client, start(1))
        assert (
            invalid["status"] == "failed"
            and invalid["error"]["code"] == "invalid_script"
        ), invalid
        assert client.get(path).json()["scenes"] == saved["scenes"]
        assert requests.get(ORIGIN + "/__stats").json()["sent"] == 1
        requests.post(ORIGIN + "/__control", json={"mode": "slow"})
        task_id = start(1)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if client.get("/api/tasks/" + task_id).json()["submitted"]:
                break
            time.sleep(0.1)
        else:
            raise AssertionError("Message was never submitted")
        assert client.post("/api/tasks/" + task_id + "/cancel").status_code == 200
        stopped = terminal(client, task_id)
        assert stopped["status"] == "cancelled"
        assert client.get(path).json()["scenes"] == saved["scenes"]
