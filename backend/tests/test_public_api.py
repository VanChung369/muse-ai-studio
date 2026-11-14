import base64
import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.integrations.muse.client import MuseError
from app.integrations.muse.media import GeneratedMedia
from app.main import create_app
from app.models import Task
from test_quick_create import submitted
from test_tasks import import_account, wait_for


def fake_generate(*args, **kwargs):
    submitted(kwargs)
    video = "count" not in kwargs
    for i in range(kwargs.get("count", 1)):
        kwargs["on_media"](GeneratedMedia(f"media {i}".encode(),
            "video/mp4" if video else "image/png", 1280, 720))


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app.rendering.ffmpeg import MediaInfo

    monkeypatch.setattr("app.rendering.quick_create.find_ffmpeg", lambda _: "ffmpeg")
    monkeypatch.setattr("app.rendering.quick_create.thumbnail", lambda *args: None)
    monkeypatch.setattr("app.rendering.quick_create.inspect", lambda *args: MediaInfo(
        seconds=10 if args[1].suffix == ".mp4" else None,
        width=1280, height=720, has_audio=False))
    monkeypatch.setattr("app.rendering.quick_create.generate_images", fake_generate)
    monkeypatch.setattr("app.rendering.quick_create.generate_video", fake_generate)
    monkeypatch.setattr("app.api.routes.public_api.POLL_INTERVAL", 0.02)
    app = create_app(Settings(_env_file=None, data_dir=tmp_path, session_refresh_minutes=0))
    app.state.task_coordinator.poll_interval = 0.02
    with TestClient(app) as client:
        yield client


@pytest.fixture
def headers(client):
    key = client.post("/api/api-keys", json={"name": "Tests"}).json()["key"]
    return {"Authorization": "Bearer " + key}


@pytest.fixture
def ready(client, headers):
    import_account(client, "Public", "quick-fixture")
    return headers


def assert_error(response, status, code, type="invalid_request_error"):
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == code
    assert body["error"]["type"] == type
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]


@pytest.mark.parametrize("authorization", [None, "wrong", "Basic abc", "Bearer nope",
    "Bearer sk-muse-" + "0" * 48, "Bearer sk-muse-" + "A" * 48])
def test_bad_authentication(client, authorization):
    assert_error(client.get("/v1/models", headers={"Authorization": authorization}
        if authorization else {}), 401, "invalid_api_key")


def test_revoked_key_is_rejected_immediately(client, headers):
    assert client.get("/v1/models", headers=headers).status_code == 200
    key_id = client.get("/api/api-keys").json()[0]["id"]
    assert client.delete(f"/api/api-keys/{key_id}").status_code == 204
    assert_error(client.post("/v1/images/generations", headers=headers,
        json={"prompt": "Image"}), 401, "invalid_api_key")


def test_models_and_unknown_path(client, headers):
    assert client.get("/v1/models", headers=headers).json() == {"object": "list", "data": [
        {"id": model, "object": "model", "created": 1763078400, "owned_by": "muse"}
        for model in ("muse-image", "muse-video")]}
    assert_error(client.get("/v1/missing", headers=headers), 404, "not_found")
    assert_error(client.post("/v1/models", headers=headers), 405, "invalid_request")


@pytest.mark.parametrize("path,body", [
    ("images/generations", {}), ("images/generations", {"prompt": " "}),
    ("images/generations", {"prompt": "x" * 4001}),
    *[("images/generations", {"prompt": "x", **value}) for value in [
        {"model": "gpt-image-1"}, {"n": 0}, {"n": 5}, {"n": True}, {"n": 1.5},
        {"n": "2"}, {"size": "256x256"}, {"aspect_ratio": "4:3"}, {"response_format": "bytes"}]],
    ("videos/generations", {"prompt": "x", "model": "muse-image"}),
    ("videos/generations", {"prompt": "x", "aspect_ratio": "4:3"}),
    ("chat/completions", {"model": "muse-image", "messages": []}),
    ("chat/completions", {"model": "muse-image", "messages": [{"role": "system", "content": "x"}]}),
    ("chat/completions", {"model": "muse-image", "messages": [{"role": "user", "content": " "}]}),
    ("chat/completions", {"model": "unknown", "messages": []}),
])
def test_validation_is_public_400_and_queues_nothing(client, headers, path, body):
    assert_error(client.post("/v1/" + path, json=body, headers=headers), 400, "invalid_request")
    assert client.get("/api/tasks").json()["total"] == 0


def test_malformed_json(client, headers):
    assert_error(client.post("/v1/images/generations", content="{broken",
        headers={**headers, "Content-Type": "application/json"}), 400, "invalid_request")


@pytest.mark.parametrize("shape,ratio", [({}, "1:1"),
    ({"size": "1024x1024"}, "1:1"), ({"size": "1792x1024"}, "16:9"),
    ({"size": "1536x1024"}, "16:9"), ({"size": "1024x1792"}, "9:16"),
    ({"size": "1024x1536"}, "9:16"),
    *[({"aspect_ratio": value}, value) for value in ("1:1", "16:9", "9:16")]])
