import io
import json
import threading
import time
import zipfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.core.config import Settings
from app.integrations.muse.client import MuseError
from app.integrations.muse.media import GeneratedVideo
from app.main import create_app
from app.models import Account
from app.rendering.ffmpeg import Clip, MediaInfo, MergeError
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
        self.references = []  # The frame attached to each call, or None.
        self.threads = []  # The conversation each call was asked to continue.
        self.accounts = []  # hatch_sess of the account each call ran on.
        self.attachments = []  # Reference files offered with each call.
        self.new_threads = 0
        self.failures = {}  # call number (from 1) -> MuseError
        self.gate = None  # Blocks a call until set, to observe "running".
        self.entered = threading.Event()
        self.hold = None  # Call numbers the gate applies to; None = all.
        self.killed = threading.Event()  # Simulates the process dying mid-call.

    def __call__(self, client, cookies, expiries, proxy, prompt, **hooks):
        self.prompts.append(prompt)
        self.references.append(hooks.get("reference"))
        self.threads.append(hooks.get("thread_path"))
        self.accounts.append(cookies["hatch_sess"])
        self.attachments.append([path.name for path in hooks.get("attachments", ())])
        call = len(self.prompts)
        hooks["before_send"](None)
        self.entered.set()
        if self.gate is not None and (self.hold is None or call in self.hold):
            deadline = time.monotonic() + 10
            while not self.gate.is_set() and time.monotonic() < deadline:
                if self.killed.is_set():
                    raise SystemExit  # Ends the worker thread without a result.
                hooks["check_cancelled"]()
                time.sleep(0.01)
        if call in self.failures:
            raise self.failures[call]
        thread = hooks.get("thread_path")
        if thread is None:
            # Muse opens a new conversation for the first message.
            self.new_threads += 1
            thread = f"/thread/t-{self.new_threads}"
        return GeneratedVideo(
            f"clip-{call}".encode(), "video/mp4", 1280, 720, thread_path=thread
        )


@pytest.fixture
def muse(monkeypatch):
    muse = Muse()
    monkeypatch.setattr("app.rendering.tasks.generate_video", muse)
    return muse


@pytest.fixture
def ffmpeg(monkeypatch):
    """A merge that joins the clips' bytes, so no FFmpeg binary is needed."""

    def merge(binary, clips, output, check_cancelled, mute=False, cuts=None):
        # Each clip's bytes, with its cut when it is not the whole clip.
        parts = [
            clip.read_bytes()
            + (b"" if cut == (0.0, None) else f"[{cut[0]:g}-{cut[1]:g}]".encode())
            for clip, cut in zip(clips, cuts or [(0.0, None)] * len(clips), strict=True)
        ]
        output.write_bytes(b"|".join(parts) + (b" (muted)" if mute else b""))

    def compose(binary, segments, output, check_cancelled, **options):
        # What the film is built from, readable in the "merged" bytes.
        parts = [
            (segment.path.read_bytes().decode() if segment.path.suffix == ".mp4" else segment.path.suffix[1:])
            + f"[{segment.start:g}-{'end' if segment.end is None else format(segment.end, 'g')}"
            + f" x{segment.speed:g}{' still' if segment.still else ''}]"
            for segment in segments
        ]
        extras = (
            f" volume={options.get('volume', 1.0):g}"
            f" music={[(track.offset, track.volume, track.loop) for track in options.get('soundtracks', ())]}"
            f" captions={[caption.text for caption in options.get('captions', ())]}"
            f" frame={options.get('frame')}"
        )
        output.write_bytes(("|".join(parts) + extras + (" (muted)" if options.get("mute") else "")).encode())

    monkeypatch.setattr("app.rendering.tasks.find_ffmpeg", lambda settings: "ffmpeg")
    monkeypatch.setattr("app.rendering.tasks.merge", merge)
    monkeypatch.setattr("app.rendering.tasks.compose", compose)
    monkeypatch.setattr(
        "app.rendering.tasks.probe",
        lambda binary, path: Clip(path, 10.0, 1280, 720, True),
    )
    monkeypatch.setattr(
        "app.rendering.tasks.last_frame",
        lambda binary, clip: b"frame-of-" + clip.read_bytes(),
    )


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
    assert "Quality: " in muse.prompts[0] and "Look: " not in muse.prompts[0]
    # From scene 2 on, the previous scene's last frame rides along.
    assert muse.references == [None, b"frame-of-clip-1"]
    assert "Continuity: " not in muse.prompts[0]
    assert "Use it as a visual reference" in muse.prompts[1]
    assert "Previous shot: Lan walks into the field" in muse.prompts[1]

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
    # Without continuity no scene needs a frame of the one before it.
    client.patch(f"/api/projects/{project['id']}", json={"continuity": "off"})
    path = f"/api/projects/{project['id']}/render"
    client.post(path)

    failed = wait_status(client, project["id"], "failed")
    assert failed["completedScenes"] == 2
    assert failed["merge"]["error"]["code"] == "ffmpeg_unavailable"
    assert all(scene["videoUrl"] for scene in failed["scenes"])

    def merge(binary, clips, output, check_cancelled, mute=False, cuts=None):
        output.write_bytes(b"merged")

    monkeypatch.setattr("app.rendering.tasks.find_ffmpeg", lambda settings: "ffmpeg")
    monkeypatch.setattr("app.rendering.tasks.merge", merge)
    client.post(path + "/resume")
    done = wait_status(client, project["id"], "completed")
    assert client.get(done["videoUrl"]).content == b"merged"
    assert len(muse.prompts) == 2  # No scene was generated again.


def test_continuity_needs_ffmpeg_before_anything_is_sent(client, muse, monkeypatch):
    monkeypatch.setattr("app.rendering.tasks.find_ffmpeg", lambda settings: None)
    add_account(client)
    project = add_project(client)
    client.post(f"/api/projects/{project['id']}/render")

    failed = wait_status(client, project["id"], "failed")
    assert failed["scenes"][0]["task"]["status"] == "succeeded"
    second = failed["scenes"][1]["task"]
    assert second["error"]["code"] == "ffmpeg_unavailable"
    # Scene 2 was never sent to Muse, so no generation was spent on it.
    assert len(muse.prompts) == 1 and not second["submitted"]


