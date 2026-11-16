"""Quick Create sends a whole batch to one conversation and preserves partial output."""

import json
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.integrations.muse.client import MuseError, SessionResult
from app.integrations.muse.media import GeneratedMedia
from app.main import create_app
from app.models import LibraryAsset, Task
from app.rendering import storage
from app.rendering.ffmpeg import MediaInfo
from app.tasks.kinds import QUICK_KINDS
from test_tasks import import_account, wait_for


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr("app.rendering.quick_create.find_ffmpeg", lambda _: "ffmpeg")
    monkeypatch.setattr("app.rendering.quick_create.thumbnail", lambda *args: None)
    monkeypatch.setattr("app.rendering.quick_create.inspect", lambda *args: MediaInfo(
        seconds=10 if args[1].suffix == ".mp4" else None,
        width=1280, height=720, has_audio=False,
    ))
    app = create_app(Settings(_env_file=None, data_dir=tmp_path))
    app.state.task_coordinator.poll_interval = 0.02
    with TestClient(app) as client:
        yield client


def request(**values):
    return {"kind": "image", "prompt": "A quiet garden", "aspectRatio": "16:9", "count": 1, **values}


def submitted(kwargs):
    result = SessionResult({"hatch_sess": "quick-fixture"}, {}, "RUNNING")
    kwargs["on_session"](result)
    kwargs["before_send"](result)
    kwargs["on_thread"]("/thread/batch-001")


def saved_files(client):
    """The bytes of every file Quick Create saved, oldest first."""
    settings = client.app.state.settings
    with client.app.state.database.sessions() as session:
        assets = session.scalars(
            select(LibraryAsset)
            .where(LibraryAsset.source == "quick")
            .order_by(LibraryAsset.created_at)
        ).all()
        return [(storage.library_dir(settings) / asset.file).read_bytes() for asset in assets]


def fake_generate(*args, **kwargs):
    submitted(kwargs)
    images = [GeneratedMedia(f"image {i}".encode(), "image/png", 1280, 720)
        for i in range(kwargs["count"])]
    for image in images:
        kwargs["on_media"](image)
    return images


@pytest.mark.parametrize("count", [4, 7])
def test_all_images_use_one_task_and_one_upstream_request(client, monkeypatch, count):
    calls = []

    def generate(*args, **kwargs):
        calls.append((args[4], kwargs))
        return fake_generate(*args, **kwargs)

    monkeypatch.setattr("app.rendering.quick_create.generate_images", generate)
    import_account(client, "Quick", "quick-fixture")
    response = client.post("/api/quick-create", json=request(count=count))
    assert response.status_code == 202, response.text
    batch = response.json()
    assert len(batch["tasks"]) == 1
    task = wait_for(client, batch["tasks"][0]["id"], "succeeded", "failed")
    assert task["status"] == "succeeded", task
    assert len(calls) == 1 and calls[0][1]["count"] == count
    assert f"exactly {count} separate images" in calls[0][0]
    recent = client.get("/api/quick-create").json()
    assert recent[0]["id"] == batch["id"]
    assert recent[0]["completedCount"] == count
    assert len(recent[0]["items"]) == count
    assert all(item["source"] == "quick" for item in recent[0]["items"])
    listed = client.get("/api/library?source=quick").json()
    assert listed["total"] == count
    assert "quick-fixture" not in json.dumps(recent)


@pytest.mark.parametrize("values", [
    {"count": 0}, {"count": 101}, {"count": 5.5}, {"count": True},
    {"prompt": "   "}, {"kind": "video", "count": 2}, {"aspectRatio": "4:3"},
])
def test_invalid_requests_enqueue_nothing(client, values):
    assert client.post("/api/quick-create", json=request(**values)).status_code == 422
    assert client.get("/api/quick-create").json() == []


def test_account_required(client):
    response = client.post("/api/quick-create", json=request())
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "account_unavailable"


def reference_asset(client):
    settings = client.app.state.settings
    storage.write(storage.library_dir(settings) / "reference.png", b"reference")
    with client.app.state.database.sessions() as session:
        asset = LibraryAsset(kind="image", name="Reference", file="reference.png",
            mime="image/png", size=9, width=100, height=100)
        session.add(asset)
        session.commit()
        return asset.id


