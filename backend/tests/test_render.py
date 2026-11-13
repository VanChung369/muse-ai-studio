import threading
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.core.config import Settings
from app.integrations.muse.client import MuseError
from app.integrations.muse.media import GeneratedVideo
from app.main import create_app
from app.models import Account
from app.rendering.tasks import derive_status


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, data_dir=tmp_path)


@pytest.fixture
def client(settings):
    app = create_app(settings)
    coordinator = app.state.task_coordinator
    coordinator.poll_interval = 0.02
    with TestClient(app) as client:
        yield client


class Muse:
    """Stands in for `generate_video`: one clip per call, scripted failures."""

    def __init__(self):
        self.prompts = []
        self.failures = {}  # call number (from 1) -> MuseError
        self.gate = None  # Blocks a call until set, to observe "running".
        self.entered = threading.Event()
        self.killed = threading.Event()  # Simulates the process dying mid-call.

    def __call__(self, client, cookies, expiries, proxy, prompt, **hooks):
        self.prompts.append(prompt)
        call = len(self.prompts)
        hooks["before_send"](None)
        self.entered.set()
        if self.gate is not None:
            deadline = time.monotonic() + 10
            while not self.gate.is_set() and time.monotonic() < deadline:
                if self.killed.is_set():
                    raise SystemExit  # Ends the worker thread without a result.
                hooks["check_cancelled"]()
                time.sleep(0.01)
        if call in self.failures:
            raise self.failures[call]
        return GeneratedVideo(f"clip-{call}".encode(), "video/mp4", 1280, 720)


@pytest.fixture
def muse(monkeypatch):
    muse = Muse()
    monkeypatch.setattr("app.rendering.tasks.generate_video", muse)
    return muse


@pytest.fixture
def ffmpeg(monkeypatch):
    """A merge that joins the clips' bytes, so no FFmpeg binary is needed."""

    def merge(binary, clips, output, check_cancelled):
        output.write_bytes(b"|".join(clip.read_bytes() for clip in clips))

    monkeypatch.setattr("app.rendering.tasks.find_ffmpeg", lambda settings: "ffmpeg")
    monkeypatch.setattr("app.rendering.tasks.merge", merge)


def add_account(client, value="render-fixture", verified=True):
    account = client.post(
        "/api/accounts", json={"label": "Studio", "cookieText": f"hatch_sess={value}"}
    ).json()
    if verified:
        with client.app.state.database.engine.begin() as connection:
            connection.execute(
                update(Account)
                .where(Account.id == account["id"])
                .values(session_status="valid")
            )
    return account


def add_project(client, scripted=True):
    project = client.post(
        "/api/projects",
        json={"name": "Coffee film", "idea": "A farmer", "durationSeconds": 15},
    ).json()
    if scripted:
        project = client.put(
            f"/api/projects/{project['id']}/script",
            json={
                "expectedRevision": 0,
                "characterBible": "Lan, a farmer in a blue shirt",
                "visualStyle": "Warm morning light",
                "scenes": [
                    {
                        "number": 1,
                        "title": "Sunrise",
                        "prompt": "Lan walks into the field",
                        "durationSeconds": 10,
                    },
                    {
                        "number": 2,
                        "title": "Harvest",
                        "prompt": "Lan picks coffee cherries",
                        "durationSeconds": 5,
                    },
                ],
            },
        ).json()
    return project


def render(client, project_id):
    return client.get(f"/api/projects/{project_id}/render").json()


