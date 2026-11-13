import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import Settings
from app.db.session import Database


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    database = Database(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            await asyncio.to_thread(database.migrate)
            yield
        finally:
            await asyncio.to_thread(database.close)

    app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
    app.state.database = database
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router, prefix="/api")
    return app


app = create_app()