@pytest.mark.parametrize("kind", ["image", "video"])
def test_reference_bytes_are_passed_to_muse_for_images_and_video(client, monkeypatch, kind):
    seen = []

    def generate(*args, **kwargs):
        seen.append((args[4], kwargs))
        submitted(kwargs)
        media = GeneratedMedia(b"image" if kind == "image" else b"video",
            "image/png" if kind == "image" else "video/mp4", 1280, 720)
        kwargs["on_media"](media)
        return [media] if kind == "image" else media

    monkeypatch.setattr("app.rendering.quick_create." + (
        "generate_images" if kind == "image" else "generate_video"), generate)
    import_account(client, "Quick", "quick-fixture")
    response = client.post("/api/quick-create", json=request(kind=kind, referenceAssetId=reference_asset(client)))
    assert response.status_code == 202
    task = wait_for(client, response.json()["tasks"][0]["id"], "succeeded", "failed")
    assert task["status"] == "succeeded", task
    assert seen[0][1]["attachments"] == [{"name": "reference.png", "mimeType": "image/png", "buffer": b"reference"}]
    assert seen[0][1]["attach_on_continue"] is True
    assert ("visual reference" if kind == "image" else "starting frame") in seen[0][0]
    if kind == "video":
        assert "10 seconds long" in seen[0][0]
        assert client.get("/api/quick-create").json()[0]["items"][0]["seconds"] == 10


def test_missing_reference_fails_before_enqueue(client):
    import_account(client, "Quick", "quick-fixture")
    response = client.post("/api/quick-create", json=request(referenceAssetId="gone"))
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "reference_missing"


def test_partial_batch_retry_uses_same_thread_and_only_asks_for_missing_images(client, monkeypatch):
    calls, taken = [], []

    def generate(*args, **kwargs):
        calls.append(kwargs)
        submitted(kwargs)
        kwargs["on_marker"](f"shot-0000000{len(calls)}", "/thread/batch-001")
        kwargs["on_media"](
            GeneratedMedia(b"image bytes", "image/png", 1280, 720, name=f"garden {len(calls)}")
        )
        if len(calls) == 1:
            raise MuseError("generation_timeout", 504)
        return []

    def recover(*args, **kwargs):
        taken.append(kwargs)
        # The page shows the saved picture again (smaller), nothing more.
        shown = [GeneratedMedia(b"smaller copy", "image/png", 498, 498, name="garden 1")]
        return [image for image in shown if image.name not in kwargs["skip"]][: kwargs["count"]]

    monkeypatch.setattr("app.rendering.quick_create.generate_images", generate)
    monkeypatch.setattr("app.rendering.quick_create.recover_media", recover)
    import_account(client, "Quick", "quick-fixture")
    batch = client.post("/api/quick-create", json=request(count=2, referenceAssetId=reference_asset(client))).json()
    task_id = batch["tasks"][0]["id"]
    task = wait_for(client, task_id, "succeeded", "failed")
    assert task["status"] == "failed"
    recent = client.get("/api/quick-create").json()[0]
    assert recent["completedCount"] == 1 and len(recent["items"]) == 1
    first_id = recent["items"][0]["assetId"]
    response = client.post(f"/api/tasks/{task_id}/retry", json={})
    assert response.status_code == 200
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "succeeded"
    assert len(calls) == 2
    assert calls[0]["count"] == 2 and calls[0]["thread_path"] is None
    assert calls[1]["count"] == 1 and calls[1]["thread_path"] == "/thread/batch-001"
    assert calls[1]["require_thread"] is True
    assert calls[1]["attachments"][0]["buffer"] == b"reference"
    recent = client.get("/api/quick-create").json()[0]
    assert recent["completedCount"] == 2 and len(recent["items"]) == 2
    assert recent["items"][0]["assetId"] == first_id
    assert [(k["marker"], k["count"], k["skip"]) for k in taken] == [("shot-00000001", 1, ["garden 1"])]
    assert b"smaller copy" not in saved_files(client)