def test_look_and_continuity_shape_every_scene_prompt(client, muse, ffmpeg):
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    saved = client.patch(path, json={"look": "realistic", "continuity": "seamless"})
    assert saved.status_code == 200
    assert (saved.json()["look"], saved.json()["continuity"]) == ("realistic", "seamless")
    client.post(path + "/render")
    wait_status(client, project["id"], "completed")

    assert all("Look: Photorealistic live-action footage" in p for p in muse.prompts)
    assert "Begin this shot on exactly that frame" in muse.prompts[1]
    assert muse.references[1] == b"frame-of-clip-1"


def test_restart_redoes_one_scene_and_everything_after_it(client, muse, ffmpeg, settings):
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    restart = path + "/render/restart"
    assert client.post(restart, json={"fromScene": 1}).status_code == 409  # Never rendered.
    client.post(path + "/render")
    done = wait_status(client, project["id"], "completed")
    first_clip = client.get(done["scenes"][0]["videoUrl"]).content

    assert client.post(restart, json={"fromScene": 3}).status_code == 409  # No such scene.
    assert client.post(restart, json={"fromScene": 0}).status_code == 422
    # A new look for the redone part of the film.
    assert client.patch(path, json={"look": "cinematic"}).status_code == 200
    restarted = client.post(restart, json={"fromScene": 2})
    assert restarted.status_code == 200
    state = restarted.json()
    assert state["status"] == "rendering" and state["completedScenes"] == 1
    assert state["videoUrl"] is None and state["scenes"][1]["videoUrl"] is None
    assert state["scenes"][0]["task"]["status"] == "succeeded"

    done = wait_status(client, project["id"], "completed")
    assert len(muse.prompts) == 3  # Scene 1 was kept; only scene 2 was sent again.
    assert "Look: Cinematic feature-film look" in muse.prompts[2]
    assert client.get(done["scenes"][0]["videoUrl"]).content == first_clip
    assert client.get(done["scenes"][1]["videoUrl"]).content == b"clip-3"
    assert client.get(done["videoUrl"]).content == b"clip-1|clip-3"

    # From scene 1: the whole film.
    assert client.post(restart, json={"fromScene": 1}).status_code == 200
    folder = settings.media_dir / "projects" / project["id"]
    done = wait_status(client, project["id"], "completed")
    assert len(muse.prompts) == 5
    assert sorted(file.name for file in folder.iterdir()) == [
        "final.mp4",
        "scene-01.mp4",
        "scene-02.mp4",
    ]


def test_restart_needs_every_earlier_scene(client, muse, ffmpeg):
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    muse.failures[1] = MuseError("generation_refused")
    client.post(path + "/render")
    wait_status(client, project["id"], "failed")
    refused = client.post(path + "/render/restart", json={"fromScene": 2})
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "render_not_restartable"
    assert render(client, project["id"])["status"] == "failed"
    assert client.post(path + "/render/restart", json={"fromScene": 1}).status_code == 200
    assert wait_status(client, project["id"], "completed")["completedScenes"] == 2


def test_project_brief_can_change_until_a_render_starts(client, muse, ffmpeg):
    add_account(client)
    assert client.patch("/api/projects/missing", json={"name": "x"}).status_code == 404
    draft = add_project(client, scripted=False)
    path = f"/api/projects/{draft['id']}"
    changed = client.patch(
        path,
        json={"name": "  Tea film  ", "aspectRatio": "9:16", "durationSeconds": 30, "idea": "New idea"},
    )
    assert changed.status_code == 200
    body = changed.json()
    assert (body["name"], body["aspectRatio"], body["durationSeconds"], body["idea"]) == (
        "Tea film", "9:16", 30, "New idea",
    )  # fmt: skip
    assert body["status"] == "draft" and body["updatedAt"] >= draft["updatedAt"]
    # The renamed project is found by its new name.
    assert client.get("/api/projects", params={"q": "tea"}).json()["total"] == 1
    for invalid in ({"name": " "}, {"aspectRatio": "4:3"}, {"durationSeconds": 12},
                    {"look": "noir"}, {"name": None}, {"status": "ready"}):  # fmt: skip
        assert client.patch(path, json=invalid).status_code == 422, invalid
    assert client.patch(path, json={}).json() == body

    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    # A saved script adds up to 15 seconds: the ratio can change, the length cannot.
    assert client.patch(path, json={"aspectRatio": "1:1"}).status_code == 200
    locked = client.patch(path, json={"durationSeconds": 20})
    assert locked.status_code == 409
    assert locked.json()["detail"]["code"] == "duration_locked"
    assert client.patch(path, json={"durationSeconds": 15}).status_code == 200
    # Agreeing to drop the script makes room for another length.
    reset = client.patch(path, json={"durationSeconds": 20, "discardScript": True}).json()
    assert (reset["durationSeconds"], reset["status"], reset["sceneCount"]) == (20, "draft", 0)
    assert reset["scenes"] == [] and reset["scriptRevision"] == project["scriptRevision"] + 1
    # The same length keeps a script even when discarding was allowed.
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    kept = client.patch(
        path,
        json={"durationSeconds": 15, "discardScript": True, "aspectRatio": "1:1"},
    ).json()
    assert kept["sceneCount"] == 2 and kept["status"] == "ready"

    muse.gate = threading.Event()
    client.post(path + "/render")
    assert muse.entered.wait(5)
    busy = client.patch(path, json={"look": "anime"})
    assert busy.status_code == 409 and busy.json()["detail"]["code"] == "project_busy"
    muse.gate.set()
    wait_status(client, project["id"], "completed")
    after = client.patch(path, json={"name": "Renamed"})
    assert after.status_code == 409 and after.json()["detail"]["code"] == "project_locked"
    # Render options still apply to a later "render again".
    assert client.patch(path, json={"look": "anime", "continuity": "off"}).status_code == 200
    assert "1:1" in muse.prompts[0]


def test_a_film_is_rendered_in_one_conversation_on_one_account(client, muse, ffmpeg):
    add_account(client, "first-fixture")
    add_account(client, "second-fixture")
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    client.post(path + "/render")
    wait_status(client, project["id"], "completed")

    # Scene 1 opens the conversation; scene 2 continues it on the same account
    # even though another account was free.
    assert muse.threads == [None, "/thread/t-1"]
    assert len(set(muse.accounts)) == 1
    assert "This is shot 2 of the same film" in muse.prompts[1]
    assert "same film as the earlier shots" not in muse.prompts[0]

    # Rendering again starts a fresh conversation, so Muse does not hand back
    # the clips it already made.
    client.post(path + "/render/restart", json={"fromScene": 1})
    wait_status(client, project["id"], "completed")
    assert muse.threads[2:] == [None, "/thread/t-2"]


