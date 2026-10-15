# Mahaa Message service (`message-docker-service`)

A small, independent FastAPI service that owns **message requests** — asking
permission to message, and accepting or rejecting that ask. It shares the main
backend's Neon PostgreSQL database but owns exactly one thing in it: the
`message_requests` table (its migration lives in `message-service/alembic/`).

It does **not** own conversations or messages. Those stay in the main backend
(`mahaa-backend-docker`), whose `/conversations` router the mobile All tab
already reads. There are no competing owners for any table or route.

## Ownership map

| Concern | Owner |
|---|---|
| Message requests (`/message-requests`, 5 routes) | This service |
| `message_requests` table + its migration | This service (`message-service/alembic/`) |
| Conversations and messages (`/conversations`, `/messages`) | Main backend (`backend/app/api/v1/endpoints/messaging.py`) |
| Connections (`/connections`) | Main backend (`backend/app/api/v1/endpoints/connections.py`) |
| `users` table (read for sender summaries, never written) | Main backend migrations; this service reads it read-only |

A **message request is not a connection request**. Accepting a message request
grants permission to message; it never creates or accepts a connection. The two
flows use different tables, different routes, and different mobile code paths.

## Routes

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/api/v1/message-requests?status=&limit=` | Caller's own received requests, newest first; includes server-derived `pending_count` |
| `GET` | `/api/v1/message-requests/count` | Server-derived pending total for the Requests tab badge |
| `POST` | `/api/v1/message-requests` | Send a request (`{recipient_id, note?}`); 201 created, 200 already pending |
| `POST` | `/api/v1/message-requests/{id}/accept` | Recipient only; 409 when already resolved |
| `POST` | `/api/v1/message-requests/{id}/reject` | Recipient only; 409 when already resolved |
| `GET` | `/api/v1/health` | Liveness, no database touch |
| `GET` | `/api/v1/ready` | Readiness, checks database connectivity |

Auth: the same JWT the main backend issues (`JWT_SECRET`, `JWT_ISSUER`,
`JWT_AUDIENCE` must match). The acting user is always derived from the token —
no sender or recipient id from the client is ever trusted. Only the intended
recipient can accept or reject; anyone else gets 404.

## Local development

Prerequisites: Python 3.12, a local PostgreSQL (the tests refuse any
non-loopback host), and the **main backend's migrations applied first**
(`users` must exist before this service's migration adds `message_requests`).

```powershell
# 1. Apply migrations: backend first, then this service.
Set-Location c:\mahaa\backend
.\.venv\Scripts\python.exe -m alembic upgrade head
Set-Location c:\mahaa\message-service
c:\mahaa\backend\.venv\Scripts\python.exe -m alembic upgrade head

# 2. Configure (copy and edit — never commit real secrets).
Copy-Item .env.example .env

# 3. Run the service (port 8001 beside the main API's 8000).
c:\mahaa\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001

# 4. Verify.
#    Health:    http://127.0.0.1:8001/api/v1/health
#    Readiness: http://127.0.0.1:8001/api/v1/ready   (needs DATABASE_URL)
```

The mobile app needs no `.env` edit locally: `src/lib/messageApiBaseUrl.ts`
derives the message-service URL from the main API base by swapping the port to
8001 whenever the main base is a local-dev host. A deployed message service is
pointed at with `EXPO_PUBLIC_MESSAGE_API_BASE_URL` (plus `_WEB` / `_LAN`
platform overrides, mirroring the main variable).

## Docker

Build context is **this directory** — nothing outside it is copied.

```powershell
Set-Location c:\mahaa\message-service
docker build -t message-docker-service:local .
docker run --rm -p 8001:8001 --env-file .env message-docker-service:local
```

The image listens on `0.0.0.0` and `${PORT:-8001}`, runs as non-root
`appuser`, and exposes a Python-based `HEALTHCHECK` against
`/api/v1/health` (liveness only; `/api/v1/ready` is deliberately not the
probe — a transient database outage must not read as a dead process).
Responses are sanitized: no SQL errors or secrets leak into health/readiness
payloads.

## Docker Compose (local, isolated)

`docker-compose.yml` in this directory runs the service against its **own
isolated** PostgreSQL — never the main backend's database and never Neon.

```powershell
Set-Location c:\mahaa\message-service
docker compose up --build          # db (healthy) + app (healthy) on :8001
# First run only: apply schema to the fresh local DB (backend migrations first,
# then this service's). Both from the host against 127.0.0.1:5435:
#   cd backend; DATABASE_URL=postgresql+psycopg://msgsvc:msgsvc_local_dev@127.0.0.1:5435/msgsvc .\.venv\Scripts\python.exe -m alembic upgrade head
#   cd ..\message-service; DATABASE_URL=postgresql+psycopg://msgsvc:msgsvc_local_dev@127.0.0.1:5435/msgsvc ..\backend\.venv\Scripts\python.exe -m alembic upgrade head
```

- **Ports:** app → `http://localhost:${MESSAGE_SERVICE_PORT:-8001}`; db published
  loopback-only on `127.0.0.1:${MSGSVC_PG_HOST_PORT:-5435}` (for migrations).