def test_images_shapes_batch_library_and_history(client, ready, shape, ratio):
    response = client.post("/v1/images/generations", headers=ready,
        json={"prompt": "  A glass of iced coffee  ", "n": 2, "user": "ignored", **shape})
    assert response.status_code == 200, response.text
    data = response.json()
    assert isinstance(data["created"], int)
    assert len(data["data"]) == 2
    for i, item in enumerate(data["data"]):
        assert item["url"].startswith("http://testserver/api/library/assets/")
        assert client.get(item["url"]).content == f"media {i}".encode()
    task_id = response.headers["X-Muse-Task-Id"]
    with client.app.state.database.sessions() as session:
        payload = json.loads(session.get(Task, task_id).payload_json)
        assert payload["aspectRatio"] == ratio and payload["prompt"] == "A glass of iced coffee"
        assert payload["source"] == "api" and payload["hidden"] == 1 and payload["apiKeyId"]
    assert client.get("/api/quick-create").json() == []
    library = client.get("/api/library?source=api").json()
    assert library["total"] == 2 and all(item["source"] == "api" for item in library["items"])
    assert client.get("/api/tasks").json()["items"][0]["id"] == task_id


def test_base64_and_request_host(client, ready):
    response = client.post("https://public.example/v1/images/generations", headers=ready,
        json={"prompt": "A bird", "response_format": "b64_json"})
    assert response.status_code == 200
    assert response.json()["data"] == [{"b64_json": base64.b64encode(b"media 0").decode()}]
    response = client.post("https://public.example/v1/images/generations", headers=ready,
        json={"prompt": "A bird"})
    assert response.json()["data"][0]["url"].startswith("https://public.example/api/")


