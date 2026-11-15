"""The built interface (frontend/dist), served by this server.

After `npm run build` the whole app runs from one address: the API under
/api and /v1, the interface everywhere else. Paths the interface routes
itself (/projects/..., /library, /api for the API keys page, ...) get its
index.html; files of the build are served as they are. Without a build (while
developing with Vite) nothing is mounted.

For search engines and link previews, each page's index.html carries that
page's title, description, preview picture and address, and an address the
interface does not know answers 404. What search engines may list follows the
"Show in search engines" setting. It is off until chosen, because the app has
no login, and then every page says noindex and robots.txt turns crawlers away.
When it is on, only the pages about what the app does (`listed` in PAGES) are
offered, in sitemap.xml too. Pages with accounts, keys, settings or someone's
projects stay noindex, and crawlers are kept off the API.
"""

import re
from dataclasses import dataclass
from html import escape
from pathlib import Path
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response
from fastapi.routing import APIRoute
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from starlette.routing import Match
from starlette.types import Scope

from app.api.dependencies import get_session
from app.repositories import app_settings

APP_NAME = "Muse AI Studio"
# The picture shown when a link is shared (frontend/public, 1200 x 630).
PREVIEW = ("/og-image.png", 1200, 630)


@dataclass(frozen=True)
class Page:
    title: str
    description: str
    # Offered to search engines when the setting allows it.
    listed: bool = False


# The interface's pages (src/constants/routes.ts), in English like its default
# language. Titles match what the interface sets ("{title} · {app name}").
PAGES = {
    "/projects": Page(
        "Video Studio",
        "Turn one idea into a script, separate scenes and a finished film with AI video "
        "from Muse, then fine-tune the timeline, captions, titles and music.",
        listed=True,
    ),
    "/create": Page(
        "Quick Create",
        "Make pictures and short videos from a single idea with Muse AI, "
        "and keep every result in your media library.",
        listed=True,
    ),
    "/overview": Page(
        "Overview",
        "Muse AI Studio brings AI films, quick pictures and videos, a media library "
        "and an OpenAI-compatible API together in one workspace.",
        listed=True,
    ),
    "/docs": Page(
        "Documentation",
        "How to use the Muse AI Studio API: API keys, models, and OpenAI-compatible "
        "requests for chat, images and videos.",
        listed=True,
    ),
    "/library": Page(
        "Media Library",
        "Every film made in Video Studio, and the pictures, videos and audio you upload.",
    ),
    "/tasks": Page(
        "Tasks", "Follow content generation and check the results of each task."
    ),
    "/accounts": Page(
        "Muse Accounts", "Manage your Muse accounts, sessions, and connections."
    ),
    "/api": Page("Connection & API", "Connect Muse AI Studio to your applications."),
    "/playground": Page("Playground", "Try out content generation requests."),
    "/settings": Page("Settings", "Customize your Muse AI Studio workspace."),
}
HOME = "/projects"  # where the interface sends /
# One project's pages: someone's own work, never listed.
PROJECT_PAGE = re.compile(
    r"/projects/[^/]+(/(idea|script|render|output))?", re.IGNORECASE
)
PROJECT = Page("Video Studio", PAGES[HOME].description)
NOT_FOUND = Page("Page not found", "This page does not exist.")

TITLE = re.compile(r"<title>.*?</title>", re.DOTALL | re.IGNORECASE)
DESCRIPTION = re.compile(r"<meta\s+name=\"description\"[^>]*>", re.IGNORECASE)
SessionDependency = Annotated[Session, Depends(get_session)]


class _InterfaceRoute(APIRoute):
    def matches(self, scope: Scope) -> tuple[Match, Scope]:
        if scope["type"] == "http":
            path = scope.get("path", "")
            # Unknown /api/* and /v1* paths must fall through to 404 for all methods.
            if path == "/v1" or path.startswith(("/api/", "/v1/")):
                return Match.NONE, {}
        return super().matches(scope)


def _base(request: Request, saved: dict) -> str:
    """The address the app is reached at: the public address when one is set."""
    return saved["publicUrl"] or str(request.base_url).rstrip("/")


def _page(path: str) -> tuple[Page, str, int]:
    """The page at a path, its address (without a trailing slash) and status."""
    route = "/" + path.strip("/").lower()
    if route == "/":
        return PAGES[HOME], HOME, 200
    if route in PAGES:
        return PAGES[route], route, 200
    if PROJECT_PAGE.fullmatch(route):
        return PROJECT, route, 200
    return NOT_FOUND, route, 404


