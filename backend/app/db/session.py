import sqlite3

from alembic import command
from alembic.config import Config
from sqlalchemy import URL, create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.config import BACKEND_DIR, Settings


class Database:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.engine = create_engine(
            URL.create("sqlite+pysqlite", database=str(settings.database_path)),
            connect_args={
                "check_same_thread": False,
                "autocommit": False,
                "timeout": 5,
            },
        )
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        event.listen(self.engine, "connect", self._configure_connection)

    @staticmethod
    def _configure_connection(connection: sqlite3.Connection, _record) -> None:
        previous = connection.autocommit
        connection.autocommit = True
        cursor = connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=5000")
        finally:
            cursor.close()
            connection.autocommit = previous

    def prepare(self) -> None:
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        connection = self.engine.raw_connection()
        dbapi = connection.driver_connection
        previous = dbapi.autocommit
        dbapi.autocommit = True
        cursor = dbapi.cursor()
        try:
            mode = cursor.execute("PRAGMA journal_mode=WAL").fetchone()[0]
            if mode.lower() != "wal":
                raise RuntimeError("SQLite WAL mode could not be enabled")
        finally:
            cursor.close()
            dbapi.autocommit = previous
            connection.close()

    def migrate(self) -> None:
        self.prepare()
        config = Config(str(BACKEND_DIR / "alembic.ini"))
        with self.engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")

    def close(self) -> None:
        self.engine.dispose()
