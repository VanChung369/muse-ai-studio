import asyncio
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.accounts.refresher import SessionRefresher
from app.api.router import api_router
from app.api.routes.public_api import install_error_handlers, router as public_router
from app.core.account_vault import AccountVault
from app.repositories import accounts
from app.core.config import Settings
from app.core.account_operations import AccountOperations
from app.tasks.coordinator import TaskCoordinator
from app.integrations.muse.client import MuseClient
from app.planning.tasks import PLANNING_KIND, make_script_handler
from app.rendering.music import make_music_handler
from app.rendering.quick_create import make_quick_handler
from app.rendering.tasks import (
    make_listener,
    make_merge_handler,
    make_scene_handler,
    sync_active_projects,
)
from app.tasks.kinds import GENERATE_MUSIC, MERGE_VIDEO, RENDER_SCENE, QUICK_KINDS
from app.db.session import Database
from app.models.account import Account
from app.models.api_key import ApiKey


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    database = Database(settings)
    vault = AccountVault(settings.data_dir / "account-secret.key")

    def prepare_vault() -> None:
        with database.sessions() as session:
            ciphertext = session.scalar(select(Account.encrypted_cookies).limit(1))
            if ciphertext is None:
                ciphertext = session.scalar(select(ApiKey.encrypted_key).limit(1))
            vault.prepare(ciphertext)
            accounts.refresh_fingerprints(session, vault)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            await asyncio.to_thread(database.migrate)
            await asyncio.to_thread(prepare_vault)
            # After migrations: a failed migration must not accept tasks.
            await asyncio.to_thread(coordinator.start)
            # Recovery may have interrupted or requeued render tasks.
            await asyncio.to_thread(sync_active_projects, database)
            refresher.start()
            yield
        finally:
            # Never block the event loop; worker threads are daemons.
            await asyncio.to_thread(refresher.stop)
            await asyncio.to_thread(coordinator.stop)
            await asyncio.to_thread(database.close)

    app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.database = database
    app.state.account_vault = vault
    app.state.account_operations = AccountOperations()
    coordinator = TaskCoordinator(
        database, app.state.account_operations, max_workers=settings.task_workers
    )
    app.state.task_coordinator = coordinator
    app.state.muse_client = MuseClient(settings)
    coordinator.register(PLANNING_KIND, make_script_handler(app))
    render_settled = make_listener(app)
    coordinator.register(RENDER_SCENE, make_scene_handler(app), render_settled)
    coordinator.register(MERGE_VIDEO, make_merge_handler(app), render_settled)
    coordinator.register(GENERATE_MUSIC, make_music_handler(app))
    for kind in QUICK_KINDS:
        coordinator.register(kind, make_quick_handler(app))
    refresher = SessionRefresher(
        app,
        timedelta(minutes=settings.session_refresh_minutes),
        wake=settings.session_refresh_wake,
    )
    app.state.session_refresher = refresher
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router, prefix="/api")
    app.include_router(public_router, prefix="/v1")
    install_error_handlers(app)
    return app


app = create_app()