def test_deleted_result_does_not_change_completed_count(client, monkeypatch):
    monkeypatch.setattr("app.rendering.quick_create.generate_images", fake_generate)
    import_account(client, "Quick", "quick-fixture")
    batch = client.post("/api/quick-create", json=request(count=2)).json()
    assert wait_for(client, batch["tasks"][0]["id"], "succeeded", "failed")["status"] == "succeeded"
    item = client.get("/api/quick-create").json()[0]["items"][0]
    assert client.delete(f"/api/library/assets/{item['assetId']}").status_code == 204
    recent = client.get("/api/quick-create").json()[0]
    assert recent["completedCount"] == 2 and len(recent["items"]) == 1


def test_dismiss_entire_batch_persists_and_undo_keeps_files_and_tasks(client, monkeypatch):
    monkeypatch.setattr("app.rendering.quick_create.generate_images", fake_generate)
    import_account(client, "Quick", "quick-fixture")
    first = client.post("/api/quick-create", json=request(count=4)).json()
    second = client.post("/api/quick-create", json=request(count=1)).json()
    for batch in (first, second):
        assert wait_for(client, batch["tasks"][0]["id"], "succeeded", "failed")["status"] == "succeeded"
    before = next(batch for batch in client.get("/api/quick-create").json() if batch["id"] == first["id"])
    assert len(before["items"]) == 4
    path = f"/api/quick-create/{first['id']}"
    assert client.delete(path).status_code == 204
    assert client.delete(path).status_code == 204
    for _ in range(2):
        assert [batch["id"] for batch in client.get("/api/quick-create").json()] == [second["id"]]
    assert client.get("/api/library?source=quick").json()["total"] == 5
    assert client.get(f"/api/tasks/{first['tasks'][0]['id']}").json()["status"] == "succeeded"
    for item in before["items"]:
        assert client.get(item["url"]).status_code == 200
    assert client.post(path + "/restore").status_code == 204
    restored = next(batch for batch in client.get("/api/quick-create").json() if batch["id"] == first["id"])
    assert [item["id"] for item in restored["items"]] == [item["id"] for item in before["items"]]
    assert restored["completedCount"] == 4


def test_dismiss_missing_batch_returns_not_found(client):
    for response in (
        client.delete("/api/quick-create/missing"),
        client.post("/api/quick-create/missing/restore"),
    ):
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "quick_create_not_found"


def test_too_few_images_keeps_received_outputs_and_reports_missing_count(client, monkeypatch):
    def incomplete(*args, **kwargs):
        submitted(kwargs)
        kwargs["on_media"](GeneratedMedia(b"one image", "image/png", 1280, 720))
        return []

    monkeypatch.setattr("app.rendering.quick_create.generate_images", incomplete)
    import_account(client, "Quick", "quick-fixture")
    batch = client.post("/api/quick-create", json=request(count=4)).json()
    task = wait_for(client, batch["tasks"][0]["id"], "succeeded", "failed")
    assert task["status"] == "failed"
    assert task["error"]["code"] == "image_count_mismatch"
    recent = client.get("/api/quick-create").json()[0]
    assert recent["completedCount"] == 1 and len(recent["items"]) == 1


def test_retry_does_not_open_another_chat_when_sent_thread_id_is_unknown(client, monkeypatch):
    calls = []

    def interrupted(*args, **kwargs):
        calls.append(1)
        result = SessionResult({"hatch_sess": "quick-fixture"}, {}, "RUNNING")
        kwargs["on_session"](result)
        kwargs["before_send"](result)
        raise MuseError("generation_browser_error")

    monkeypatch.setattr("app.rendering.quick_create.generate_images", interrupted)
    import_account(client, "Quick", "quick-fixture")
    batch = client.post("/api/quick-create", json=request(count=4)).json()
    task_id = batch["tasks"][0]["id"]
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "failed"
    assert client.post(f"/api/tasks/{task_id}/retry", json={}).status_code == 200
    retried = wait_for(client, task_id, "succeeded", "failed")
    assert retried["error"]["code"] == "conversation_unavailable"
    assert len(calls) == 1


