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
alembic check                             # model/migration drift
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

## Phase 1 — database foundation

The first schema revision, `7d162daa433c`, creates 13 tables: `users`,
`profiles`, `profile_privacy`, `profile_preferences`, `profile_links`, `skills`,
`user_skills`, `education`, `experience`, `projects`, `project_skills`,
`certifications`, `achievements`. No route reads any of them yet.

Conventions, all enforced by the database rather than by convention:

| Concern | Choice | Why |
| --- | --- | --- |
| Primary key | `uuid`, generated in Python | A sequential integer id is enumerable across accounts |
| Timestamps | `timestamptz`, `server_default=now()` | A naive timestamp means different instants in different sessions |
| Email | `citext` | Uniqueness is case-insensitive *in the database* |
| Vocabularies | `VARCHAR` + `CHECK`, not a native `ENUM` | Adding a value stays a code change, not an `ALTER TYPE` |
| Delete behaviour | `CASCADE` for owned rows, `RESTRICT` for referenced ones | A claimed skill cannot be deleted out from under a user |

Deliberately **not** in Phase 1, because they belong to later phases: the auth
token tables, and the media table. `users.avatar_media_id` therefore exists as a
nullable `uuid` with no foreign key — a constraint may not reference a table
that does not exist yet, and the media phase adds both together.

### Setting up a local database

Use a **local** PostgreSQL only. The test fixtures refuse any host that is not
loopback, so a stray production `DATABASE_URL` cannot be written to by mistake.

```powershell
# one-off, local only
createuser -U postgres mahaa_dev
createdb  -U postgres mahaa
$env:DATABASE_URL = "postgresql+psycopg://postgres@localhost:5432/mahaa"
alembic upgrade head
```


#### Seed the skills catalogue

`skills` is a catalogue **table**, and the migration creates it empty. A freshly
migrated database therefore serves an empty catalogue, the skill picker offers
nothing, and **onboarding cannot get past 50%** — the `skills` step never
completes, so a new account can never reach Home.

Seed it once after migrating:

```powershell
# dry run first; this is the default and writes nothing
.\.venv\Scripts\python.exe tools\seed_skills.py --catalog tools\skills_catalog.json

# then apply, against the local database only
.\.venv\Scripts\python.exe tools\seed_skills.py --catalog tools\skills_catalog.json --apply
```

`DATABASE_URL` is read from the environment, so export it first. The script is
idempotent (a second run inserts 0 rows), dry-runs unless `--apply` is passed,
and refuses a `.example.` catalogue in production. It reports only
`host:port/database`, never the password.

`tools/skills_catalog.json` is the approved catalogue: **140 skills across 18
categories**. `tools/SKILLS_SEED.md` has the format and the column contract.

Check it took:

```powershell
(Invoke-RestMethod http://127.0.0.1:8000/api/v1/skills/catalog -Headers @{
    Authorization = "Bearer $env:TOKEN"
}).total   # expect 140
```
To run against a scratch database without touching `DATABASE_URL`, pass the
override Alembic already supports:

```powershell
alembic -x db_url="postgresql+psycopg://postgres@localhost:5432/mahaa" upgrade head
```

### Tests

The database tests need a real PostgreSQL: what Phase 1 promises lives *in* the
database (a `UNIQUE`, a `CHECK`, a `citext` comparison), so a SQLite stand-in
would test none of it. They skip cleanly when no database is configured, so
`pytest` still passes on a machine without one.

```powershell
$env:TEST_DATABASE_URL = "postgresql+psycopg://postgres@localhost:5432/mahaa"
pytest -q                 # 53 passed
ruff check app tests tools
```

Point `TEST_DATABASE_URL` at a migrated database. Nothing in the suite creates
or drops a table, and every test is rolled back.

### Ad-hoc schema inspection

```powershell
$env:MAHAA_VERIFY_URL = "postgresql+psycopg://postgres@localhost:5432/mahaa"
python tools/verify_schema.py   # tables, keys, constraints, indexes, types
python tools/roundtrip.py       # downgrade to base, upgrade to head, re-check
```

Both refuse a non-loopback host.

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

The suite needs a **local** PostgreSQL for the database-backed tests, and skips them
when one is not configured. `/health` never opens a connection, and `/ready` is
tested both ways by substituting the probe — a suite that needed live
infrastructure would be skipped exactly when a broken health endpoint matters.

```powershell
$env:TEST_DATABASE_URL="postgresql+psycopg://postgres@localhost:5432/mahaa"
pytest
```

The authentication tests use a real app, real Argon2 and real JWTs, with only the
database session swapped for a rolled-back one, so a row written through a request
never outlives its test.

## What exists

| Route | Purpose | Checks the database? |
| --- | --- | --- |
| `GET /api/v1/health` | Liveness | No |
| `GET /api/v1/ready` | Readiness | Yes, `SELECT 1` |
| `POST /api/v1/auth/signup` | Create an account, return a token | Yes |
| `POST /api/v1/auth/login` | Exchange credentials for a token | Yes |
| `GET /api/v1/auth/me` | The signed-in principal | Yes |
| `GET /api/v1/users/me` | The caller's own account | Yes |

The split between the two health probes is deliberate. A liveness probe that
queries the database restarts a healthy application every time the database has a
bad minute; a readiness probe that does not query it will happily route traffic
to an instance that cannot serve.

