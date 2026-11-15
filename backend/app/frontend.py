"""The built interface (frontend/dist), served by this server.

After `npm run build` the whole app runs from one address: the API under
/api and /v1, the interface everywhere else. Paths the interface routes
itself (/projects/..., /library, /api for the API keys page, ...) get its
index.html; files of the build are served as they are. Without a build (while
developing with Vite) nothing is mounted.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.routing import APIRoute
from fastapi.staticfiles import StaticFiles
from starlette.routing import Match
from starlette.types import Scope


class _InterfaceRoute(APIRoute):
    def matches(self, scope: Scope) -> tuple[Match, Scope]:
        if scope["type"] == "http":
            path = scope.get("path", "")
            # Unknown /api/* and /v1* paths must fall through to 404 for all methods.
            if path == "/v1" or path.startswith(("/api/", "/v1/")):
                return Match.NONE, {}
        return super().matches(scope)


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

    def interface(path: str):
        if path:
            file = (folder / path).resolve()
            if file.is_file() and folder in file.parents:
                return FileResponse(file)
        # The interface decides what to show; always fetch its newest entry.
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    app.router.routes.append(
        _InterfaceRoute(
            "/{path:path}", interface, methods=["GET"], include_in_schema=False
        )
    )

    return True
