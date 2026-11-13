import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.integrations.muse.client import SessionResult
from app.main import create_app
from app.planning.script import build_script_prompt, parse_script_reply, scene_timeline


def proposal(duration=15):
    return {
        "characterBible": "A farmer in a blue jacket.",
        "visualStyle": "Warm cinematic light.",
        "scenes": [
            {
                "number": index + 1,
                "title": f"Scene {index+1}",
                "prompt": "A quiet cinematic scene.",
                "durationSeconds": seconds,
                "narration": "",
            }
            for index, seconds in enumerate(scene_timeline(duration))
        ],
    }


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(_env_file=None, data_dir=tmp_path))) as client:
        yield client


def setup(client):
    account = client.post(
        "/api/accounts",
        json={"label": "Planner", "cookieText": "hatch_sess=planning-test-fixture"},
    ).json()
    client.patch(f"/api/accounts/{account['id']}", json={"enabled": True})
    from sqlalchemy import update
    from app.models import Account

    with client.app.state.database.engine.begin() as connection:
        connection.execute(
            update(Account)
            .where(Account.id == account["id"])
            .values(session_status="valid")
        )
    project = client.post(
        "/api/projects",
        json={
            "name": "Film",
            "idea": "A farmer greets the sunrise.",
            "durationSeconds": 15,
        },
    ).json()
    return account, project


def wait_task(client, task_id, target=("succeeded", "failed", "cancelled")):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        response = client.get("/api/tasks/" + task_id).json()
        if response["status"] in target:
            return response
        time.sleep(0.05)
    raise AssertionError("Task did not reach expected state")


def fake_generate(*args, **kwargs):
    result = SessionResult({"hatch_sess": "planning-test-fixture"}, {}, "RUNNING")
    kwargs["on_session"](result)
    kwargs["before_send"](result)
    return json.dumps(proposal())


def test_generate_persist_proposal_then_apply(client, monkeypatch):
    monkeypatch.setattr("app.planning.tasks.generate_script_text", fake_generate)
    account, project = setup(client)
    path = f"/api/projects/{project['id']}"
    assert client.get(path + "/script-generation").json() is None
    response = client.post(
        path + "/script-generation",
        json={
            "accountId": account["id"],
            "idea": project["idea"],
            "expectedRevision": 0,
        },
    )
    assert response.status_code == 202, response.text
    result = wait_task(client, response.json()["id"])
    assert result["status"] == "succeeded" and result["submitted"]
    assert result["result"]["script"]["expectedRevision"] == 0
    assert client.get(path).json()["scenes"] == []
    assert client.get(path + "/script-generation").json()["id"] == result["id"]
    saved = client.put(path + "/script", json=result["result"]["script"])
    assert saved.status_code == 200
    assert saved.json()["status"] == "ready" and saved.json()["sceneCount"] == 2
    assert saved.json()["scriptRevision"] == 1
    assert "planning-test-fixture" not in json.dumps(result)


def test_bad_script_keeps_saved_script(client, monkeypatch):
    def invalid(*args, **kwargs):
        fake_generate(*args, **kwargs)
        return '{"scenes":'

    monkeypatch.setattr("app.planning.tasks.generate_script_text", invalid)
    account, project = setup(client)
    path = f"/api/projects/{project['id']}"
    previous = client.put(
        path + "/script", json={"expectedRevision": 0, **proposal()}
    ).json()
    task = client.post(
        path + "/script-generation",
        json={
            "accountId": account["id"],
            "idea": project["idea"],
            "expectedRevision": 1,
        },
    ).json()
    result = wait_task(client, task["id"])
    assert result["status"] == "failed" and result["error"]["code"] == "invalid_script"
    current = client.get(path).json()
    assert {k: v for k, v in current.items() if k != "updatedAt"} == {
        k: v for k, v in previous.items() if k != "updatedAt"
    }


def test_duplicate_and_cancel_without_mutating_script(client, monkeypatch):
    def blocked(*args, **kwargs):
        while True:
            kwargs["check_cancelled"]()
            time.sleep(0.05)

    monkeypatch.setattr("app.planning.tasks.generate_script_text", blocked)
    account, project = setup(client)
    path = f"/api/projects/{project['id']}"
    values = {
        "accountId": account["id"],
        "idea": project["idea"],
        "expectedRevision": 0,
    }
    task = client.post(path + "/script-generation", json=values).json()
    try:
        wait_task(client, task["id"], ("running",))
        assert client.post(path + "/script-generation", json=values).status_code == 409
        assert client.delete(path).status_code == 409
        assert client.post("/api/tasks/" + task["id"] + "/cancel").status_code == 200
        result = wait_task(client, task["id"])
        assert result["status"] == "cancelled" and not result["submitted"]
        assert client.get(path).json()["scenes"] == []
    finally:
        client.post("/api/tasks/" + task["id"] + "/cancel")


def test_generation_needs_verified_enabled_account(client):
    account, project = setup(client)
    path = f"/api/projects/{project['id']}"
    client.patch(f"/api/accounts/{account['id']}", json={"enabled": False})
    response = client.post(
        path + "/script-generation",
        json={
            "accountId": account["id"],
            "idea": "Do not save this invalid request",
            "expectedRevision": 0,
        },
    )
    assert (
        response.status_code == 409
        and response.json()["detail"]["code"] == "account_unavailable"
    )
    assert client.get(path).json()["idea"] == project["idea"]


def test_apply_proposal_rejects_a_newer_saved_script(client, monkeypatch):
    monkeypatch.setattr("app.planning.tasks.generate_script_text", fake_generate)
    account, project = setup(client)
    path = f"/api/projects/{project['id']}"
    task = client.post(
        path + "/script-generation",
        json={
            "accountId": account["id"],
            "idea": project["idea"],
            "expectedRevision": 0,
        },
    ).json()
    generated = wait_task(client, task["id"])["result"]["script"]
    other = proposal()
    other["visualStyle"] = "A different manual edit."
    saved = client.put(path + "/script", json={"expectedRevision": 0, **other}).json()
    assert client.put(path + "/script", json=generated).status_code == 409
    assert client.get(path).json() == saved


@pytest.mark.parametrize("duration", [10, 15, 300])
def test_prompt_and_parser_enforce_complete_timeline(duration):
    brief = {
        "idea": "Create a film",
        "durationSeconds": duration,
        "aspectRatio": "16:9",
        "name": "Film",
    }
    prompt = build_script_prompt(brief)
    assert json.dumps(scene_timeline(duration)) in prompt
    parsed = parse_script_reply(
        "```json\n" + json.dumps(proposal(duration)) + "\n```", duration, 3
    )
    assert parsed.expected_revision == 3
    assert sum(scene.duration_seconds for scene in parsed.scenes) == duration


@pytest.mark.parametrize(
    "text",
    [
        "partial reply",
        '{"scenes":',
        "[]",
        json.dumps({**proposal(), "expectedRevision": 999}),
        json.dumps(proposal(10)),
    ],
)
def test_invalid_or_truncated_replies_are_not_repaired_into_scripts(text):
    with pytest.raises((ValueError, TypeError)):
        parse_script_reply(text, 15, 0)