def test_capacity_reserves_image_count_instead_of_task_count(client, monkeypatch):
    release = threading.Event()
    monkeypatch.setattr("app.rendering.quick_create.library.MAX_ASSETS", 5)

    def blocked(*args, **kwargs):
        release.wait(5)
        return fake_generate(*args, **kwargs)

    monkeypatch.setattr("app.rendering.quick_create.generate_images", blocked)
    import_account(client, "Quick", "quick-fixture")
    try:
        first = client.post("/api/quick-create", json=request(count=4))
        assert first.status_code == 202
        response = client.post("/api/quick-create", json=request(count=2))
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "too_many_files"
        with client.app.state.database.sessions() as session:
            assert len(list(session.scalars(select(Task).where(Task.kind.in_(QUICK_KINDS))))) == 1
    finally:
        release.set()


def test_every_new_request_opens_its_own_conversation(client, monkeypatch):
    calls, prompts = [], []

    def generate(*args, **kwargs):
        calls.append(kwargs)
        prompts.append(args[4])
        return fake_generate(*args, **kwargs)

    monkeypatch.setattr("app.rendering.quick_create.generate_images", generate)
    import_account(client, "Quick", "quick-fixture")
    for prompt in ("A quiet garden", "A busy street"):
        task_id = client.post("/api/quick-create", json=request(prompt=prompt, count=4)).json()["tasks"][0]["id"]
        assert wait_for(client, task_id, "succeeded", "failed")["status"] == "succeeded"
    # The user's rule (2026-11-17): a new request, a new chat.
    assert [call["thread_path"] for call in calls] == [None, None]
    # A request of its own: nothing about earlier requests.
    assert prompts[1].startswith("Generate exactly 4 separate images") and "Context:" not in prompts[1]


def test_reusing_a_prompt_continues_the_conversation_it_came_from(client, monkeypatch):
    calls, prompts = [], []

    def generate(*args, **kwargs):
        calls.append(kwargs)
        prompts.append(args[4])
        return fake_generate(*args, **kwargs)

    monkeypatch.setattr("app.rendering.quick_create.generate_images", generate)
    import_account(client, "Quick", "quick-fixture")
    first = client.post("/api/quick-create", json=request(count=2)).json()
    wait_for(client, first["tasks"][0]["id"], "succeeded", "failed")
    again = client.post("/api/quick-create", json=request(count=2, reuseOf=first["id"])).json()
    assert wait_for(client, again["tasks"][0]["id"], "succeeded", "failed")["status"] == "succeeded"
    fresh = client.post("/api/quick-create", json=request(count=2)).json()
    wait_for(client, fresh["tasks"][0]["id"], "succeeded", "failed")
    assert [call["thread_path"] for call in calls] == [None, "/thread/batch-001", None]
    assert "a new request in this conversation" in prompts[1]


def test_a_retry_takes_back_what_muse_made_before_asking_again(client, monkeypatch):
    calls, prompts, taken = [], [], []

    def generate(*args, **kwargs):
        calls.append(kwargs)
        prompts.append(args[4])
        submitted(kwargs)
        kwargs["on_marker"]("shot-0000aaaa", "/thread/batch-001")
        if len(calls) == 1:
            # Sent; the app lost the outcome before any image was seen.
            raise MuseError("generation_timeout", 504)
        image = GeneratedMedia(b"made on retry", "image/png", 1280, 720)
        kwargs["on_media"](image)
        return [image]

    def recover(*args, **kwargs):
        taken.append(kwargs)
        # Muse made two of the three images meanwhile.
        return [
            GeneratedMedia(b"made meanwhile 1", "image/png", 1280, 720),
            GeneratedMedia(b"made meanwhile 2", "image/png", 1280, 720),
        ]

    monkeypatch.setattr("app.rendering.quick_create.generate_images", generate)
    monkeypatch.setattr("app.rendering.quick_create.recover_media", recover)
    import_account(client, "Quick", "quick-fixture")
    batch = client.post("/api/quick-create", json=request(count=3)).json()
    task_id = batch["tasks"][0]["id"]
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "failed"
    assert client.post(f"/api/tasks/{task_id}/retry", json={}).status_code == 200
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "succeeded"
    assert [(k["thread_path"], k["marker"], k["count"]) for k in taken] == [
        ("/thread/batch-001", "shot-0000aaaa", 3)
    ]
    # Only the missing image was asked for, in the same conversation.
    assert len(calls) == 2 and calls[1]["count"] == 1
    assert "2 of its outputs are already saved; create only the 1 remaining images" in prompts[1]
    recent = client.get("/api/quick-create").json()[0]
    assert recent["completedCount"] == 3