def test_video_queues_immediately_then_any_key_can_poll(client, ready, monkeypatch):
    entered, release = threading.Event(), threading.Event()

    def generate(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        fake_generate(*args, **kwargs)

    monkeypatch.setattr("app.rendering.quick_create.generate_video", generate)
    try:
        response = client.post("/v1/videos/generations", headers=ready, json={"prompt": "Moving clouds"})
        assert response.status_code == 202
        body = response.json()
        assert body["status"] == "queued" and body["object"] == "video.generation"
        assert body["model"] == "muse-video" and "data" not in body
        assert entered.wait(5)
        other = client.post("/api/api-keys", json={"name": "Other"}).json()["key"]
        headers = {"Authorization": "Bearer " + other}
        path = "/v1/videos/generations/" + body["id"]
        assert client.get(path, headers=headers).json()["status"] == "in_progress"
    finally:
        release.set()
    wait_for(client, body["id"], "succeeded")
    result = client.get(path, headers=headers).json()
    assert result["status"] == "succeeded" and len(result["data"]) == 1
    assert client.get(result["data"][0]["url"]).content == b"media 0"
    assert_error(client.get("/v1/videos/generations/missing", headers=ready), 404, "not_found")


@pytest.mark.parametrize("model", ["muse-image", "muse-video"])
def test_chat_uses_last_user_text_parts(client, ready, model):
    response = client.post("/v1/chat/completions", headers=ready, json={"model": model,
        "messages": [{"role": "user", "content": "Old prompt"}, {"role": "user", "content": [
            {"type": "text", "text": "A red fox"}, {"type": "image_url", "image_url": {}},
            {"type": "text", "text": "in snow"}]}, {"role": "assistant", "content": "Ignored"}]})
    assert response.status_code == 200, response.text
    body = response.json()
    task_id = response.headers["X-Muse-Task-Id"]
    assert body["id"] == "chatcmpl-" + task_id and body["object"] == "chat.completion"
    assert body["model"] == model and body["choices"][0]["finish_reason"] == "stop"
    content = body["choices"][0]["message"]["content"]
    assert content.startswith("![image](" if model == "muse-image" else "[video](")
    assert body["usage"] == {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    with client.app.state.database.sessions() as session:
        assert json.loads(session.get(Task, task_id).payload_json)["prompt"] == "A red fox\nin snow"


@pytest.mark.parametrize("fail", [False, True])
def test_stream_chat_chunks_keepalive_and_errors(client, ready, monkeypatch, fail):
    def generate(*args, **kwargs):
        time.sleep(0.08)
        if fail:
            raise MuseError("generation_refused", 400)
        fake_generate(*args, **kwargs)

    monkeypatch.setattr("app.rendering.quick_create.generate_images", generate)
    monkeypatch.setattr("app.api.routes.public_api.KEEPALIVE_INTERVAL", 0.01)
    with client.stream("POST", "/v1/chat/completions", headers=ready,
        json={"model": "muse-image", "messages": [{"role": "user", "content": "A fox"}], "stream": True}) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        lines = list(response.iter_lines())
    assert ": waiting" in lines and lines[-2] == "data: [DONE]"
    chunks = [json.loads(line[6:]) for line in lines if line.startswith("data: {")]
    assert len(chunks) == 3
    assert all(chunk["object"] == "chat.completion.chunk" for chunk in chunks)
    assert chunks[0]["choices"][0]["delta"] == {"role": "assistant"}
    content = chunks[1]["choices"][0]["delta"]["content"]
    assert "refused" in content if fail else content.startswith("![image](")
    assert chunks[2]["choices"][0] == {"index": 0, "delta": {}, "finish_reason": "stop"}


@pytest.mark.parametrize("code,status,type,public_code", [
    ("quota_exhausted", 429, "rate_limit_error", "rate_limit_exceeded"),
    ("rate_limited", 429, "rate_limit_error", "rate_limit_exceeded"),
    ("generation_refused", 400, "invalid_request_error", "content_policy_violation"),
    ("generation_timeout", 504, "api_error", "timeout"),
    ("account_unavailable", 503, "api_error", "no_account_available"),
    ("account_deleted", 503, "api_error", "no_account_available"),
    ("ffmpeg_unavailable", 503, "api_error", "no_account_available"),
    ("too_many_files", 409, "invalid_request_error", "library_full"),
    ("media_download_failed", 502, "api_error", "upstream_error"),
])
def test_generation_failure_mapping(client, ready, monkeypatch, code, status, type, public_code):
    def generate(*args, **kwargs):
        raise MuseError(code, 500)

    monkeypatch.setattr("app.rendering.quick_create.generate_images", generate)
    monkeypatch.setattr("app.rendering.quick_create.generate_video", generate)
    response = client.post("/v1/images/generations", headers=ready, json={"prompt": "A fox"})
    assert_error(response, status, public_code, type)
    assert response.headers["X-Muse-Task-Id"]
    video = client.post("/v1/videos/generations", headers=ready, json={"prompt": "A fox"}).json()
    wait_for(client, video["id"], "failed")
    result = client.get("/v1/videos/generations/" + video["id"], headers=ready).json()
    assert result["status"] == "failed" and "data" not in result
    assert result["error"]["code"] == public_code and result["error"]["type"] == type


def test_enqueue_failures_and_unexpected_error(client, headers, monkeypatch):
    assert_error(client.post("/v1/images/generations", headers=headers,
        json={"prompt": "x"}), 503, "no_account_available", "api_error")
    import_account(client, "Public", "quick-fixture")
    monkeypatch.setattr("app.rendering.library.MAX_ASSETS", 0)
    assert_error(client.post("/v1/images/generations", headers=headers,
        json={"prompt": "x"}), 409, "library_full")
    monkeypatch.setattr("app.rendering.quick_create.find_ffmpeg", lambda _: None)
    assert_error(client.post("/v1/images/generations", headers=headers,
        json={"prompt": "x"}), 503, "no_account_available", "api_error")

    def broken(*args, **kwargs):
        raise RuntimeError("private details")

    monkeypatch.setattr("app.api.routes.public_api.queue", broken)
    response = client.post("/v1/images/generations", headers=headers, json={"prompt": "x"})
    assert_error(response, 502, "upstream_error", "api_error")
    assert "private details" not in response.text


@pytest.mark.parametrize("status", ["cancelled", "interrupted"])
def test_stopped_task_is_clear_upstream_error(client, ready, monkeypatch, status):
    from app.api.routes import public_api

    original = public_api.read_task

    def read(request, task_id):
        task = original(request, task_id)
        task.status = status
        return task

    monkeypatch.setattr(public_api, "read_task", read)
    response = client.post("/v1/images/generations", headers=ready, json={"prompt": "x"})
    assert_error(response, 502, "upstream_error", "api_error")
    assert status in response.json()["error"]["message"]


def test_wait_timeout_keeps_background_task(client, ready, monkeypatch):
    from app.api.routes import public_api

    original = public_api.read_task

    def read(request, task_id):
        task = original(request, task_id)
        task.status = "queued"
        return task

    monkeypatch.setattr(public_api, "read_task", read)
    client.app.state.settings.render_timeout = -120
    response = client.post("/v1/images/generations", headers=ready, json={"prompt": "x"})
    assert_error(response, 504, "timeout", "api_error")
    task_id = response.headers["X-Muse-Task-Id"]
    assert client.get(f"/api/tasks/{task_id}").status_code == 200


def test_result_urls_use_the_address_a_proxy_forwards(client, ready):
    # Behind the development proxy the server sees its own address as Host.
    def url(**forwarded):
        response = client.post("/v1/images/generations", json={"prompt": "Image"},
            headers={**ready, "Host": "127.0.0.1:18610", **forwarded})
        assert response.status_code == 200, response.text
        return response.json()["data"][0]["url"]

    assert url().startswith("http://127.0.0.1:18610/api/library/assets/")
    assert url(**{"X-Forwarded-Host": "192.168.1.20:5173"}).startswith(
        "http://192.168.1.20:5173/api/library/assets/")
    assert url(**{"X-Forwarded-Host": "studio.example.com, inner", "X-Forwarded-Proto": "https"}
        ).startswith("https://studio.example.com/api/library/assets/")
    # Nothing but a host name is taken from the header.
    assert url(**{"X-Forwarded-Host": "evil.example/path?x=1"}).startswith(
        "http://127.0.0.1:18610/api/library/assets/")

