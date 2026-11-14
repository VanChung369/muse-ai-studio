import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

DEFAULTS = {
    "durationSeconds": 60, "aspectRatio": "16:9", "language": "auto",
    "look": "auto", "continuity": "reference",
}


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, data_dir=tmp_path, session_refresh_minutes=0)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        yield client


def test_settings_start_from_the_defaults_and_keep_what_is_saved(client, settings):
    assert client.get("/api/settings").json() == {"projectDefaults": DEFAULTS, "publicUrl": None}
    chosen = {**DEFAULTS, "durationSeconds": 90, "aspectRatio": "9:16", "language": "vi",
        "look": "cinematic", "continuity": "seamless"}
    saved = client.patch("/api/settings", json={"projectDefaults": chosen})
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"projectDefaults": chosen, "publicUrl": None}
    # One part is changed without touching the other.
    assert client.patch("/api/settings", json={"publicUrl": " https://studio.example.com/ "}).json() == {
        "projectDefaults": chosen, "publicUrl": "https://studio.example.com"}
    assert client.patch("/api/settings", json={}).json()["publicUrl"] == "https://studio.example.com"
    # They outlive the process.
    with TestClient(create_app(settings)) as again:
        assert again.get("/api/settings").json() == {
            "projectDefaults": chosen, "publicUrl": "https://studio.example.com"}
        for cleared in (None, "", "  "):
            again.patch("/api/settings", json={"publicUrl": "http://192.168.1.20:8080/muse"})
            assert again.patch("/api/settings", json={"publicUrl": cleared}).json()["publicUrl"] is None


@pytest.mark.parametrize("body", [
    {"projectDefaults": {**DEFAULTS, "durationSeconds": 3605}},
    {"projectDefaults": {**DEFAULTS, "durationSeconds": 62}},
    {"projectDefaults": {**DEFAULTS, "aspectRatio": "5:4"}},
    {"projectDefaults": {**DEFAULTS, "look": "sepia"}},
    {"projectDefaults": {"durationSeconds": 60}},
    {"projectDefaults": {**DEFAULTS, "extra": 1}},
    {"publicUrl": "studio.example.com"}, {"publicUrl": "ftp://studio.example.com"},
    {"publicUrl": "https://user:pw@studio.example.com"}, {"publicUrl": "https://studio.example.com/?a=1"},
    {"publicUrl": "https://studio.example.com:port"}, {"publicUrl": "https://a b.example.com"},
    {"publicUrl": "https://" + "a" * 200 + ".example.com"}, {"unknown": True},
])
def test_invalid_settings_are_refused_and_nothing_changes(client, body):
    assert client.patch("/api/settings", json=body).status_code == 422
    assert client.get("/api/settings").json() == {"projectDefaults": DEFAULTS, "publicUrl": None}


def test_a_new_project_takes_the_saved_defaults_for_what_it_leaves_out(client):
    client.patch("/api/settings", json={"projectDefaults": {**DEFAULTS, "durationSeconds": 120,
        "aspectRatio": "4:5", "language": "vi", "look": "anime", "continuity": "off"}})
    bare = client.post("/api/projects", json={"name": "Bare"}).json()
    assert (bare["durationSeconds"], bare["aspectRatio"], bare["language"], bare["look"], bare["continuity"]) == (
        120, "4:5", "vi", "anime", "off")
    # What the request says wins, field by field.
    mixed = client.post("/api/projects", json={"name": "Mixed", "durationSeconds": 30, "look": "auto"}).json()
    assert (mixed["durationSeconds"], mixed["aspectRatio"], mixed["look"], mixed["continuity"]) == (
        30, "4:5", "auto", "off")


def test_system_status_reports_what_the_server_runs_with(client, settings, monkeypatch):
    (settings.data_dir / "library").mkdir(exist_ok=True)
    (settings.data_dir / "library" / "a.png").write_bytes(b"x" * 1000)
    (settings.data_dir / "projects" / "p1").mkdir(parents=True)
    (settings.data_dir / "projects" / "p1" / "scene-01.mp4").write_bytes(b"y" * 3000)
    monkeypatch.setattr("app.api.routes.settings.find_ffmpeg", lambda _: None)
    monkeypatch.setattr("app.api.routes.settings.find_browser", lambda _: None)
    status = client.get("/api/system")
    assert status.status_code == 200, status.text
    body = status.json()
    assert body["ffmpeg"] == {"path": None, "version": None, "captions": False}
    assert body["browserPath"] is None
    assert body["databaseRevision"] == "0021_app_settings"
    assert body["dataDir"] == str(settings.data_dir)
    assert body["storage"]["libraryBytes"] == 1000 and body["storage"]["projectsBytes"] == 3000
    assert body["storage"]["databaseBytes"] > 0 and body["storage"]["freeBytes"] > 0
    assert body["limits"] == {"taskWorkers": 2, "browserSlots": 3, "planningTimeout": 300,
        "renderTimeout": 600, "threadSceneLimit": 12, "sessionRefreshMinutes": 0,
        "sessionRefreshWake": False}
    assert body["version"] not in ("", "unknown")

    monkeypatch.setattr("app.api.routes.settings.find_ffmpeg", lambda _: "C:/tools/ffmpeg.exe")
    monkeypatch.setattr("app.api.routes.settings.ffmpeg_status", lambda path: ("7.1", True))
    monkeypatch.setattr("app.api.routes.settings.find_browser", lambda _: "C:/chrome.exe")
    body = client.get("/api/system").json()
    assert body["ffmpeg"] == {"path": "C:/tools/ffmpeg.exe", "version": "7.1", "captions": True}
    assert body["browserPath"] == "C:/chrome.exe"