def test_script_and_scenes_share_one_conversation(client, muse, ffmpeg, monkeypatch):
    add_account(client, "first-fixture")
    writer = add_account(client, "writer-fixture")
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    prompts = []

    def write_script(client_, cookies, expiries, proxy, prompt, **hooks):
        prompts.append((prompt, hooks.get("thread_path")))
        hooks["before_send"](None)
        hooks["on_thread"]("/thread/script-1")
        return json.dumps(
            {
                "characterBible": "",
                "visualStyle": "",
                "scenes": [
                    {"number": 1, "title": "A", "prompt": "One", "durationSeconds": 10},
                    {"number": 2, "title": "B", "prompt": "Two", "durationSeconds": 5},
                ],
            }
        )

    monkeypatch.setattr("app.planning.tasks.generate_script_text", write_script)
    request = {
        "accountId": writer["id"],
        "idea": "A farmer",
        "expectedRevision": 1,
        "language": "vi",
        "look": "documentary",
        "narration": True,
        "direction": "Slow, quiet pacing",
    }
    task = client.post(path + "/script-generation", json=request).json()
    deadline = time.monotonic() + 5
    while client.get(f"/api/tasks/{task['id']}").json()["status"] != "succeeded":
        assert time.monotonic() < deadline
        time.sleep(0.02)

    # What was chosen in the dialog reached the writer and the project.
    brief, thread = prompts[0]
    assert thread is None
    assert "Write scene titles and narration in Vietnamese." in brief
    assert "Write a voice-over line for every scene" in brief
    assert "Documentary look" in brief
    assert "Additional direction from the user: Slow, quiet pacing" in brief
    saved = client.get(path).json()
    assert (saved["language"], saved["look"]) == ("vi", "documentary")

    # A second script continues the conversation the first one opened...
    client.post(path + "/script-generation", json=request)
    deadline = time.monotonic() + 5
    while len(prompts) < 2:
        assert time.monotonic() < deadline
        time.sleep(0.02)
    assert prompts[1][1] == "/thread/script-1"

    # ...and so does the render, on the account that owns it.
    time.sleep(0.2)
    client.post(path + "/render")
    wait_status(client, project["id"], "completed")
    assert muse.threads == ["/thread/script-1", "/thread/script-1"]
    assert set(muse.accounts) == {"writer-fixture"}
    assert "Language: any speech, voice-over or singing is in Vietnamese only." in muse.prompts[0]


def test_muted_film_asks_for_silence_and_merges_without_sound(client, muse, ffmpeg):
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    assert client.patch(path, json={"mute": True, "language": "vi"}).json()["mute"] is True
    client.post(path + "/render")
    done = wait_status(client, project["id"], "completed")
    assert all("Audio: this is a silent video." in prompt for prompt in muse.prompts)
    assert not any("Language: " in prompt for prompt in muse.prompts)
    assert client.get(done["videoUrl"]).content == b"clip-1|clip-2 (muted)"

    # Turning the sound back on merges again from the same clips.
    changed = client.patch(path, json={"mute": False}).json()
    assert changed["status"] == "rendering"
    done = wait_status(client, project["id"], "completed")
    assert client.get(done["videoUrl"]).content == b"clip-1|clip-2"
    assert len(muse.prompts) == 2  # Nothing was rendered again.
    # The same value again changes nothing.
    assert client.patch(path, json={"mute": False}).json()["status"] == "completed"


def test_timeline_reorders_trims_and_drops_scenes_without_rendering(
    client, muse, ffmpeg, monkeypatch
):
    from app.rendering.ffmpeg import Clip

    # Clips are 10 and 5 seconds long, as the script says.
    monkeypatch.setattr("app.api.routes.timeline.find_ffmpeg", lambda settings: "ffmpeg")
    monkeypatch.setattr(
        "app.api.routes.timeline.probe",
        lambda binary, path: Clip(path, 10.0 if "01" in path.name else 5.0, 1280, 720, True),
    )
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    timeline = path + "/timeline"
    assert client.get("/api/projects/missing/timeline").status_code == 404
    assert client.get(timeline).json()["items"] == []
    whole = [
        {"scene": 1, "start": 0, "end": 10, "enabled": True},
        {"scene": 2, "start": 0, "end": 5, "enabled": True},
    ]
    locked = client.put(timeline, json={"items": whole})
    assert locked.status_code == 409
    assert locked.json()["detail"]["code"] == "timeline_locked"

    client.post(path + "/render")
    wait_status(client, project["id"], "completed")
    start = client.get(timeline).json()
    assert start["editable"] and start["totalSeconds"] == 15
    assert [(i["scene"], i["start"], i["end"], i["clipSeconds"]) for i in start["items"]] == [
        (1, 0, 10, 10),
        (2, 0, 5, 5),
    ]

    for invalid in (
        [whole[0]],  # A rendered scene is missing.
        [whole[0], whole[0]],
        [{**whole[0], "enabled": False}, {**whole[1], "enabled": False}],
        [{**whole[0], "end": 12}, whole[1]],  # Past the end of the clip.
        [{**whole[0], "start": 9.8}, whole[1]],  # Less than half a second left.
    ):
        refused = client.put(timeline, json={"items": invalid})
        assert refused.status_code == 422, invalid
    assert client.get(timeline).json() == start

    # Scene 2 first, then the middle of scene 1.
    saved = client.put(
        timeline,
        json={"items": [whole[1], {"scene": 1, "start": 2.5, "end": 8, "enabled": True}]},
    )
    assert saved.status_code == 200
    body = saved.json()
    assert body["status"] == "rendering" and not body["editable"]
    assert body["totalSeconds"] == 10.5
    done = wait_status(client, project["id"], "completed")
    assert client.get(done["videoUrl"]).content == b"clip-2|clip-1[2.5-8]"

    # Leaving a scene out keeps its clip; the film is just merged without it.
    client.put(timeline, json={"items": [{**whole[1], "enabled": False}, whole[0]]})
    done = wait_status(client, project["id"], "completed")
    assert client.get(done["videoUrl"]).content == b"clip-1"
    assert done["completedScenes"] == 2 and all(s["videoUrl"] for s in done["scenes"])
    after = client.get(timeline).json()
    assert [(i["scene"], i["enabled"]) for i in after["items"]] == [(2, False), (1, True)]
    assert after["totalSeconds"] == 10
    assert len(muse.prompts) == 2  # Nothing was ever rendered again.


