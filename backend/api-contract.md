# Project API Contract

FastAPI's `/openapi.json` is the authoritative machine-readable contract. The checked-in `openapi.json` is an exported snapshot.

- `GET /api/projects`: HTTP 200 with one page of project summaries.
  - Query: `q` (name search, up to 100 characters; case-, accent-, and `đ`-insensitive; `%` and `_` are literal), `status` (`all` default, `inProgress`, `completed`, `cancelled`; `inProgress` is every status except `completed` and `cancelled`, so failed projects are included), `sort` (`updated` default: newest update first; `name`: A–Z by the normalized name; `duration`: longest first, then newest update), `limit` (1–100, default 24), and `cursor`.
  - Response: `{ "items": [...], "total": 0, "nextCursor": null, "counts": { "all": 0, "inProgress": 0, "completed": 0, "cancelled": 0 }, "featured": null }`.
  - `items` are summaries: every project field except `idea` and `scenes`. Fetch the detail endpoint for those.
  - `total` counts projects matching `q` and `status` across all pages. `counts` (status chips) and `featured` ignore `q` and `status`. `featured` is the most recently updated `ready` project, otherwise the most recently updated in-progress project, and includes up to six `previewScenes` (`number`, `title`).
  - Pagination is keyset-based: pass `nextCursor` back as `cursor` with the same `q`, `status`, and `sort` until it is `null`. Each order ends with the project ID, so projects created between requests never cause later pages to repeat or skip rows. Cursors are opaque; a malformed cursor or one issued for another `sort` returns HTTP 400 with `detail.code = invalid_cursor`. Invalid `status`, `sort`, or `limit` values return HTTP 422.
- `POST /api/projects`: HTTP 201 and a `Location` header. Required `name` is trimmed, 1–100 characters. Optional `idea` defaults to an empty string and has a 12,000-character limit. `durationSeconds` defaults to 60 and must be an integer from 10–300, divisible by 5. `aspectRatio` defaults to `16:9`; allowed values are `16:9`, `9:16`, and `1:1`. Unknown fields are rejected with HTTP 422.
- `GET /api/projects/{project_id}`: HTTP 200 for a saved project; HTTP 404 with `detail.code = project_not_found` otherwise. Treat IDs as opaque strings.

Responses use camelCase fields matching the frontend project schemas. Dates are UTC ISO 8601 strings ending in `Z`. New projects are drafts with zero scenes, zero completed scenes, and an empty scene list. Script generation and rendering are separate future operations; creating a draft does not contact Muse.

SQLite persists projects across service restarts. No sample projects are inserted automatically, and browser-local demo drafts are not silently imported or deleted. The development service is accessed through the Vite `/api` proxy. Access-key setup belongs to a later application step; these initial local-development endpoints do not implement authentication yet.

POST is not idempotent. The frontend does not automatically retry failed create requests and keeps form values so users can decide whether to retry. List and detail failures have separate retry controls; transport errors must not appear as an empty collection or a missing project.