- **Isolation:** `DATABASE_URL` is set explicitly to the Compose `db` service,
  so a stray local `.env` can never point this stack at production.
- **Migrations never run on startup.** Apply them manually (above), or use the
  one-shot `docker compose --profile migrate run --rm migrate`.
- **`msgsvc_pgdata` volume** keeps only local test rows across restarts; it is
  not a backup and never touches production (`down -v` removes it).

## Tests

Dependencies are split so the production image stays lean: `requirements.txt`
is runtime-only, and `requirements-dev.txt` (`-r requirements.txt` plus
`pytest`/`httpx`) is for local test runs.

```powershell
Set-Location c:\mahaa\message-service
# One-off, using the backend venv already on this machine (it has the same
# fastapi/sqlalchemy/pydantic bounds). The two test extras are installed there.
# Suite runs against a local PostgreSQL only (TEST_DATABASE_URL or
# DATABASE_URL on loopback). Without one, DB tests skip honestly while
# health/auth tests still run.
c:\mahaa\backend\.venv\Scripts\python.exe -m pytest tests -q
```


## Render deployment preparation (NOT deployed)

See **`DEPLOYMENT.md`** for the full readiness report — what was verified
locally versus what still depends on a hosting provider, the runtime contract,
database/migration safety, rollback, and the hosting assessment.

Summary: future service name `message-docker-service`. The current
`mahaa-backend-docker` service is unchanged.

- **Dockerfile location:** `message-service/Dockerfile`
- **Build context / command:** `message-service/` as the Docker build context;
  `docker build -t message-docker-service .` from that directory
- **Start command / port:** `uvicorn app.main:app --host 0.0.0.0 --port
  ${PORT:-8001}` (the image's CMD); Render injects `PORT`
- **Health path:** `GET /api/v1/health` (liveness, no DB)
- **Readiness path:** `GET /api/v1/ready` (checks database connectivity)
- **Environment variables (names only):** `DATABASE_URL`, `JWT_SECRET`,
  `JWT_ALGORITHM`, `JWT_ISSUER`, `JWT_AUDIENCE`, `CORS_ORIGINS`, `APP_ENV`,
  `DEBUG`, `LOG_LEVEL`, `PORT`. No values live in this repo.
- **Auth validation:** bearer JWT verified against the shared `JWT_SECRET` /
  issuer / audience; acting user derived from the token on every route
- **Database:** connects to the existing Neon PostgreSQL via `DATABASE_URL`
  (same database as the main backend; owns only `message_requests`)
- **CORS:** exact origins from `CORS_ORIGINS`, never `*`; the mobile app sends
  no `Origin` header, so an empty value is correct for mobile-only use
- **Client discovery:** the mobile app resolves the service URL from
  `EXPO_PUBLIC_MESSAGE_API_BASE_URL` (explicit) with a local-dev port-8001
  derivation as fallback; `null` renders a configuration notice, never a
  doomed request
- **Rollback:** redeploy the previous image tag of `message-docker-service`;
  the main backend is a separate service and is unaffected. The single
  additive migration (`message_requests` table creation) does not alter
  existing tables, so rolling back the service binary needs no data change.
- **DNS / TLS / WebSocket / Redis:** none required. Render supplies DNS and
  TLS; the service is stateless REST with no WebSocket route and no Redis
  dependency (Redis is optional and unused in this phase; persistence works
  without it).

**Pre-deploy checklist:** provision `message-docker-service` from this
directory's Dockerfile; set the environment variables above from Render's
secret store (JWT values identical to `mahaa-backend-docker`); run the
`message_requests` migration against the shared database from a controlled
job (never from app startup); point the mobile build at the service URL via
`EXPO_PUBLIC_MESSAGE_API_BASE_URL`; verify `/ready` before routing traffic.