def test_a_retry_with_everything_taken_back_sends_nothing(client, monkeypatch):
    calls = []

    def generate(*args, **kwargs):
        calls.append(kwargs)
        submitted(kwargs)
        kwargs["on_marker"]("shot-0000bbbb", "/thread/batch-001")
        raise MuseError("generation_timeout", 504)

    monkeypatch.setattr("app.rendering.quick_create.generate_video", generate)
    monkeypatch.setattr(
        "app.rendering.quick_create.recover_media",
        lambda *args, **kwargs: GeneratedMedia(b"the video", "video/mp4", 1280, 720),
    )
    import_account(client, "Quick", "quick-fixture")
    batch = client.post("/api/quick-create", json=request(kind="video", count=1)).json()
    task_id = batch["tasks"][0]["id"]
    wait_for(client, task_id, "succeeded", "failed")
    client.post(f"/api/tasks/{task_id}/retry", json={})
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "succeeded"
    assert len(calls) == 1


def test_a_retry_takes_back_only_the_pictures_not_saved_yet(client, monkeypatch):
    # Codex review, 2026-11-17: picture A saved, then the app lost the
    # outcome; taking the answer back returned A again and B was never saved.
    calls, taken = [], []

    def generate(*args, **kwargs):
        calls.append(kwargs)
        submitted(kwargs)
        kwargs["on_marker"]("shot-0000eeee", "/thread/batch-001")
        kwargs["on_media"](GeneratedMedia(b"cat A", "image/png", 1600, 1600, name="cat 1"))
        raise MuseError("generation_timeout", 504)

    def recover(*args, **kwargs):
        taken.append(kwargs)
        # The answer as a reloaded page shows it: both pictures, smaller.
        shown = [
            GeneratedMedia(b"cat A smaller", "image/png", 498, 498, name="cat 1"),
            GeneratedMedia(b"cat B smaller", "image/png", 498, 498, name="cat 2"),
        ]
        return [i for i in shown if i.name not in kwargs.get("skip", ())][: kwargs["count"]]

    monkeypatch.setattr("app.rendering.quick_create.generate_images", generate)
    monkeypatch.setattr("app.rendering.quick_create.recover_media", recover)
    import_account(client, "Quick", "quick-fixture")
    task_id = client.post("/api/quick-create", json=request(count=2)).json()["tasks"][0]["id"]
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "failed"
    client.post(f"/api/tasks/{task_id}/retry", json={})
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "succeeded"
    assert saved_files(client) == [b"cat A", b"cat B smaller"]
    assert len(calls) == 1
    # Read as a set of pictures, although only one is missing.
    assert [(k["count"], k["skip"], k["many"]) for k in taken] == [(1, ["cat 1"], True)]


def test_a_refused_request_is_sent_again_on_retry_not_read_again(client, monkeypatch):
    calls, taken = [], []

    def generate(*args, **kwargs):
        calls.append(kwargs)
        submitted(kwargs)
        kwargs["on_marker"](f"shot-0000f00{len(calls)}", "/thread/batch-001")
        if len(calls) == 1:
            raise MuseError("generation_refused")
        video = GeneratedMedia(b"the video", "video/mp4", 1280, 720)
        kwargs["on_media"](video)
        return video

    def recover(*args, **kwargs):
        # The same refusal, read again.
        taken.append(kwargs)
        raise MuseError("generation_refused")

    monkeypatch.setattr("app.rendering.quick_create.generate_video", generate)
    monkeypatch.setattr("app.rendering.quick_create.recover_media", recover)
    import_account(client, "Quick", "quick-fixture")
    task_id = client.post("/api/quick-create", json=request(kind="video")).json()["tasks"][0]["id"]
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "failed"
    client.post(f"/api/tasks/{task_id}/retry", json={})
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "succeeded"
    assert len(calls) == 2 and taken == []
    assert calls[1]["thread_path"] == "/thread/batch-001"


