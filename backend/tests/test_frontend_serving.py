import re
import xml.etree.ElementTree as ElementTree

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

INDEX = (
    "<!doctype html><html><head><title>Muse AI Studio</title>"
    '<meta name="description" content="Default" /></head>'
    "<body><div id=root></div></body></html>"
)


def build(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX, encoding="utf-8")
    (dist / "assets" / "app-1a2b.js").write_text("console.log(1)")
    (dist / "favicon.svg").write_text("<svg/>")
    return Settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        frontend_dir=dist,
        session_refresh_minutes=0,
    )


def head(text, pattern):
    found = re.search(pattern, text)
    return found and found.group(1)


def test_the_built_interface_is_served_next_to_the_api(tmp_path):
    with TestClient(create_app(build(tmp_path))) as client:
        # Pages the interface routes itself get its entry point.
        for path in (
            "/",
            "/projects",
            "/projects/abc/output",
            "/api",
            "/docs",
            "/settings",
        ):
            response = client.get(path)
            assert response.status_code == 200 and "id=root" in response.text, path
            assert response.headers["cache-control"] == "no-cache"
        assert client.get("/assets/app-1a2b.js").text == "console.log(1)"
        assert client.get("/favicon.svg").text == "<svg/>"
        # Link checkers ask with HEAD first.
        for path in ("/projects", "/favicon.svg", "/robots.txt", "/nothing-here"):
            assert client.head(path).status_code == (
                404 if path == "/nothing-here" else 200
            )
        # The API still answers, and an unknown API address is not the page.
        assert client.get("/api/health").json()["status"] == "ok"
        assert client.get("/api/missing").status_code == 404
        assert client.get("/v1/missing").status_code in (401, 404)
        assert client.get("/api/docs").status_code == 200
        assert client.get("/api/openapi.json").json()["info"]["title"]
        # Nothing outside the build is reachable through it.
        assert "id=root" in client.get("/..%2F..%2Fdata").text


def test_each_page_carries_its_own_title_description_and_preview(tmp_path):
    with TestClient(create_app(build(tmp_path))) as client:
        page = client.get("/create").text
        assert head(page, r"<title>(.*?)</title>") == "Quick Create · Muse AI Studio"
        assert page.count("<title>") == 1 and page.count('name="description"') == 1
        assert "pictures and short videos" in head(
            page, r'name="description" content="([^"]+)"'
        )
        assert (
            head(page, r'property="og:title" content="([^"]+)"')
            == "Quick Create · Muse AI Studio"
        )
        assert (
            head(page, r'property="og:url" content="([^"]+)"')
            == "http://testserver/create"
        )
        assert (
            head(page, r'property="og:image" content="([^"]+)"')
            == "http://testserver/og-image.png"
        )
        assert (
            head(page, r'name="twitter:image" content="([^"]+)"')
            == "http://testserver/og-image.png"
        )
        # / is Video Studio; a project's own pages are named after it too.
        assert (
            head(client.get("/").text, r"<title>(.*?)</title>")
            == "Video Studio · Muse AI Studio"
        )
        assert head(
            client.get("/projects/abc/render/").text, r"<title>(.*?)</title>"
        ) == ("Video Studio · Muse AI Studio")
        # The public address names the pages when one is set.
        client.patch("/api/settings", json={"publicUrl": "https://studio.example.com"})
        page = client.get("/docs").text
        assert (
            head(page, r'property="og:url" content="([^"]+)"')
            == "https://studio.example.com/docs"
        )


def test_an_unknown_address_is_a_404_that_still_shows_the_interface(tmp_path):
    with TestClient(create_app(build(tmp_path))) as client:
        for path in ("/nothing-here", "/projects/abc/edit", "/overview/x"):
            response = client.get(path)
            assert response.status_code == 404, path
            assert "id=root" in response.text
            assert (
                head(response.text, r"<title>(.*?)</title>")
                == "Page not found · Muse AI Studio"
            )
            assert response.headers["x-robots-tag"] == "noindex, nofollow"


def test_search_engines_are_turned_away_until_the_setting_is_on(tmp_path):
    with TestClient(create_app(build(tmp_path))) as client:
        robots = client.get("/robots.txt")
        assert robots.status_code == 200 and "Disallow: /\n" in robots.text
        assert client.get("/sitemap.xml").status_code == 404
        for path in ("/", "/projects", "/docs", "/accounts"):
            response = client.get(path)
            assert response.headers["x-robots-tag"] == "noindex, nofollow", path
            assert 'name="robots" content="noindex, nofollow"' in response.text
            assert 'rel="canonical"' not in response.text


def test_with_the_setting_on_only_the_pages_about_the_app_are_offered(tmp_path):
    with TestClient(create_app(build(tmp_path))) as client:
        client.patch(
            "/api/settings",
            json={"searchIndexing": True, "publicUrl": "https://studio.example.com"},
        )
        robots = client.get("/robots.txt").text
        assert "Disallow: /api/\n" in robots and "Disallow: /v1/\n" in robots
        assert "Disallow: /\n" not in robots
        assert "Sitemap: https://studio.example.com/sitemap.xml" in robots
        sitemap = client.get("/sitemap.xml")
        assert sitemap.headers["content-type"].startswith("application/xml")
        names = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        listed = [
            loc.text
            for loc in ElementTree.fromstring(sitemap.text).findall(
                "s:url/s:loc", names
            )
        ]
        assert listed == [
            "https://studio.example.com/projects",
            "https://studio.example.com/create",
            "https://studio.example.com/overview",
            "https://studio.example.com/docs",
        ]
        for path, canonical in (
            ("/", "/projects"),
            ("/projects/", "/projects"),
            ("/docs", "/docs"),
        ):
            response = client.get(path)
            assert "x-robots-tag" not in response.headers, path
            assert 'name="robots" content="index, follow"' in response.text
            assert head(response.text, r'rel="canonical" href="([^"]+)"') == (
                "https://studio.example.com" + canonical
            )
        # Accounts, keys, settings and someone's projects are never listed.
        for path in (
            "/accounts",
            "/api",
            "/settings",
            "/tasks",
            "/library",
            "/playground",
            "/projects/abc",
        ):
            response = client.get(path)
            assert response.status_code == 200
            assert response.headers["x-robots-tag"] == "noindex, nofollow", path
            assert 'rel="canonical"' not in response.text


def test_behind_a_path_the_rules_name_that_path(tmp_path):
    with TestClient(create_app(build(tmp_path))) as client:
        client.patch(
            "/api/settings",
            json={"searchIndexing": True, "publicUrl": "http://192.168.1.20:8080/muse"},
        )
        robots = client.get("/robots.txt").text
        assert "Disallow: /muse/api/\n" in robots and "Disallow: /muse/v1/\n" in robots
        assert "Sitemap: http://192.168.1.20:8080/muse/sitemap.xml" in robots


def test_without_a_build_nothing_is_mounted(tmp_path):
    settings = Settings(
        _env_file=None, data_dir=tmp_path / "data", frontend_dir=tmp_path / "none"
    )
    with TestClient(create_app(settings)) as client:
        assert client.get("/").status_code == 404
        assert client.get("/api/health").status_code == 200