def test_reference_files_open_the_conversation_and_fields_reach_the_prompt(
    client, muse, ffmpeg, settings
):
    add_account(client)
    project = client.post(
        "/api/projects",
        json={
            "name": "Tea",
            "durationSeconds": 15,
            "characterBible": "  Lan, a farmer  ",
            "visualStyle": "Soft dawn light",
            "music": "Gentle bamboo flute",
        },
    ).json()
    assert (project["characterBible"], project["music"]) == ("Lan, a farmer", "Gentle bamboo flute")
    path = f"/api/projects/{project['id']}"
    references = path + "/references"

    # Pictures and videos are accepted; other files, empty ones and a seventh are not.
    png = {"Content-Type": "image/png"}
    assert client.post(references, params={"name": "notes.txt"}, content=b"x", headers={"Content-Type": "text/plain"}).status_code == 415
    assert client.post(references, params={"name": "empty.png"}, content=b"", headers=png).status_code == 422
    assert client.post("/api/projects/missing/references", params={"name": "a.png"}, content=b"x", headers=png).status_code == 404
    picture = client.post(references, params={"name": "..\\secret\\lan face.png"}, content=b"png-bytes", headers=png)
    assert picture.status_code == 201
    saved = picture.json()
    assert (saved["name"], saved["mime"], saved["size"]) == ("lan face.png", "image/png", 9)
    assert client.get(saved["url"]).content == b"png-bytes"
    clip = client.post(references, params={"name": "walk.mp4"}, content=b"mp4-bytes", headers={"Content-Type": "video/mp4"}).json()
    listed = client.get(path).json()["references"]
    assert [item["name"] for item in listed] == ["lan face.png", "walk.mp4"]
    for index in range(4):
        assert client.post(references, params={"name": f"{index}.png"}, content=b"x", headers=png).status_code == 201
    full = client.post(references, params={"name": "seventh.png"}, content=b"x", headers=png)
    assert full.status_code == 409 and full.json()["detail"]["code"] == "too_many_files"
    for item in client.get(references).json()[2:]:
        assert client.delete(f"{references}/{item['id']}").status_code == 204
    assert client.delete(f"{references}/missing").status_code == 404

    client.put(
        path + "/script",
        json={
            "expectedRevision": client.get(path).json()["scriptRevision"],
            "characterBible": "Lan, a farmer",
            "visualStyle": "Soft dawn light",
            "scenes": [
                {"number": 1, "title": "A", "prompt": "One", "durationSeconds": 10},
                {"number": 2, "title": "B", "prompt": "Two", "durationSeconds": 5},
            ],
        },
    )
    client.post(path + "/render")
    wait_status(client, project["id"], "completed")
    # The files go with the first message of the conversation only.
    assert len(muse.attachments[0]) == 2 and muse.attachments[1] == muse.attachments[0]
    assert "Reference material: the attached files" in muse.prompts[0]
    assert "Reference material" not in muse.prompts[1]
    assert all("Music: Gentle bamboo flute" in prompt for prompt in muse.prompts)
    assert client.get(saved["url"]).headers["x-content-type-options"] == "nosniff"

    # Files go out with a conversation's first message, so a changed set of
    # files makes the project's next message start a new conversation.
    def thread():
        with client.app.state.database.engine.begin() as connection:
            return connection.exec_driver_sql("select muse_thread_path from projects").scalar()

    assert thread() is not None
    extra = client.post(references, params={"name": "extra.png"}, content=b"x", headers=png)
    assert extra.status_code == 201 and thread() is None

    folder = settings.data_dir / "projects" / project["id"] / "references"
    assert len(list(folder.iterdir())) == 3
    assert client.delete(path).status_code == 204
    assert not folder.exists()
    assert client.get(clip["url"]).status_code == 404


def test_characters_and_style_can_change_until_a_render_starts(client, muse, ffmpeg):
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    changed = client.patch(path, json={"characterBible": "Minh, a barista", "music": "Jazz"}).json()
    assert changed["characterBible"] == "Minh, a barista" and changed["music"] == "Jazz"
    # The script changed under any open editor or pending proposal.
    assert changed["scriptRevision"] == project["scriptRevision"] + 1
    client.post(path + "/render")
    wait_status(client, project["id"], "completed")
    assert "Recurring characters: Minh, a barista" in muse.prompts[0]
    locked = client.patch(path, json={"visualStyle": "Noir"})
    assert locked.status_code == 409 and locked.json()["detail"]["code"] == "project_locked"
    # What the film should sound like is a render option, like the look.
    assert client.patch(path, json={"music": "Strings"}).status_code == 200


def test_narration_is_sent_as_a_voice_over(client, muse, ffmpeg):
    add_account(client)
    project = client.post(
        "/api/projects", json={"name": "Tea", "durationSeconds": 10, "language": "en"}
    ).json()
    path = f"/api/projects/{project['id']}"
    client.put(
        path + "/script",
        json={
            "expectedRevision": 0,
            "scenes": [
                {
                    "number": 1,
                    "title": "Dawn",
                    "prompt": "Mist over the hills",
                    "durationSeconds": 10,
                    "narration": "Every morning begins here.",
                }
            ],
        },
    )
    client.post(path + "/render")
    wait_status(client, project["id"], "completed")
    assert (
        'Voice-over, spoken by a narrator in English: "Every morning begins here."'
        in muse.prompts[0]
    )


def test_cover_and_thumbnails_appear_with_the_first_clip(client, muse, ffmpeg, monkeypatch):
    def still(binary, clip, target):
        target.write_bytes(b"still-of-" + clip.read_bytes())
        return True

    monkeypatch.setattr("app.rendering.tasks.thumbnail", still)
    monkeypatch.setattr("app.api.routes.render.thumbnail", still)
    monkeypatch.setattr("app.api.routes.render.find_ffmpeg", lambda settings: "ffmpeg")
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    assert project["coverUrl"] is None
    assert client.get(path + "/cover").status_code == 404
    client.post(path + "/render")
    done = wait_status(client, project["id"], "completed")

    listed = client.get("/api/projects").json()["items"][0]
    assert listed["coverUrl"].startswith(path + "/cover?v=")
    assert client.get(listed["coverUrl"]).content == b"still-of-clip-1"
    thumb = client.get(done["scenes"][1]["thumbnailUrl"])
    assert thumb.content == b"still-of-clip-2"
    assert thumb.headers["content-type"] == "image/jpeg"
    # A clip rendered before thumbnails existed gets one on first request.
    folder = client.app.state.settings.media_dir / "projects" / project["id"]
    (folder / "scene-01.jpg").unlink()
    assert client.get(path + "/scenes/1/thumbnail").content == b"still-of-clip-1"
    assert client.get(path + "/scenes/9/thumbnail").status_code == 404


