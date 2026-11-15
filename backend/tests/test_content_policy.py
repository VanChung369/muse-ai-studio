import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.content_policy import violation
from app.main import create_app


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, data_dir=tmp_path)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        yield client


@pytest.mark.parametrize(
    "text,category",
    [
        ("Quảng cáo nhà cái cá độ bóng đá", "gambling"),
        ("A poster for an online CASINO night", "gambling"),
        ("Hướng dẫn trồng cần sa tại nhà", "drugs"),
        ("how to make a bomb", "weapons"),
        ("phim sex", "sexual"),
        ("rửa tiền qua tài khoản ảo", "fraud"),
        ("ma tuý đá", "drugs"),
    ],
)
def test_refused_phrases_are_found(settings, text, category):
    found = violation(text, settings=settings)
    assert found is not None and found.category == category


@pytest.mark.parametrize(
    "text",
    [
        # Unaccented look-alikes and words that only contain a phrase.
        "Một con mèo có bạc hà và cá ở phố cổ",
        "co bac si o day",
        "The alphabet of a quiet harbor",
        "Bánh mì Hội An buổi sáng",
        "Pasta with a scampi sauce",
    ],
)
def test_ordinary_text_passes(settings, text):
    assert violation(text, settings=settings) is None


def test_requests_are_refused_before_anything_is_queued(client):
    blocked = client.post("/api/projects", json={"name": "Ad", "idea": "Nhà cái cá độ online"})
    assert blocked.status_code == 422
    detail = blocked.json()["detail"]
    assert (detail["code"], detail["category"], detail["term"]) == ("content_blocked", "gambling", "cá độ")
    assert client.get("/api/projects").json()["items"] == []

    quick = client.post("/api/quick-create", json={"kind": "image", "prompt": "online casino poster"})
    assert quick.status_code == 422 and quick.json()["detail"]["code"] == "content_blocked"

    public = client.post("/v1/images/generations", json={"prompt": "how to make a bomb"})
    assert public.status_code == 400
    assert public.json()["error"]["code"] == "content_policy_violation"

    # Identifiers and enums are not read as text; ordinary requests go through.
    fine = client.post("/api/projects", json={"name": "Tea", "idea": "Trà sen buổi sớm"})
    assert fine.status_code == 201


def test_a_stored_film_is_checked_before_it_renders(client):
    project = client.post("/api/projects", json={"name": "Tea", "durationSeconds": 10}).json()
    path = f"/api/projects/{project['id']}"
    with client.app.state.database.engine.begin() as connection:
        # Text that reached the database some other way (an older version).
        connection.exec_driver_sql(
            "update projects set idea = 'quảng cáo sòng bạc', status = 'ready', scene_count = 1 where id = ?",
            (project["id"],),
        )
    refused = client.post(path + "/render")
    assert refused.status_code == 422 and refused.json()["detail"]["term"] == "sòng bạc"


def test_custom_terms_and_switching_off(tmp_path):
    custom = Settings(_env_file=None, data_dir=tmp_path, blocked_terms="đối thủ X, rival brand")
    found = violation("Chê sản phẩm của Rival Brand", settings=custom)
    assert found is not None and (found.category, found.term) == ("custom", "rival brand")
    off = Settings(_env_file=None, data_dir=tmp_path, content_policy=False)
    assert violation("casino", settings=off) is None