def wait_status(client, project_id, *statuses, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = render(client, project_id)
        if state["status"] in statuses:
            return state
        time.sleep(0.02)
    raise AssertionError(f"project stayed {state['status']}, expected {statuses}")


def test_render_runs_every_scene_in_order_then_merges(client, muse, ffmpeg):
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    assert render(client, project["id"])["scenes"][0]["task"] is None

    started = client.post(path + "/render")
    assert started.status_code == 202
    assert [scene["task"]["status"] for scene in started.json()["scenes"]] in (
        ["queued", "queued"],
        ["running", "queued"],
    )

    done = wait_status(client, project["id"], "completed")
    assert done["completedScenes"] == 2 and done["sceneCount"] == 2
    assert [scene["task"]["status"] for scene in done["scenes"]] == ["succeeded"] * 2
    assert done["merge"]["status"] == "succeeded"
    assert done["scenes"][0]["task"]["accountLabel"] == "Studio"

    # One request per scene, in order, carrying the shared description.
    assert len(muse.prompts) == 2
    assert muse.prompts[0].startswith(
        "Generate a video (aspect ratio 16:9, 10 seconds long): Lan walks into the field"
    )
    assert "5 seconds long" in muse.prompts[1]
    assert "Visual style: Warm morning light" in muse.prompts[0]
    assert "Recurring characters: Lan, a farmer in a blue shirt" in muse.prompts[0]

    clip = client.get(done["scenes"][1]["videoUrl"])
    assert clip.status_code == 200 and clip.content == b"clip-2"
    assert clip.headers["content-type"] == "video/mp4"
    film = client.get(done["videoUrl"])
    assert film.content == b"clip-1|clip-2"
    download = client.get(path + "/video", params={"download": True})
    assert 'filename="video.mp4"' in download.headers["content-disposition"]

    saved = client.get(path).json()
    assert saved["status"] == "completed" and saved["completedScenes"] == 2
    listed = client.get("/api/projects").json()["items"][0]
    assert listed["completedScenes"] == 2
    # A finished project's script stays locked.
    assert client.put(path + "/script", json={
        "expectedRevision": saved["scriptRevision"], "scenes": saved["scenes"],
    }).status_code == 409  # fmt: skip


def test_start_is_refused_until_the_project_can_render(client, muse, ffmpeg):
    assert client.post("/api/projects/missing/render").status_code == 404
    assert client.get("/api/projects/missing/render").status_code == 404
    draft = add_project(client, scripted=False)
    refused = client.post(f"/api/projects/{draft['id']}/render")
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "render_not_ready"

    project = add_project(client)
    path = f"/api/projects/{project['id']}/render"
    add_account(client, "unverified-fixture", verified=False)
    refused = client.post(path)
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "account_unavailable"
    # Nothing was queued and the script is still editable.
    assert client.get(f"/api/projects/{project['id']}").json()["status"] == "ready"
    assert render(client, project["id"])["usableAccounts"] == 0
    assert client.get("/api/tasks").json()["total"] == 0

    add_account(client)
    muse.gate = threading.Event()
    assert client.post(path).status_code == 202
    assert client.post(path).status_code == 409  # Already rendering.
    muse.gate.set()
    wait_status(client, project["id"], "completed")
    assert client.post(path).status_code == 409  # Rendered once already.


def test_failed_scene_keeps_finished_ones_and_resume_continues(client, muse, ffmpeg):
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}/render"
    muse.failures[2] = MuseError("quota_exhausted", 429)
    client.post(path)

    failed = wait_status(client, project["id"], "failed")
    first, second = failed["scenes"]
    assert first["task"]["status"] == "succeeded" and first["videoUrl"]
    assert second["task"]["status"] == "failed" and second["videoUrl"] is None
    assert second["task"]["error"]["code"] == "quota_exhausted"
    assert second["task"]["suggestedAction"] == "switch_account"
    assert failed["merge"]["status"] == "queued"  # Waiting behind scene 2.
    assert failed["completedScenes"] == 1 and failed["videoUrl"] is None

    resumed = client.post(path + "/resume")
    assert resumed.status_code == 200 and resumed.json()["status"] == "rendering"
    done = wait_status(client, project["id"], "completed")
    assert done["completedScenes"] == 2
    # Scene 1 was not sent again.
    assert len(muse.prompts) == 3
    assert client.post(path + "/resume").status_code == 409


def test_cancel_stops_the_chain_and_resume_restarts_it(client, muse, ffmpeg):
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}/render"
    assert client.post(path + "/cancel").status_code == 409  # Nothing running.
    muse.gate = threading.Event()
    client.post(path)
    assert muse.entered.wait(5)

    cancelling = client.post(path + "/cancel").json()
    assert cancelling["status"] in ("cancelling", "cancelled")
    cancelled = wait_status(client, project["id"], "cancelled")
    assert [scene["task"]["status"] for scene in cancelled["scenes"]] == [
        "cancelled",
        "cancelled",
    ]
    assert cancelled["merge"]["status"] == "cancelled"
    assert cancelled["completedScenes"] == 0

    muse.gate = None
    assert client.post(path + "/resume").json()["status"] == "rendering"
    assert wait_status(client, project["id"], "completed")["completedScenes"] == 2


def test_missing_ffmpeg_fails_only_the_merge(client, muse, monkeypatch):
    monkeypatch.setattr("app.rendering.tasks.find_ffmpeg", lambda settings: None)
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}/render"
    client.post(path)

    failed = wait_status(client, project["id"], "failed")
    assert failed["completedScenes"] == 2
    assert failed["merge"]["error"]["code"] == "ffmpeg_unavailable"
    assert all(scene["videoUrl"] for scene in failed["scenes"])

    def merge(binary, clips, output, check_cancelled):
        output.write_bytes(b"merged")

    monkeypatch.setattr("app.rendering.tasks.find_ffmpeg", lambda settings: "ffmpeg")
    monkeypatch.setattr("app.rendering.tasks.merge", merge)
    client.post(path + "/resume")
    done = wait_status(client, project["id"], "completed")
    assert client.get(done["videoUrl"]).content == b"merged"
    assert len(muse.prompts) == 2  # No scene was generated again.