def test_long_film_starts_a_new_conversation_at_the_limit(settings, muse, ffmpeg):
    settings.thread_scene_limit = 1
    app = create_app(settings)
    app.state.task_coordinator.poll_interval = 0.02
    with TestClient(app) as client:
        add_account(client)
        project = add_project(client)
        client.post(f"/api/projects/{project['id']}/render")
        wait_status(client, project["id"], "completed")
    assert muse.threads == [None, None]
    assert "same film as the earlier shots" not in muse.prompts[1]
    # The reference frame still carries the look across conversations.
    assert muse.references[1] == b"frame-of-clip-1"


def test_account_problem_moves_the_rest_of_the_film_to_another_account(client, muse, ffmpeg):
    add_account(client, "first-fixture")
    add_account(client, "second-fixture")
    project = add_project(client)
    path = f"/api/projects/{project['id']}/render"
    muse.failures[2] = MuseError("quota_exhausted", 429)
    client.post(path)
    wait_status(client, project["id"], "failed")
    client.post(path + "/resume")
    wait_status(client, project["id"], "completed")

    first, failed, retried = muse.accounts
    assert first == failed and retried != failed
    # Another account cannot open the first one's conversation.
    assert muse.threads == [None, "/thread/t-1", None]


def test_cancelled_render_resumes_in_the_same_conversation(client, muse, ffmpeg):
    add_account(client, "first-fixture")
    add_account(client, "second-fixture")
    project = add_project(client)
    path = f"/api/projects/{project['id']}/render"
    # Scene 1 runs through; scene 2 is held, then cancelled.
    muse.gate, muse.hold = threading.Event(), {2}
    client.post(path)
    deadline = time.monotonic() + 5
    while len(muse.prompts) < 2:
        assert time.monotonic() < deadline
        time.sleep(0.01)
    client.post(path + "/cancel")
    wait_status(client, project["id"], "cancelled")
    muse.gate = None
    client.post(path + "/resume")
    wait_status(client, project["id"], "completed")
    assert len(set(muse.accounts)) == 1
    assert muse.threads == [None, "/thread/t-1", "/thread/t-1"]


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


def test_all_scene_clips_download_as_one_archive(client, muse, ffmpeg):
    import io
    import zipfile

    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}"
    assert client.get(path + "/scenes.zip").status_code == 404  # Nothing rendered.
    client.post(path + "/render")
    wait_status(client, project["id"], "completed")
    response = client.get(path + "/scenes.zip")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == ["scene-01.mp4", "scene-02.mp4"]
        assert archive.read("scene-02.mp4") == b"clip-2"


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


@pytest.fixture
def media_tools(monkeypatch):
    """Stand in for FFmpeg where uploads are read and timelines are checked."""

    def inspect(binary, path):
        if path.read_bytes() == b"junk":
            raise MergeError
        return {
            ".mp4": MediaInfo(4.0, 640, 360, True),
            ".png": MediaInfo(None, 800, 600, False),
            ".mp3": MediaInfo(20.0, None, None, True),
        }[path.suffix]

    monkeypatch.setattr("app.api.routes.media.find_ffmpeg", lambda settings: "ffmpeg")
    monkeypatch.setattr("app.api.routes.media.inspect", inspect)
    monkeypatch.setattr("app.api.routes.media.thumbnail", lambda binary, clip, target: False)
    monkeypatch.setattr("app.api.routes.timeline.find_ffmpeg", lambda settings: "ffmpeg")
    monkeypatch.setattr("app.api.routes.timeline._captions_supported", lambda binary: True)
    # Scene clips are 10 and 5 seconds long, as the script says.
    monkeypatch.setattr(
        "app.api.routes.timeline.probe",
        lambda binary, path: Clip(path, 10.0 if "01" in path.name else 5.0, 1280, 720, True),
    )


def upload(client, project_id, name, mime, content=b"bytes"):
    return client.post(
        f"/api/projects/{project_id}/media",
        params={"name": name},
        content=content,
        headers={"Content-Type": mime},
    )


def test_media_files_are_uploaded_listed_and_deleted(client, media_tools, settings):
    project = add_project(client)
    pid = project["id"]
    folder = settings.data_dir / "projects" / pid / "media"

    assert upload(client, pid, "notes.txt", "text/plain").status_code == 415
    assert upload(client, "missing", "a.png", "image/png").status_code == 404
    assert upload(client, pid, "empty.png", "image/png", b"").json()["detail"]["code"] == "empty_file"
    # Bytes that are not what their type says are refused and not kept.
    junk = upload(client, pid, "broken.mp4", "video/mp4", b"junk")
    assert junk.status_code == 422 and junk.json()["detail"]["code"] == "unreadable_file"
    assert list(folder.iterdir()) == []

    video = upload(client, pid, "..\\clips\\b roll.mp4", "video/mp4").json()
    assert (video["kind"], video["name"], video["seconds"], video["width"]) == ("video", "b roll.mp4", 4.0, 640)
    picture = upload(client, pid, "logo.png", "image/png").json()
    assert (picture["kind"], picture["seconds"], picture["height"]) == ("image", None, 600)
    song = upload(client, pid, "song.mp3", "audio/mpeg; charset=binary").json()
    assert (song["kind"], song["seconds"], song["width"], song["thumbnailUrl"]) == ("audio", 20.0, None, None)
    assert song["source"] == "upload" and song["size"] == 5

    listed = client.get(f"/api/projects/{pid}/media").json()
    assert [item["name"] for item in listed] == ["b roll.mp4", "logo.png", "song.mp3"]
    served = client.get(video["url"])
    assert served.content == b"bytes" and served.headers["x-content-type-options"] == "nosniff"
    # No still could be made: a picture is its own still, a video has none.
    assert client.get(picture["thumbnailUrl"]).content == b"bytes"
    assert client.get(video["thumbnailUrl"]).status_code == 404

    assert client.delete(song["url"]).status_code == 204
    assert client.delete(song["url"]).status_code == 404
    assert len(list(folder.iterdir())) == 2
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert not folder.exists()