def _html(
    index: str, page: Page, address: str, base: str, robots: str, canonical: bool
) -> str:
    title = escape(f"{page.title} · {APP_NAME}")
    description = escape(page.description)
    url = escape(base + address)
    image, width, height = PREVIEW
    image = escape(base + image)
    tags = [
        f'<meta name="robots" content="{robots}" />',
        f'<meta property="og:title" content="{title}" />',
        f'<meta property="og:description" content="{description}" />',
        f'<meta property="og:url" content="{url}" />',
        f'<meta property="og:image" content="{image}" />',
        f'<meta property="og:image:width" content="{width}" />',
        f'<meta property="og:image:height" content="{height}" />',
        f'<meta name="twitter:title" content="{title}" />',
        f'<meta name="twitter:description" content="{description}" />',
        f'<meta name="twitter:image" content="{image}" />',
    ]
    if canonical:
        tags.insert(0, f'<link rel="canonical" href="{url}" />')
    text = TITLE.sub(lambda _: f"<title>{title}</title>", index, count=1)
    meta = f'<meta name="description" content="{description}" />'
    text, found = DESCRIPTION.subn(lambda _: meta, text, count=1)
    if not found:
        tags.insert(0, meta)
    return text.replace("</head>", "".join(f"  {tag}\n" for tag in tags) + "</head>", 1)


def mount_frontend(app: FastAPI, folder: Path | None) -> bool:
    if folder is None:
        return False
    folder = folder.resolve()
    index = folder / "index.html"
    if not index.is_file():
        return False
    if (folder / "assets").is_dir():
        # Hashed names: the files never change, browsers may keep them.
        app.mount("/assets", StaticFiles(directory=folder / "assets"), name="assets")

    def robots(request: Request, session: SessionDependency):
        saved = app_settings.read(session)
        if not saved["searchIndexing"]:
            body = (
                '# "Show in search engines" is off in Settings.\n'
                "User-agent: *\nDisallow: /\n"
            )
        else:
            base = _base(request, saved)
            # Behind a reverse proxy the app may live under a path of the site.
            prefix = urlsplit(base).path.rstrip("/")
            body = (
                f"User-agent: *\nDisallow: {prefix}/api/\nDisallow: {prefix}/v1/\n\n"
                f"Sitemap: {base}/sitemap.xml\n"
            )
        return PlainTextResponse(body, headers={"Cache-Control": "no-cache"})

    def sitemap(request: Request, session: SessionDependency):
        saved = app_settings.read(session)
        if not saved["searchIndexing"]:
            return Response(status_code=404)
        base = _base(request, saved)
        urls = "".join(
            f"  <url><loc>{escape(base + path)}</loc></url>\n"
            for path, page in PAGES.items()
            if page.listed
        )
        body = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f"{urls}</urlset>\n"
        )
        return Response(
            body, media_type="application/xml", headers={"Cache-Control": "no-cache"}
        )

    def interface(path: str, request: Request, session: SessionDependency):
        if path:
            file = (folder / path).resolve()
            if file.is_file() and folder in file.parents:
                return FileResponse(file)
        page, address, status = _page(path)
        saved = app_settings.read(session)
        listed = saved["searchIndexing"] and page.listed and status == 200
        robots = "index, follow" if listed else "noindex, nofollow"
        text = _html(
            index.read_text(encoding="utf-8"),
            page,
            address,
            _base(request, saved),
            robots,
            canonical=listed,
        )
        # The interface decides what to show; always fetch its newest entry.
        headers = {"Cache-Control": "no-cache"}
        if not listed:
            headers["X-Robots-Tag"] = robots
        return HTMLResponse(text, status_code=status, headers=headers)

    # HEAD too: link checkers and preview fetchers often ask with it first.
    methods = ["GET", "HEAD"]
    for path, endpoint in (("/robots.txt", robots), ("/sitemap.xml", sitemap)):
        app.router.routes.append(
            APIRoute(path, endpoint, methods=methods, include_in_schema=False)
        )
    app.router.routes.append(
        _InterfaceRoute(
            "/{path:path}", interface, methods=methods, include_in_schema=False
        )
    )

    return True
