from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_the_built_interface_is_served_next_to_the_api(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><div id=root></div>")
    (dist / "assets" / "app-1a2b.js").write_text("console.log(1)")
    (dist / "favicon.svg").write_text("<svg/>")
    settings = Settings(_env_file=None, data_dir=tmp_path / "data", frontend_dir=dist)
    with TestClient(create_app(settings)) as client:
        # Pages the interface routes itself get its entry point.
        for path in ("/", "/projects", "/projects/abc/output", "/api", "/docs", "/settings"):
            response = client.get(path)
            assert response.status_code == 200 and "id=root" in response.text, path
            assert response.headers["cache-control"] == "no-cache"
        assert client.get("/assets/app-1a2b.js").text == "console.log(1)"
        assert client.get("/favicon.svg").text == "<svg/>"
        # The API still answers, and an unknown API address is not the page.
        assert client.get("/api/health").json()["status"] == "ok"
        assert client.get("/api/missing").status_code == 404
        assert client.get("/v1/missing").status_code in (401, 404)
        assert client.get("/api/docs").status_code == 200
        assert client.get("/api/openapi.json").json()["info"]["title"]
        # Nothing outside the build is reachable through it.
        assert "id=root" in client.get("/..%2F..%2Fdata").text


def test_without_a_build_nothing_is_mounted(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path / "data", frontend_dir=tmp_path / "none")
    with TestClient(create_app(settings)) as client:
        assert client.get("/").status_code == 404
        assert client.get("/api/health").status_code == 200