def test_a_refusal_found_when_taking_back_lets_the_next_retry_send_again(client, monkeypatch):
    calls, taken = [], []

    def generate(*args, **kwargs):
        calls.append(kwargs)
        submitted(kwargs)
        kwargs["on_marker"](f"shot-0000a1b{len(calls)}", "/thread/batch-001")
        if len(calls) == 1:
            raise MuseError("generation_timeout", 504)
        video = GeneratedMedia(b"the video", "video/mp4", 1280, 720)
        kwargs["on_media"](video)
        return video

    def recover(*args, **kwargs):
        taken.append(kwargs)
        raise MuseError("generation_refused")

    monkeypatch.setattr("app.rendering.quick_create.generate_video", generate)
    monkeypatch.setattr("app.rendering.quick_create.recover_media", recover)
    import_account(client, "Quick", "quick-fixture")
    task_id = client.post("/api/quick-create", json=request(kind="video")).json()["tasks"][0]["id"]
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "failed"
    client.post(f"/api/tasks/{task_id}/retry", json={})
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "failed"
    client.post(f"/api/tasks/{task_id}/retry", json={})
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "succeeded"
    assert len(taken) == 1 and len(calls) == 2


def test_a_reused_prompt_runs_on_the_account_of_its_conversation(client, monkeypatch):
    sessions = []

    def generate(*args, **kwargs):
        sessions.append(args[1].get("hatch_sess"))
        return fake_generate(*args, **kwargs)

    monkeypatch.setattr("app.rendering.quick_create.generate_images", generate)
    import_account(client, "Quick", "quick-fixture")
    first = client.post("/api/quick-create", json=request(count=2)).json()
    wait_for(client, first["tasks"][0]["id"], "succeeded", "failed")
    # Never used: the account an unpinned request would get first.
    import_account(client, "Other", "other-fixture")
    again = client.post("/api/quick-create", json=request(count=2, reuseOf=first["id"])).json()
    assert wait_for(client, again["tasks"][0]["id"], "succeeded", "failed")["status"] == "succeeded"
    fresh = client.post("/api/quick-create", json=request(count=2)).json()
    wait_for(client, fresh["tasks"][0]["id"], "succeeded", "failed")
    assert sessions == ["quick-fixture", "quick-fixture", "other-fixture"]


def test_files_saved_without_names_are_not_taken_back_again(client, monkeypatch):
    # Codex review, 2026-11-17: a task checkpointed by a version that kept no
    # names took a saved picture back again on retry.
    calls, taken = [], []

    def generate(*args, **kwargs):
        calls.append(kwargs)
        submitted(kwargs)
        kwargs["on_marker"]("shot-0000c0de", "/thread/batch-001")
        number = len(calls)
        kwargs["on_media"](
            GeneratedMedia(f"cat {number}".encode(), "image/png", 1600, 1600, name=f"cat {number}")
        )
        if number == 1:
            raise MuseError("generation_timeout", 504)
        return []

    def recover(*args, **kwargs):
        taken.append(kwargs)
        return [GeneratedMedia(b"cat 1 smaller", "image/png", 498, 498, name="cat 1")]

    monkeypatch.setattr("app.rendering.quick_create.generate_images", generate)
    monkeypatch.setattr("app.rendering.quick_create.recover_media", recover)
    import_account(client, "Quick", "quick-fixture")
    task_id = client.post("/api/quick-create", json=request(count=2)).json()["tasks"][0]["id"]
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "failed"
    with client.app.state.database.sessions() as session:
        task = session.get(Task, task_id)
        checkpoint = json.loads(task.checkpoint_json)
        checkpoint.pop("names", None)
        task.checkpoint_json = json.dumps(checkpoint)
        session.commit()
    client.post(f"/api/tasks/{task_id}/retry", json={})
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "succeeded"
    assert taken == [] and len(calls) == 2 and calls[1]["count"] == 1
    assert saved_files(client) == [b"cat 1", b"cat 2"]


