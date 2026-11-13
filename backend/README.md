# Muse AI Studio — Backend

FastAPI backend scaffold with Pydantic settings, SQLite, SQLAlchemy, and Alembic. This stage provides configuration, database initialization, and a health endpoint. Product endpoints, Muse integration, and the task coordinator will be added later.

## Requirements

- Python 3.12 or later.
- [uv](https://docs.astral.sh/uv/getting-started/installation/) for dependency management.

## Development

Run from the `backend/` directory:

```bash
uv sync --locked
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 18610
```

The local environment has already been created during initialization. `uv sync --locked` reproduces the dependencies on a new checkout using `uv.lock`.

- Health: `http://127.0.0.1:18610/api/health`
- Swagger UI: `http://127.0.0.1:18610/docs`
- OpenAPI schema: `http://127.0.0.1:18610/openapi.json`

The health endpoint checks database connectivity and returns:

```json
{"status": "ok", "database": "ok"}
```

If the database query fails, it returns HTTP 503. Database initialization or migration failures prevent startup.

## Configuration and Data

Defaults work without a `.env` file. For local overrides, copy `.env.example` to `.env`. Settings load the repository root `.env`, then `backend/.env`; environment variables take precedence. See `.env.example` for available settings.

The default database is `data/muse-ai-studio.db` at the repository root. Relative `MUSE_DATA_DIR` values also resolve from the repository root. Importing the app does not create a database; startup creates the data directory, enables WAL, and applies migrations. Each connection enables foreign keys and a five-second busy timeout.

Use one application process for this initial architecture. Runtime data and virtual environments are ignored by Git.

## Migrations

Migrations run automatically on application startup. They can also be managed from `backend/`:

```bash
uv run alembic current
uv run alembic upgrade head
uv run alembic check
```

The baseline only initializes migration history; there are no product tables yet. Future models should inherit from `app.db.base.Base` and be imported in `migrations/env.py` before generating a migration:

```bash
uv run alembic revision --autogenerate -m "Describe the schema change"
```

Review generated migrations before applying them. Alembic is configured for SQLite batch migrations.

## Structure

```text
app/
  main.py             Application factory and startup/shutdown lifecycle
  api/
    router.py         API route registration
    dependencies.py   Request-scoped database sessions
    routes/health.py  Health endpoint and response schema
  core/config.py      Environment settings and stable data paths
  db/
    base.py           SQLAlchemy model base
    session.py        SQLite engine, sessions, and startup migration
migrations/           Alembic environment and migration history
```

`httpx2` and `pytest` are included in the development dependency group for future API checks. This scaffold does not call external services.
