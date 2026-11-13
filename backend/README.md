# Muse AI Studio — Backend

FastAPI backend with Pydantic settings, SQLite, SQLAlchemy, and Alembic. Includes health checks and a persistent, paginated project list with server-side search, filters, and sorting, plus draft creation, project details, and editable scripts with scene timelines. Muse integration and the task coordinator will be added later.

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

Migration `0001_baseline` initializes migration history; `0002_projects` creates the projects table and validation constraints; `0003_project_list_pagination` adds the normalized `name_key` column (backfilled for existing rows) and the indexes used by paginated project lists. `0004_project_scripts` stores shared script descriptions, revision numbers, and ordered scene rows. Existing projects keep their original data and start with an empty script at revision 0. Existing databases upgrade on startup. Future models should inherit from `app.db.base.Base` and be imported in `migrations/env.py` before generating a migration:

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
    routes/           Health and project endpoints
  models/             SQLAlchemy project and scene models
  schemas/project.py  Request and response contracts
  repositories/       Project queries and transaction handling
  core/config.py      Environment settings and stable data paths
  db/
    base.py           SQLAlchemy model base
    session.py        SQLite engine, sessions, and startup migration
migrations/           Alembic environment and migration history
```

## Project API

- `GET /api/projects`: list projects, most recently updated first.
- `POST /api/projects`: create a draft; returns HTTP 201 with a `Location` header.
- `GET /api/projects/{id}`: retrieve one project; unknown IDs return HTTP 404.
- `PUT /api/projects/{id}/script`: atomically save a complete script and its scene order, with revision conflict protection.
- `DELETE /api/projects/{id}`: delete a project and its scenes in one transaction; returns HTTP 204. Unknown projects return 404; projects in `planning`, `rendering`, or `cancelling` return 409 without changes.

Names are required and trimmed. Duration must be an integer from 10 to 300 in steps of 5; aspect ratios are `16:9`, `9:16`, or `1:1`. A new database contains no sample projects. Browser demo data from the previous UI is not imported. The current API serves local development without authentication and does not call external services.

Scripts contain 1–30 scenes lasting 5 or 10 seconds each, totaling the project target duration. A save increments `scriptRevision` and sets status to `ready`. Only `draft` and `ready` projects are editable. Stale revisions and locked statuses return HTTP 409; invalid scripts return HTTP 422. Failed writes leave the previous script unchanged.

See [the API contract](api-contract.md) for payloads and errors. FastAPI's live OpenAPI schema is authoritative; `openapi.json` is its committed snapshot.

## Validation

```bash
uv run --locked pytest -q
```

Tests use isolated temporary databases and cover validation, empty state, draft creation, detail lookup, restart persistence, baseline migration, model consistency, script persistence/replacement, duration and input validation, locked statuses, concurrent revision conflicts, rollback behavior, cascading project deletion, deletion status rules and concurrency, and the OpenAPI snapshot. They do not write to the development database.
