import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api.router import api_router
from app.core.account_vault import AccountVault
from app.repositories import accounts
from app.core.config import Settings
from app.core.account_operations import AccountOperations
from app.integrations.muse.client import MuseClient
from app.db.session import Database
from app.models.account import Account


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    database = Database(settings)
    vault = AccountVault(settings.data_dir / "account-secret.key")

    def prepare_vault() -> None:
        with database.sessions() as session:
            ciphertext = session.scalar(select(Account.encrypted_cookies).limit(1))
            vault.prepare(ciphertext)
            accounts.refresh_fingerprints(session, vault)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            await asyncio.to_thread(database.migrate)
            await asyncio.to_thread(prepare_vault)
            yield
        finally:
            await asyncio.to_thread(database.close)

    app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
    app.state.database = database
    app.state.account_vault = vault
    app.state.account_operations = AccountOperations()
    app.state.muse_client = MuseClient(settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router, prefix="/api")
    return app


app = create_app()