def test_task_level_retry_and_cancel_move_the_project(client, muse, ffmpeg):
    add_account(client)
    project = add_project(client)
    muse.failures[1] = MuseError("generation_timeout", 504)
    client.post(f"/api/projects/{project['id']}/render")
    failed = wait_status(client, project["id"], "failed")
    task_id = failed["scenes"][0]["task"]["id"]

    muse.gate = threading.Event()
    muse.entered.clear()
    assert client.post(f"/api/tasks/{task_id}/retry").status_code == 200
    assert render(client, project["id"])["status"] == "rendering"
    assert muse.entered.wait(5)
    assert client.post(f"/api/tasks/{task_id}/cancel").status_code == 200
    cancelled = wait_status(client, project["id"], "cancelled")
    # Only that scene was cancelled; the rest of the chain still waits for it.
    assert cancelled["scenes"][1]["task"]["status"] == "queued"


# The simulated crash ends a worker thread with SystemExit.
@pytest.mark.filterwarnings("ignore::pytest.PytestUnhandledThreadExceptionWarning")
def test_interrupted_scene_needs_confirmation_to_resume(settings, muse, ffmpeg):
    muse.gate = threading.Event()
    app = create_app(settings)
    app.state.task_coordinator.poll_interval = 0.02
    with TestClient(app) as client:
        add_account(client)
        project = add_project(client)
        client.post(f"/api/projects/{project['id']}/render")
        assert muse.entered.wait(5)
    # The app stopped after the request was sent: the outcome is unknown.
    muse.killed.set()
    time.sleep(0.1)
    muse.killed.clear()
    muse.gate = None
    app = create_app(settings)
    app.state.task_coordinator.poll_interval = 0.02
    with TestClient(app) as client:
        path = f"/api/projects/{project['id']}/render"
        state = render(client, project["id"])
        assert state["status"] == "failed"
        assert state["scenes"][0]["task"]["status"] == "interrupted"
        refused = client.post(path + "/resume")
        assert refused.status_code == 409
        assert refused.json()["detail"]["code"] == "confirm_required"
        confirmed = client.post(path + "/resume", json={"confirmDuplicate": True})
        assert confirmed.status_code == 200
        assert wait_status(client, project["id"], "completed")


def test_delete_removes_clips_and_stops_waiting_tasks(client, muse, ffmpeg, settings):
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    muse.failures[2] = MuseError("generation_refused")
    muse.gate = threading.Event()
    client.post(path + "/render")
    assert muse.entered.wait(5)
    assert client.delete(path).status_code == 409  # Rendering.
    muse.gate.set()
    wait_status(client, project["id"], "failed")
    folder = settings.media_dir / "projects" / project["id"]
    assert (folder / "scene-01.mp4").read_bytes() == b"clip-1"

    assert client.delete(path).status_code == 204
    assert not folder.exists()
    tasks = client.get("/api/tasks").json()["items"]
    assert sorted(task["status"] for task in tasks) == [
        "cancelled",  # The merge that was still waiting.
        "failed",
        "succeeded",
    ]
    assert client.get(path + "/scenes/1/video").status_code == 404


def test_clip_routes_report_missing_media(client):
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    assert client.get(path + "/video").status_code == 404
    assert client.get(path + "/scenes/1/video").status_code == 404
    assert client.get(path + "/scenes/9/video").status_code == 404


@pytest.mark.parametrize(
    "rows,expected",
    [
        ([("succeeded", False), ("succeeded", False)], "completed"),
        ([("succeeded", False), ("running", False), ("queued", False)], "rendering"),
        ([("queued", False), ("queued", False)], "rendering"),
        ([("running", True), ("cancelled", True)], "cancelling"),
        ([("succeeded", False), ("cancelled", True), ("cancelled", True)], "cancelled"),
        ([("succeeded", False), ("failed", False), ("queued", False)], "failed"),
        ([("interrupted", False), ("queued", False)], "failed"),
        # A retried scene is running again while later ones are still cancelled.
        ([("running", False), ("cancelled", True)], "rendering"),
    ],
)
def test_project_status_follows_the_chain(rows, expected):
    assert derive_status(rows) == expected
