# Mahaa API

Backend for the Mahaa mobile app. FastAPI + PostgreSQL + SQLAlchemy 2.0 + Alembic,
deployed through a Render Blueprint.

**Status: scaffold only.** Liveness, readiness, configuration, database wiring and
the error envelope exist. Authentication and business endpoints are deliberately
absent, not stubbed.

---

## Requirements

- Python 3.12 (the Render service pins `3.12.8`)
- PostgreSQL 15 or newer
- No Docker required; the Blueprint builds with pip

## Setup

Run every command from the repository's `backend/` directory unless noted.

```powershell
cd backend

# 1. Virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # Windows
# source .venv/bin/activate           # macOS / Linux

# 2. Dependencies
pip install --upgrade pip
pip install -r requirements.txt
```

### Environment

```powershell
Copy-Item .env.example .env
```

Then edit `backend/.env` and set `DATABASE_URL`. Commit `.env.example`; never
commit `.env` — it is gitignored.

| Variable | Default | Notes |
| --- | --- | --- |
| `APP_ENV` | `development` | `production` enables the fail-closed checks below. |
| `DEBUG` | `false` | Must be `false` in production. |
| `DATABASE_URL` | placeholder | `postgresql+psycopg://user:password@host:5432/mahaa`. |
| `API_PREFIX` | `/api/v1` | Every route is mounted under it. |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` in a container. |
| `PORT` | `8000` | Render injects its own. |
| `CORS_ORIGINS` | empty | Comma-separated exact origins, never `*`. |

A bare `postgresql://` URL is accepted and rewritten to `postgresql+psycopg://`
automatically. A non-PostgreSQL URL is rejected at startup, not at the first query.

### Database and migrations

```powershell
alembic upgrade head                      # apply migrations
alembic revision --autogenerate -m "add users table"
alembic downgrade -1                      # roll back one
alembic current                           # what is applied
alembic history                           # the full chain
alembic upgrade head --sql > migration.sql  # review SQL without connecting
```

`alembic.ini` deliberately contains **no** database URL. `alembic/env.py` reads it
from application settings, so Alembic and the app cannot be pointed at different
databases. For a one-off run against a scratch database:

```powershell
alembic -x db_url="postgresql+psycopg://user:pass@localhost:5432/scratch" upgrade head
```

Alembic needs a model to see a table: a model that is not imported into
`app/models/__init__.py` is invisible to `autogenerate`.

## Running

```powershell
uvicorn app.main:app --reload --port 8000
```

- API root: <http://localhost:8000/api/v1>
- Interactive docs: <http://localhost:8000/docs>
- Liveness: <http://localhost:8000/api/v1/health>
- Readiness: <http://localhost:8000/api/v1/ready>

## Testing

```powershell
pytest                       # whole suite
pytest -q --no-header        # concise
ruff check app tests         # lint
```

The suite needs **no** database. `/health` never opens a connection, and
`/ready` is tested both ways by substituting the probe — a suite that needed live
infrastructure would be skipped exactly when a broken health endpoint matters.


## What exists

| Route | Purpose | Checks the database? |
| --- | --- | --- |
| `GET /api/v1/health` | Liveness | No |
| `GET /api/v1/ready` | Readiness | Yes, `SELECT 1` |

The split is deliberate. A liveness probe that queries the database restarts a
healthy application every time the database has a bad minute; a readiness probe
that does not query it will happily route traffic to an instance that cannot
serve.

### Error contract

Every non-2xx response uses one envelope, so the mobile client parses failures
identically regardless of which route produced them:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Some of the details provided were not valid.",
    "details": [{ "field": "body.email", "message": "...", "type": "..." }],
    "request_id": "8e5723c1ade9"
  }
}
```

`details[].field` keeps the framework's `body.` / `query.` prefix because that is
the location the client maps back onto an input.

Every response carries `X-Request-ID`. An inbound value is preserved so a trace
keeps one id end to end; otherwise one is generated.

### Failing safely

With `APP_ENV=production` the service refuses to start on:

- the placeholder `DATABASE_URL`
- `DEBUG=true`
- `CORS_ORIGINS` containing `*`

A backend that boots with development-grade settings and only fails on the first
request is worse than one that never starts: the failure then looks like an
application bug instead of a configuration one.

### Logging

One JSON object per line on stdout: `timestamp`, `level`, `logger`, `message`,
plus explicit `request_id`, `method`, `path`, `status_code` and `duration_ms` per
request. Connection strings, bodies and settings objects are never logged, and an
unhandled exception is logged in full while the response stays generic.

---

## Render deployment

The Blueprint is `render.yaml` at the **repository root**, not in `backend/`.

1. Push the branch containing `render.yaml`.
2. In Render: **New → Blueprint**, select this repository, and apply.
3. Render creates the `mahaa-backend` service and the `mahaa-db` database, and
   wires `DATABASE_URL` from the database's internal connection string.
4. Set `CORS_ORIGINS` in the dashboard when a web client exists.
5. Confirm the deploy log shows the service reaching `startup`, then check
   `https://<service>.onrender.com/api/v1/health`.

**Apply the Blueprint once.** It creates resources; it is not a config-sync tool.
Afterwards, change settings in the dashboard.

Then run migrations against the deployed database — a Blueprint does not do it:

```powershell
# Using the internal connection string from the Render dashboard
$env:DATABASE_URL = "postgresql://<user>:<password>@<internal-host>:5432/mahaa"
alembic upgrade head
```

### Blueprint contents

- Service `mahaa-backend`, `rootDir: backend`, `runtime: python`, `region: singapore`
- `pip install -r requirements.txt` to build
- `uvicorn app.main:app --host 0.0.0.0 --port $PORT` to start
- Health check `/api/v1/health` — liveness, not readiness, deliberately
- Database `mahaa-db` (database name `mahaa`), PostgreSQL 16, same `region`
- `DATABASE_URL` via a `fromDatabase` reference, so no password is ever written
  into a file

No secret is stored in the repository, and nothing references any other project's
service or database.

### Notes on the free plan

The Blueprint uses `plan: free` for both the service and the database, and pins
`region: singapore` on both so they talk over Render's private network.

`free` is the one Render plan ID that does not follow the `<cpu>-<ram>` naming
format. Every other plan is `0.5c-512mb`, `1c-2g`, `2c-4g` and so on.

**The free database deletes itself and all of its data 30 days after creation.**
It goes inaccessible at expiry, you get 14 further days to upgrade to a paid
plan, and then Render removes the database. It is capped at 1 GB, has no
backups, and only one free database is allowed per workspace. Treat this deploy
as a proof that the plumbing works, and budget a paid plan before any real data
exists.
