from alembic import context
from sqlalchemy.engine import Connection

from app.core.config import Settings
from app.db.base import Base
from app.db.session import Database

config = context.config
target_metadata = Base.metadata


def run_with_connection(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        run_with_connection(connection)
        return

    database = Database(Settings())
    try:
        database.prepare()
        with database.engine.begin() as connection:
            run_with_connection(connection)
    finally:
        database.close()


if context.is_offline_mode():
    from sqlalchemy import URL

    context.configure(
        url=URL.create("sqlite+pysqlite", database=str(Settings().database_path)),
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    run_migrations_online()