def test_out_of_quota_a_retry_on_another_account_starts_a_chat_of_its_own(client, monkeypatch):
    # Codex review, 2026-11-17: the chat of the account that ran out was kept,
    # so a retry on another account could only fail (conversation_unavailable).
    calls = []

    def generate(*args, **kwargs):
        calls.append((args[1].get("hatch_sess"), kwargs["thread_path"]))
        # Each account reports its own session.
        result = SessionResult(dict(args[1]), {}, "RUNNING")
        kwargs["on_session"](result)
        kwargs["before_send"](result)
        kwargs["on_thread"]("/thread/batch-001")
        kwargs["on_marker"]("shot-0000d0d0", "/thread/batch-001")
        if len(calls) == 1:
            raise MuseError("quota_exhausted", 429)
        video = GeneratedMedia(b"the video", "video/mp4", 1280, 720)
        kwargs["on_media"](video)
        return video

    monkeypatch.setattr("app.rendering.quick_create.generate_video", generate)
    import_account(client, "Quick", "quick-fixture")
    task_id = client.post("/api/quick-create", json=request(kind="video")).json()["tasks"][0]["id"]
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "failed"
    import_account(client, "Other", "other-fixture")
    assert client.post(f"/api/tasks/{task_id}/retry", json={"switchAccount": True}).status_code == 200
    assert wait_for(client, task_id, "succeeded", "failed")["status"] == "succeeded"
    assert calls == [("quick-fixture", None), ("other-fixture", None)]


def test_after_the_app_stopped_mid_request_a_confirmed_retry_takes_back_first(client, monkeypatch):
    # What the user sees as "The app stopped after this request was sent to
    # Muse. Check the result before retrying." (2026-11-17): the process
    # ended while the task ran, after sending and after one picture was saved.
    from sqlalchemy import update

    from app.tasks.coordinator import utcnow

    calls, taken = [], []

    def generate(*args, **kwargs):
        calls.append(kwargs)
        submitted(kwargs)
        kwargs["on_marker"]("shot-0000beef", "/thread/batch-001")
        kwargs["on_media"](GeneratedMedia(b"cat 1", "image/png", 1600, 1600, name="cat 1"))
        raise MuseError("generation_timeout", 504)

    def recover(*args, **kwargs):
        taken.append(kwargs)
        # The answer as a reloaded page shows it: both pictures, smaller.
        shown = [
            GeneratedMedia(b"cat 1 smaller", "image/png", 498, 498, name="cat 1"),
            GeneratedMedia(b"cat 2 smaller", "image/png", 498, 498, name="cat 2"),
        ]
        return [i for i in shown if i.name not in kwargs["skip"]][: kwargs["count"]]

    monkeypatch.setattr("app.rendering.quick_create.generate_images", generate)
    monkeypatch.setattr("app.rendering.quick_create.recover_media", recover)
    import_account(client, "Quick", "quick-fixture")
    task_id = client.post("/api/quick-create", json=request(count=2)).json()["tasks"][0]["id"]
    wait_for(client, task_id, "succeeded", "failed")
    # As a stop of the app leaves it: still running, already sent.
    client.app.state.task_coordinator.stop()
    with client.app.state.database.sessions() as session:
        session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(status="running", finished_at=None, submitted_at=utcnow())
        )
        session.commit()
    restarted = create_app(client.app.state.settings)
    restarted.state.task_coordinator.poll_interval = 0.02
    with TestClient(restarted) as again:
        task = again.get(f"/api/tasks/{task_id}").json()
        assert task["status"] == "interrupted" and task["error"]["code"] == "interrupted"
        # As in the UI: a plain retry asks for confirmation first.
        assert again.post(f"/api/tasks/{task_id}/retry", json={}).status_code == 409
        response = again.post(f"/api/tasks/{task_id}/retry", json={"confirmDuplicate": True})
        assert response.status_code == 200
        assert wait_for(again, task_id, "succeeded", "failed")["status"] == "succeeded"
        assert saved_files(again) == [b"cat 1", b"cat 2 smaller"]
    # Taken back from the conversation; nothing was sent again.
    assert len(calls) == 1
    assert [(k["marker"], k["skip"], k["count"]) for k in taken] == [("shot-0000beef", ["cat 1"], 1)]
