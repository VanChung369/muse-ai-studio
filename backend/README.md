# Muse AI Studio — Backend

FastAPI backend with Pydantic settings, SQLite, SQLAlchemy, and Alembic. Includes health checks and a persistent, paginated project list with server-side search, filters, and sorting, plus draft creation, project details, and editable scripts with scene timelines. Local Muse account management is also available. AI script proposals run through the durable task coordinator and the Muse browser session; video rendering is a later step.

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

Migration `0001_baseline` initializes migration history; `0002_projects` creates the projects table and validation constraints; `0003_project_list_pagination` adds the normalized `name_key` column (backfilled for existing rows) and the indexes used by paginated project lists. `0004_project_scripts` stores shared script descriptions, revision numbers, and ordered scene rows. Existing projects keep their original data and start with an empty script at revision 0. `0005_project_scene_count` stores each project's scene count (backfilled from existing scenes). `0006_accounts` adds encrypted account sessions and metadata. Existing databases upgrade on startup. Future models should inherit from `app.db.base.Base` and be imported in `migrations/env.py` before generating a migration:

```bash
uv run alembic revision --autogenerate -m "Describe the schema change"
```

Review generated migrations before applying them. Alembic is configured for SQLite batch migrations. Migrations run with foreign keys disabled (`Database.migration_connection`) because batch operations rebuild tables, and dropping the old `projects` table would otherwise cascade-delete its scenes; integrity is checked with `PRAGMA foreign_key_check` before commit.

## Structure

```text
app/
  main.py             Application factory and startup/shutdown lifecycle
  api/
    router.py         API route registration
    dependencies.py   Request-scoped database sessions
    routes/           Health and project endpoints
  models/             SQLAlchemy project, scene, and account models
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

## Account API and Encryption

- `GET /api/accounts` and `GET /api/accounts/{id}` return public metadata only.
- `POST /api/accounts` imports a label and write-only `cookieText`; successful imports return HTTP 201. The same `hatch_sess` cannot be imported twice (HTTP 409).
- `PATCH /api/accounts/{id}` updates a label and/or enabled preference.
- `DELETE /api/accounts/{id}` removes only the saved account session (HTTP 204).

Imports accept whatever users paste — Cookie headers, `document.cookie`, DevTools request headers, cURL/fetch copies, extension JSON exports, Playwright storage state, `cookies.txt`, or DevTools cookie-table rows — and skip anything that is not a usable muse.ai cookie (see `api-contract.md`). Unknown fields, unsupported formats, and missing session cookies return HTTP 422 without echoing the pasted credential input. There are no upstream requests in these endpoints: all imported sessions report `sessionStatus: "unverified"`, with no assumed quota or expiry. The existing local-development API still has no authentication layer.

A background session refresher re-checks every enabled account whose session is `valid`: every `MUSE_SESSION_REFRESH_MINUTES` (default 360; `0` disables it), and every 30 minutes while a session would expire before its next regular check. It runs the same check as `POST /accounts/{id}/test` (or keep-alive with `MUSE_SESSION_REFRESH_WAKE=true`), so cookies Muse rotates are saved and `expiresAt` follows them. Unverified, disabled, and invalid accounts are never contacted; a session Muse rejects becomes `invalid` and needs new cookies.

Credentials are encrypted with Fernet before they enter SQLite. Startup creates `data/account-secret.key` automatically with mode 0600, alongside the existing database. Back up **both the database and this key** to restore imported accounts. Startup fails with an explicit message if stored accounts exist but their key is missing or does not match; it never silently replaces that key. Importing the Python module alone creates no data files. The key and database are runtime data ignored by Git. Database encryption protects the stored credential fields; the key remains on the same host and is not a replacement for host access controls.

## Rendering

`POST /api/projects/{id}/render` renders every scene through Muse, one after another, then merges the clips with FFmpeg. Each scene is one `render_scene` task that depends on the previous one; the last task, `merge_video`, needs no account. A failed or cancelled scene holds back the rest of the chain until `POST /api/projects/{id}/render/resume` (or a task-level retry). `app/rendering/tasks.py` derives the project status from the chain wherever a task changes.

Clips are stored under `data/media/projects/<project id>/` (`scene-01.mp4`, ..., `final.mp4`) and served by `GET /api/projects/{id}/scenes/{number}/video` and `GET /api/projects/{id}/video`. Back them up with the database.

Merging needs an `ffmpeg` binary on `PATH`, or `MUSE_FFMPEG_PATH`. Without it the scenes still render and the merge task fails with `ffmpeg_unavailable`; install FFmpeg and resume. `MUSE_RENDER_TIMEOUT` (default 600 seconds) is how long one scene may take; it is extended while Muse is visibly still working. A scene prompt is the scene's own prompt plus the project's visual style and character description; narration is not sent yet.

`tests/test_muse_media.py` drives a real Chromium against a local page that mimics the Muse composer, and `tests/test_ffmpeg_merge.py` uses a real FFmpeg; both are skipped when the binary is missing.

## Validation

```bash
uv run --locked pytest -q
```

Tests use isolated temporary databases and cover validation, empty state, draft creation, detail lookup, restart persistence, baseline migration, model consistency, script persistence/replacement, duration and input validation, locked statuses, concurrent revision conflicts, rollback behavior, cascading project deletion, deletion status rules and concurrency, the OpenAPI snapshot, account CRUD and duplicate imports, credential redaction, encryption/restart persistence, and missing-key recovery. They do not write to the development database.


## AI Script Generation

`POST /api/projects/{id}/script-generation` creates a durable `plan_script` task. `GET` on the same path retrieves the latest task, including its validated proposal when it succeeds. The task uses the existing in-process coordinator and shared account lock; no Redis or extra engine service is needed. Select an enabled, verified account. Chromium/Chrome must be installed on the host; the executable is auto-detected or set with `MUSE_BROWSER_PATH`. `MUSE_PLANNING_TIMEOUT` defaults to 300 seconds.

The worker reads the Muse session, preserves rotated cookies, then sends the creative brief once in an isolated browser context. The response must be complete JSON with the exact target scene timeline. A proposal is stored as task output and is only applied through the existing script save endpoint after user review. Failures and cancellation preserve the previously saved scenes. Restart recovery uses the coordinator's submitted-request marker to avoid blindly resending a request that may already exist upstream.

`app/planning/` owns prompt construction, validation and task behavior; `app/integrations/muse/chat.py` owns browser interaction. The implementation follows the reference web-session protocol. Current live account compatibility has not been established by the local fixture tests.

### Planner Integration Check

From the repository root, start the local Postman simulation:

```bash
postman simulation run postman/simulations/muse-planning/muse-planning.sim.yaml --port 4021 --no-history
```

In another terminal, from `backend/`:

```bash
MUSE_PLANNING_SIMULATION_URL=http://127.0.0.1:4021/muse uv run --locked pytest tests/test_script_generation_simulation.py -q
```

This exercises the real HTTP client, Chromium composer, durable task worker, proposal application, invalid reply handling and cancellation against a synthetic provider. It does not call a real Muse account. The ordinary test suite skips this optional check when its simulation URL is absent.