def test_timeline_takes_added_media_speed_soundtrack_and_captions(
    client, muse, ffmpeg, media_tools
):
    add_account(client)
    project = add_project(client)
    pid = project["id"]
    timeline = f"/api/projects/{pid}/timeline"
    video = upload(client, pid, "b roll.mp4", "video/mp4", b"broll").json()
    picture = upload(client, pid, "logo.png", "image/png").json()
    song = upload(client, pid, "song.mp3", "audio/mpeg").json()
    client.post(f"/api/projects/{pid}/render")
    wait_status(client, pid, "completed")

    scene1 = {"scene": 1, "start": 0, "end": 10, "enabled": True}
    scene2 = {"scene": 2, "start": 0, "end": 5, "enabled": True}
    for invalid in (
        {"items": [scene1, scene2, {"mediaId": song["id"], "start": 0, "end": 2}]},  # Audio as picture.
        {"items": [scene1, scene2, {"mediaId": "nope", "start": 0, "end": 2}]},
        {"items": [scene1, scene2, {"mediaId": video["id"], "start": 0, "end": 9}]},  # Past its end.
        {"items": [scene1, scene2, {"mediaId": picture["id"], "start": 0, "end": 31}]},
        {"items": [{**scene1, "speed": 5}, scene2]},
        {"items": [{**scene1, "mediaId": video["id"]}, scene2]},  # Two sources.
        {"items": [scene1, scene2], "audio": [{"mediaId": video["id"], "end": 2}]},  # Video as audio.
        {"items": [scene1, scene2], "audio": [{"mediaId": song["id"], "end": 25}]},
        {"items": [scene1, scene2], "volume": 3},
        {"items": [scene1, scene2], "captions": [{"start": 2, "end": 2.1, "text": "Too short"}]},
    ):
        assert client.put(timeline, json=invalid).status_code == 422, invalid

    saved = client.put(
        timeline,
        json={
            "items": [
                {"mediaId": picture["id"], "key": "intro", "start": 0, "end": 2},
                {**scene1, "speed": 2},
                {"mediaId": video["id"], "key": "cutaway", "start": 1, "end": 3, "speed": 0.5},
                scene2,
                {"mediaId": picture["id"], "key": "outro", "start": 0, "end": 1.5, "enabled": False},
            ],
            "audio": [{"mediaId": song["id"], "offset": 1, "start": 0, "end": 20, "volume": 0.5, "loop": True}],
            "volume": 0.8,
            "captions": [
                {"start": 3, "end": 5, "text": " Second line \n\n"},
                {"start": 0, "end": 2, "text": "Chào buổi sáng"},
                {"start": 6, "end": 7, "text": "   "},
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    # 2 s of picture, 10 s at double speed, 2 s at half speed, 5 s.
    assert body["totalSeconds"] == 2 + 5 + 4 + 5
    assert [(i["key"], i["kind"], i["speed"], i["enabled"]) for i in body["items"]] == [
        ("intro", "image", 1, True),
        ("scene-1", "scene", 2, True),
        ("cutaway", "video", 0.5, True),
        ("scene-2", "scene", 1, True),
        ("outro", "image", 1, False),
    ]
    assert body["items"][2]["videoUrl"] == video["url"] and body["items"][0]["videoUrl"] is None
    assert [(a["mediaId"], a["offset"], a["end"], a["volume"], a["loop"]) for a in body["audio"]] == [
        (song["id"], 1, 20, 0.5, True)
    ]
    assert body["volume"] == 0.8 and body["burnCaptions"] and body["canBurnCaptions"]
    assert [c["text"] for c in body["captions"]] == ["Chào buổi sáng", "Second line"]
    done = wait_status(client, pid, "completed")
    assert client.get(done["videoUrl"]).content.decode() == (
        "png[0-2 x1 still]|clip-1[0-end x2]|broll[1-3 x0.5]|clip-2[0-end x1]"
        " volume=0.8 music=[(1.0, 0.5, True)] captions=['Chào buổi sáng', 'Second line']"
        " frame=(1280, 720)"
    )

    # A file placed in the film cannot be deleted from under it.
    for used in (video, picture, song):
        refused = client.delete(used["url"])
        assert refused.status_code == 409 and refused.json()["detail"]["code"] == "media_in_use"

    # Captions kept only as a file to download are not drawn; a plain edit
    # goes back to simply joining the scenes.
    client.put(timeline, json={"items": [scene1, scene2], "captions": [{"start": 0, "end": 2, "text": "Kept"}], "burnCaptions": False})
    done = wait_status(client, pid, "completed")
    assert client.get(done["videoUrl"]).content == b"clip-1|clip-2"
    assert client.get(timeline).json()["captions"] == [{"start": 0, "end": 2, "text": "Kept"}]
    assert client.delete(video["url"]).status_code == 204
    assert len(muse.prompts) == 2  # Nothing was ever rendered again.


def test_captions_are_refused_when_ffmpeg_cannot_draw_them(client, muse, ffmpeg, media_tools, monkeypatch):
    monkeypatch.setattr("app.api.routes.timeline._captions_supported", lambda binary: False)
    add_account(client)
    project = add_project(client)
    timeline = f"/api/projects/{project['id']}/timeline"
    client.post(f"/api/projects/{project['id']}/render")
    wait_status(client, project["id"], "completed")
    items = [{"scene": 1, "start": 0, "end": 10}, {"scene": 2, "start": 0, "end": 5}]
    caption = [{"start": 0, "end": 2, "text": "Hello"}]
    refused = client.put(timeline, json={"items": items, "captions": caption})
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "captions_unavailable"
    assert not client.get(timeline).json()["canBurnCaptions"]
    # They can still be kept for download.
    assert client.put(timeline, json={"items": items, "captions": caption, "burnCaptions": False}).status_code == 200


def test_muse_makes_music_that_arrives_as_an_audio_file(client, muse, media_tools, monkeypatch, settings):
    monkeypatch.setattr("app.rendering.music.generate_video", muse)
    monkeypatch.setattr("app.rendering.music.find_ffmpeg", lambda settings: "ffmpeg")
    monkeypatch.setattr(
        "app.rendering.music.extract_audio",
        lambda binary, source, target: target.write_bytes(b"sound-of-" + source.read_bytes()),
    )
    monkeypatch.setattr("app.rendering.music.inspect", lambda binary, path: MediaInfo(10.0, None, None, True))
    project = add_project(client)
    pid = project["id"]
    music = f"/api/projects/{pid}/media/music"
    ask = {"description": "  Slow acoustic guitar, warm.  "}

    assert client.post("/api/projects/missing/media/music", json=ask).status_code == 404
    assert client.post(music, json={"description": " "}).status_code == 422
    assert client.get(music).json() is None
    # No account with a verified session yet.
    refused = client.post(music, json=ask)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "account_unavailable"
    add_account(client)

    muse.gate = threading.Event()
    started = client.post(music, json=ask)
    assert started.status_code == 202 and started.json()["kind"] == "generate_music"
    assert muse.entered.wait(5)
    # One piece at a time per project.
    again = client.post(music, json=ask)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "generation_active"
    muse.gate.set()
    deadline = time.monotonic() + 5
    while client.get(music).json()["status"] != "succeeded":
        assert time.monotonic() < deadline
        time.sleep(0.02)

    # A clip was asked for in a conversation of its own, for its soundtrack.
    assert "Slow acoustic guitar, warm" in muse.prompts[0] and "Music only" in muse.prompts[0]
    assert muse.threads == [None]
    (made,) = client.get(f"/api/projects/{pid}/media").json()
    assert (made["kind"], made["source"], made["seconds"], made["mime"]) == ("audio", "muse", 10.0, "audio/mp4")
    assert made["name"] == "Muse - Slow acoustic guitar, warm..m4a"
    assert client.get(made["url"]).content == b"sound-of-clip-1"
    # Only the audio is kept.
    folder = settings.data_dir / "projects" / pid / "media"
    assert [path.suffix for path in folder.iterdir()] == [".m4a"]


def test_music_without_a_soundtrack_fails_and_leaves_nothing(client, muse, media_tools, monkeypatch, settings):
    def silent(binary, source, target):
        raise MergeError

    monkeypatch.setattr("app.rendering.music.generate_video", muse)
    monkeypatch.setattr("app.rendering.music.find_ffmpeg", lambda settings: "ffmpeg")
    monkeypatch.setattr("app.rendering.music.extract_audio", silent)
    add_account(client)
    project = add_project(client)
    music = f"/api/projects/{project['id']}/media/music"
    assert client.post(music, json={"description": "Piano"}).status_code == 202
    deadline = time.monotonic() + 5
    while (task := client.get(music).json())["status"] != "failed":
        assert time.monotonic() < deadline
        time.sleep(0.02)
    assert task["error"]["code"] == "music_missing"
    assert client.get(f"/api/projects/{project['id']}/media").json() == []
    folder = settings.data_dir / "projects" / project["id"] / "media"
    assert list(folder.iterdir()) == []


def test_caption_style_is_saved_and_used_and_audio_gets_a_waveform(
    client, muse, ffmpeg, media_tools, monkeypatch, settings
):
    drawn = []

    def waveform(binary, source, target):
        drawn.append(source.name)
        target.write_bytes(b"png")
        return True

    monkeypatch.setattr("app.api.routes.media.waveform", waveform)
    styles = []
    compose = __import__("app.rendering.tasks", fromlist=["compose"]).compose
    monkeypatch.setattr(
        "app.rendering.tasks.compose",
        lambda *args, **options: (styles.append(options["caption_style"]), compose(*args, **options)),
    )
    add_account(client)
    project = add_project(client)
    pid = project["id"]
    timeline = f"/api/projects/{pid}/timeline"
    song = upload(client, pid, "song.mp3", "audio/mpeg").json()
    picture = upload(client, pid, "logo.png", "image/png").json()
    client.post(f"/api/projects/{pid}/render")
    wait_status(client, pid, "completed")

    # Drawn the first time it is asked for, then kept; only audio has one.
    assert song["waveformUrl"] and picture["waveformUrl"] is None
    assert client.get(song["waveformUrl"]).content == b"png"
    assert client.get(song["waveformUrl"]).headers["content-type"] == "image/png"
    assert len(drawn) == 1
    assert client.get(picture["url"] + "/waveform").status_code == 404

    start = client.get(timeline).json()
    assert start["captionStyle"] == {
        "size": "medium", "color": "#FFFFFF", "outline": "#000000",
        "position": "bottom", "bold": False, "box": False,
    }
    items = [{"scene": 1, "start": 0, "end": 10}, {"scene": 2, "start": 0, "end": 5}]
    caption = [{"start": 0, "end": 2, "text": "Hello"}]
    for invalid in ({"size": "huge"}, {"color": "yellow"}, {"position": "left"}, {"font": "Arial"}):
        refused = client.put(timeline, json={"items": items, "captions": caption, "captionStyle": invalid})
        assert refused.status_code == 422, invalid

    style = {"size": "large", "color": "#ffe000", "position": "top", "bold": True}
    saved = client.put(
        timeline,
        json={"items": items, "captions": caption, "captionStyle": style,
              "audio": [{"mediaId": song["id"], "end": 20}]},
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["captionStyle"] == {
        "size": "large", "color": "#FFE000", "outline": "#000000",
        "position": "top", "bold": True, "box": False,
    }
    assert body["audio"][0]["waveformUrl"] == song["waveformUrl"]
    wait_status(client, pid, "completed")
    (used,) = styles
    assert (used.size, used.color, used.position, used.bold, used.box) == (0.08, "#FFE000", "top", True, False)

    # Deleting the audio also deletes its drawing.
    client.put(timeline, json={"items": items})
    wait_status(client, pid, "completed")
    assert client.delete(song["url"]).status_code == 204
    folder = settings.data_dir / "projects" / pid / "media"
    assert [path.suffix for path in folder.iterdir()] == [".png"]


@pytest.fixture
def library_tools(monkeypatch, media_tools):
    """Stand in for FFmpeg where library uploads are read."""

    def inspect(binary, path):
        if path.read_bytes() == b"junk":
            raise MergeError
        return {
            ".mp4": MediaInfo(4.0, 640, 360, True),
            ".png": MediaInfo(None, 800, 600, False),
            ".mp3": MediaInfo(20.0, None, None, True),
        }[path.suffix]

    monkeypatch.setattr("app.api.routes.library.find_ffmpeg", lambda settings: "ffmpeg")
    monkeypatch.setattr("app.api.routes.library.inspect", inspect)
    monkeypatch.setattr("app.api.routes.library.thumbnail", lambda binary, clip, target: False)


def keep(client, name, mime, content=b"bytes"):
    return client.post(
        "/api/library", params={"name": name}, content=content, headers={"Content-Type": mime}
    )


def test_library_holds_uploads_and_everything_made_in_video_studio(
    client, muse, ffmpeg, library_tools, settings
):
    assert client.get("/api/library").json() == {
        "items": [], "total": 0, "counts": {"all": 0, "image": 0, "video": 0, "audio": 0},
    }
    assert keep(client, "notes.txt", "text/plain").status_code == 415
    assert keep(client, "empty.png", "image/png", b"").json()["detail"]["code"] == "empty_file"
    junk = keep(client, "broken.mp4", "video/mp4", b"junk")
    assert junk.status_code == 422 and junk.json()["detail"]["code"] == "unreadable_file"
    folder = settings.data_dir / "library"
    assert list(folder.iterdir()) == []

    logo = keep(client, "..\\..\\Logo quán.png", "image/png").json()
    assert (logo["id"], logo["role"], logo["source"], logo["kind"]) == (
        f"upload:{logo['assetId']}", "upload", "upload", "image",
    )
    assert (logo["title"], logo["deletable"], logo["size"], logo["seconds"]) == ("Logo quán.png", True, 5, None)
    song = keep(client, "Nhạc nền.mp3", "audio/mpeg").json()
    assert song["thumbnailUrl"] is None and song["waveformUrl"].endswith("/waveform")
    served = client.get(logo["url"])
    assert served.content == b"bytes" and served.headers["x-content-type-options"] == "nosniff"
    assert client.get(logo["thumbnailUrl"]).content == b"bytes"  # A picture is its own still.

    # A rendered project puts its scene clips and its film in the library.
    add_account(client)
    project = add_project(client)
    client.post(f"/api/projects/{project['id']}/render")
    wait_status(client, project["id"], "completed")
    page = client.get("/api/library").json()
    assert page["counts"] == {"all": 5, "image": 1, "video": 3, "audio": 1} and page["total"] == 5
    by_id = {item["id"]: item for item in page["items"]}
    scene = by_id[f"scene:{project['id']}:2"]
    assert (scene["role"], scene["source"], scene["title"], scene["projectName"], scene["sceneNumber"]) == (
        "scene", "studio", "Harvest", "Coffee film", 2,
    )
    assert not scene["deletable"] and scene["assetId"] is None and scene["seconds"] == 5
    assert client.get(scene["url"]).content == b"clip-2"
    film = by_id[f"film:{project['id']}"]
    assert (film["role"], film["title"], film["kind"]) == ("film", "Coffee film", "video")
    assert client.get(film["url"]).content == b"clip-1|clip-2"

    # Filters: kind, source, and a search that ignores accents and case.
    videos = client.get("/api/library", params={"kind": "video"}).json()
    assert videos["total"] == 3 and videos["counts"]["all"] == 5
    uploads = client.get("/api/library", params={"source": "upload"}).json()
    assert {item["title"] for item in uploads["items"]} == {"Logo quán.png", "Nhạc nền.mp3"}
    assert uploads["counts"] == {"all": 2, "image": 1, "video": 0, "audio": 1}
    found = client.get("/api/library", params={"q": "nhac NEN"}).json()["items"]
    assert [item["title"] for item in found] == ["Nhạc nền.mp3"]
    assert client.get("/api/library", params={"q": "coffee"}).json()["total"] == 3
    paged = client.get("/api/library", params={"limit": 2, "offset": 4}).json()
    assert len(paged["items"]) == 1 and paged["total"] == 5

    # Several files in one archive, each under a name of its own.
    archive = client.get(
        "/api/library/archive", params={"ids": [logo["id"], scene["id"], film["id"], "upload:missing"]}
    )
    assert archive.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(archive.content)).namelist()
    assert names == ["Logo quán.png", "Coffee film - scene 02.mp4", "Coffee film.mp4"]
    assert client.get("/api/library/archive", params={"ids": ["upload:missing"]}).status_code == 404

    # Only uploads can be deleted, with everything kept next to them.
    assert client.delete(f"/api/library/assets/{logo['assetId']}").status_code == 204
    assert client.delete(f"/api/library/assets/{logo['assetId']}").status_code == 404
    assert client.get(logo["url"]).status_code == 404
    assert [path.suffix for path in folder.iterdir()] == [".mp3"]
    assert client.get("/api/library").json()["counts"]["all"] == 4


def test_a_project_takes_copies_of_library_files(
    client, muse, ffmpeg, library_tools, monkeypatch, settings
):
    add_account(client)
    source = add_project(client)
    client.post(f"/api/projects/{source['id']}/render")
    wait_status(client, source["id"], "completed")
    logo = keep(client, "logo.png", "image/png", b"logo").json()
    song = keep(client, "song.mp3", "audio/mpeg", b"song").json()
    target = client.post("/api/projects", json={"name": "Second film", "durationSeconds": 10}).json()
    take = f"/api/projects/{target['id']}/media/import"

    assert client.post("/api/projects/missing/media/import", json={"ids": [logo["id"]]}).status_code == 404
    assert client.post(take, json={"ids": []}).status_code == 422
    missing = client.post(take, json={"ids": [logo["id"], "upload:nope"]})
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "library_item_not_found"
    assert client.get(f"/api/projects/{target['id']}/media").json() == []

    taken = client.post(
        take,
        json={"ids": [logo["id"], song["id"], f"scene:{source['id']}:1", f"film:{source['id']}", logo["id"]]},
    )
    assert taken.status_code == 201, taken.text
    media = taken.json()
    assert [(m["kind"], m["name"], m["seconds"], m["width"]) for m in media] == [
        ("image", "logo.png", None, 800),
        ("audio", "song.mp3", 20.0, None),
        # A clip made in Video Studio is measured as it is copied.
        ("video", "Coffee film - scene 01.mp4", 4.0, 640),
        ("video", "Coffee film.mp4", 4.0, 640),
    ]
    assert client.get(media[0]["url"]).content == b"logo"
    assert client.get(media[2]["url"]).content == b"clip-1"

    # Copies: deleting the original leaves the project's file alone.
    assert client.delete(f"/api/library/assets/{logo['assetId']}").status_code == 204
    assert client.get(media[0]["url"]).content == b"logo"
    assert len(client.get(f"/api/projects/{target['id']}/media").json()) == 4

    # The project's own limit still holds, and nothing is half-copied.
    for _ in range(26):
        assert client.post(take, json={"ids": [song["id"]]}).status_code == 201
    over = client.post(take, json={"ids": [song["id"]]})
    assert over.status_code == 409 and over.json()["detail"]["code"] == "too_many_files"
    folder = settings.data_dir / "projects" / target["id"] / "media"
    assert len(list(folder.iterdir())) == 30