### Phase 2 — authentication

**V1 is access-token-only.** There is no refresh token, no server-side session,
and no revocation list: signing in again is the only way to extend a session.
This is an approved product decision, not an omission.

- **Passwords** are hashed with **Argon2id** (`argon2-cffi`) at
  `m=19456 KiB, t=2, p=1` — the OWASP minimum. The alternatives were measured
  locally rather than assumed: 64 MiB costs ~189 ms per verification against
  ~75 ms here, and 64 MiB *per concurrent hash* is a genuine memory risk on a
  Render **Free** instance. The chosen parameters are recorded inside each hash,
  so raising them later is a re-hash on next sign-in, not a migration.
- **Tokens** are HS256 JWTs carrying `sub`, `role`, `public_id`, `type`, `jti`,
  `iat`, `exp`, `iss`, `aud`, living 60 minutes. The algorithm is pinned from
  configuration and the incoming `alg` header is never trusted, so `alg: none`
  and algorithm confusion are both refused. `iss` and `aud` are verified on every
  decode.
- **Production fails closed.** With `APP_ENV=production` the service refuses to
  start if `JWT_SECRET` is missing, empty, still the development placeholder, or
  shorter than 32 characters — and if `JWT_ALGORITHM` is not a pinned symmetric
  algorithm. A deploy signing tokens with a public key is worse than a deploy
  that never comes up.
- **No account enumeration.** An unknown email and a wrong password produce the
  same status, the same error code, and the same sentence. A dummy hash is also
  verified on a miss, so the two paths take the same time and the difference
  cannot be measured either.
- **No logout route.** With stateless access tokens there is nothing for the
  server to revoke; `src/auth/AuthProvider.tsx` already implements sign-out as
  clearing the stored token. An endpoint that returned 204 and changed nothing
  would be theatre.
- **No schema change.** Phase 1 already created every column authentication
  needs (`password_hash`, `status`, `email_verified_at`, `last_login_at`), so
  the migration head is still `7d162daa433c` and `alembic check` reports no
  drift. Adding an empty revision would only be noise in the permanent history.

Known limitation, tracked not hidden: the rate limiter keeps counters in process
memory, so it resets on every deploy and is per-instance. On Render Free that is
a speed bump rather than a guarantee; a shared store is the real fix. See the
comment block in `app/core/rate_limit.py` and `AUTH_RATE_LIMIT_*` in
`.env.example`.

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

### Phase 8 (stories) — and the boundary it deliberately stops at

`stories` and `story_views` exist, and the three routes the mobile client actually
calls are live:

| Route | Class | Purpose |
| --- | --- | --- |
| `GET /api/v1/stories?page=&page_size=` | [M] | Active-stories feed, newest first |
| `GET /api/v1/stories/{id}` | [M] | One story, for the viewer |
| `POST /api/v1/stories/{id}/view` | [M] | Idempotent per-viewer view |
| `POST /api/v1/stories` | [F] | Server-side (platform) publication |
| `DELETE /api/v1/stories/{id}` | [F] | Hard delete, cascades its views |

**This is a staged implementation, not the finished §14.10 architecture.** §14.10
specifies `stories.company_id` FK → `companies` and `stories.opportunity_id` FK →
`opportunities`, plus
`CHECK (publisher_kind = 'company') = (company_id IS NOT NULL)`. Those two tables are
the career domain, which is **Phase 9**, so this phase cannot declare a foreign key to
a table that does not exist. In their place a story carries:

- `publisher` — JSONB `{name, logo_url, verified}`, a **display snapshot** taken from
  the publishing account at publication time;
- `opportunity` — JSONB `{id, title, location, work_mode}` or null, always null in
  V1.

`publisher_kind` *is* stored and constrained to `(company, platform)`, but the write
path refuses `company` with a 422, because nothing in the database could verify that
the company exists and the feed renders that badge. Phase 9 replaces the two JSONB
columns with real foreign keys, relaxes that one branch to a lookup, and adds the
CHECK back.

A snapshot rather than a join is also what makes the response stable: a publisher
that renames itself does not retroactively rewrite the caption under every story it
published, and the client reads `publisher.name` without re-fetching it.

**Deferred to Phase 9, deliberately:**

- the `companies` domain and `stories.company_id`;
- the `opportunities` domain and `stories.opportunity_id`;
- `CHECK (publisher_kind = 'company') = (company_id IS NOT NULL)`;
- company-kind publication, which is a 422 today;
- `companies.logo_media_id` in the media deletion reference check
  (`services/media.py` is the one place to extend when it lands);
- `GET /opportunities`, which shares this domain's `FastApiPage` envelope.

**Expiry is evaluated at query time, and no sweeper exists.** §10.2 requires the list
to return active stories only and says the client sends no date filter, so the server
owns the window. `expires_at` is an explicit NOT NULL column — §10.2's recommendation,
because a per-story window is then adjustable without a migration and `(expires_at)`
becomes indexable — and both the list query and the `COUNT` filter
`expires_at > now() AND status = 'published'`. An expired story is indistinguishable
from a deleted one, which is exactly why nothing needs to have deleted it. §10.2's
separate 30-day *retention* job is not built; it is optional and would buy no
observable difference.

There is **no notification** for any story operation: §13.1's registry has no story
type and §10 specifies none, so none was invented.

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
