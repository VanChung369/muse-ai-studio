import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

from alembic import command
from alembic.config import Config
from sqlalchemy import URL, Connection, create_engine, event
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
    def _run_outside_transaction(connection: sqlite3.Connection, *statements: str) -> None:
        # Some pragmas (foreign_keys) are silently ignored inside a transaction.
        previous = connection.autocommit
        connection.autocommit = True
        cursor = connection.cursor()
        try:
            for statement in statements:
                cursor.execute(statement)
        finally:
            cursor.close()
            connection.autocommit = previous

    @classmethod
    def _configure_connection(cls, connection: sqlite3.Connection, _record) -> None:
        cls._run_outside_transaction(connection, "PRAGMA foreign_keys=ON", "PRAGMA busy_timeout=5000")

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

    @contextmanager
    def migration_connection(self) -> Iterator[Connection]:
        """Yield a transactional connection with foreign keys disabled.

        Alembic batch migrations rebuild SQLite tables by copying them and
        dropping the original. With foreign keys on, dropping `projects` would
        cascade-delete every `project_scenes` row. Following SQLite's schema
        change procedure, enforcement is off during the migration and
        integrity is checked before commit.
        """
        with self.engine.connect() as connection:
            dbapi = connection.connection.driver_connection
            self._run_outside_transaction(dbapi, "PRAGMA foreign_keys=OFF")
            try:
                with connection.begin():
                    yield connection
                    violations = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
                    if violations:
                        raise RuntimeError(f"Migration left {len(violations)} foreign key violation(s): {violations[:5]}")
            finally:
                self._run_outside_transaction(dbapi, "PRAGMA foreign_keys=ON")

    def migrate(self) -> None:
        self.prepare()
        config = Config(str(BACKEND_DIR / "alembic.ini"))
        with self.migration_connection() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")

    def close(self) -> None:
        self.engine.dispose()
