# Message service — Docker build, local run, and Render deployment

Audience: the operator who will build this image and, later, create the Render
service. Placeholders only — no secret appears in this file.

Companion: `docs/DOCKER_BUILD_REPORT.md` (what was actually built and observed).

## 1. Architecture overview

One application container, external dependencies:

```
mobile app ──► main API (mahaa-backend-docker)      sign-in, conversations
mobile app ──► message service (this image)          message requests only
message service ──► PostgreSQL (Neon in prod)        users (read), message_requests (own)
```

* FastAPI + uvicorn (`app.main:app`). Stateless REST only — no WebSocket,
  no Redis, no background workers.
* Five routes on `/api/v1/message-requests` (list, count, create, accept,
  reject) plus liveness `/api/v1/health` and readiness `/api/v1/ready`.
  Real-time messaging and attachments live in the main backend, not here.
* Database: shares the main backend's PostgreSQL. Owns ONLY the
  `message_requests` table (FK to backend-owned `users`); own Alembic version
  table (`alembic_version_message_service`).
* Auth: verify-only JWT, same bearer token the main API minted, so
  `JWT_SECRET`/`JWT_ISSUER`/`JWT_AUDIENCE` must be byte-identical.
* Attachment storage: none. No disk or object writes at all.

## 2. Dockerfile explanation

Build context = `message-service/` (Render `rootDir` and `docker build .`).

* Stage 1 `builder` (`python:3.12-slim`): `requirements.txt` into `/install`
  prefix. Manifest first so source edits keep the dependency layer cached.
  No compiler toolchain — everything ships manylinux wheels.
* Stage 2 `runtime`: copies `/install`, then `app/`, `alembic/`,
  `alembic.ini`, `pyproject.toml`, `requirements.txt` by name.
* Non-root `appuser` (uid 999); `WORKDIR /app`; `EXPOSE 8001` (docs only).
* `HEALTHCHECK` probes `GET /api/v1/health` in plain Python (no curl in slim),
  port read from `$PORT`.
* `CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0
  --port ${PORT:-8001}"]` — `exec` makes uvicorn PID 1, so `docker stop`
  shuts down gracefully (exit 0, not SIGKILL 137).
* No `ENV` secret: config arrives at run time only.

## 3. `.dockerignore` explanation

Excludes credentials (`.env`, `.env.*`), `.git/`, caches, virtualenvs,
`tests/`, Compose files, logs and scratch files (`_*`, `*.log`). Not a
substitute for `.gitignore`; both agree on secrets. Verified: `docker
history` shows no secret, `/app/.env` absent in the container, logs clean.

## 4. Required environment variables

| Variable | Local default | Production (Render secret store) |
|---|---|---|
| `APP_ENV` | `development` | `production` |
| `DEBUG` | `true` | `false` |
| `PORT` | `8001` | injected by Render |
| `DATABASE_URL` | local `postgresql+psycopg://…` | Neon URL, `sync: false` |
| `JWT_SECRET` | `dev-only-insecure-secret-change-me` | backend value, `sync: false` |
| `JWT_ISSUER` | `mahaa-api` | backend value, `sync: false` |
| `JWT_AUDIENCE` | `mahaa-mobile` | backend value, `sync: false` |
| `CORS_ORIGINS` | empty | exact origins or empty, `sync: false` |
| `JWT_ALGORITHM` | `HS256` | same as backend |
| `LOG_LEVEL` | unset (from `DEBUG`) | unset or `INFO` |
| `MAX_BODY_BYTES` | unset (65536) | unset |

`APP_ENV=production` is fail-closed: refuses placeholder/short secrets,
placeholder DB URL, `DEBUG=true`, wildcard CORS, empty issuer/audience.

## 5. Local image build command

```powershell
cd C:\mahaa\message-service
docker build -t mahajob-message-service:local .
docker images mahajob-message-service:local   # expect ~300 MB
```

Record exit code, size and duration in the build report. Never push this tag.

## 6. Local container run command

Against a local database (sections 7 and 10 first for schema):

```powershell
docker run --name mahajob-msgtest -d -p 8011:8001 `
  -e APP_ENV=development -e DEBUG=true `
  -e DATABASE_URL='postgresql+psycopg://msgsvc:msgsvc_local_dev@host.docker.internal:5435/msgsvc_dockertest' `
  -e JWT_SECRET='dev-only-insecure-secret-change-me' `
  -e JWT_ISSUER=mahaa-api -e JWT_AUDIENCE=mahaa-mobile `
  mahajob-message-service:local
curl.exe -s http://127.0.0.1:8011/api/v1/health   # {"status":"ok",...}
curl.exe -s http://127.0.0.1:8011/api/v1/ready    # {"status":"ready",...}
docker stop mahajob-msgtest   # expect exit code 0 (graceful)
docker rm mahajob-msgtest
```

Port 8011 is the validated throwaway port. In-container the DB host is
`host.docker.internal`, never `localhost`. Never production URLs here.

## 7. Local Compose commands

```powershell
cd C:\mahaa\message-service
docker compose up --build -d        # db (127.0.0.1:5435) + app (:8001)
docker compose ps                   # both healthy
docker compose logs -f app          # JSON logs, request_id per line
docker compose --profile migrate run --rm migrate   # schema, MANUAL ONLY
docker compose down                 # keep named volume msgsvc_pgdata
```

Compose's app targets service DNS `db:5432` explicitly. New database order:
backend migrations first (creates `users`), then this service's migration.

## 8. Health-check commands

```powershell
$base = 'http://127.0.0.1:8011'
curl.exe -s "$base/api/v1/health"   # 200 ok — process alive
curl.exe -s "$base/api/v1/ready"    # 200 ready — can serve
```

Wrong DB password: `/ready` → 503 `not_ready` while `/health` stays 200.
Render's `healthCheckPath` uses liveness only, so a slow database never
restart-loops a healthy process.

## 9. API test commands

Suite (needs local migrated DB; refuses non-local hosts):

```powershell
cd C:\mahaa\message-service
$env:TEST_DATABASE_URL='postgresql+psycopg://msgsvc:msgsvc_local_dev@127.0.0.1:5435/msgsvc_dockertest'
C:\mahaa\backend\.venv\Scripts\python.exe -m pytest tests -q
C:\mahaa\backend\.venv\Scripts\python.exe -m ruff check app tests
```
## 11. Production database backup and migration approval procedure

1. Owner approves the migration window in writing (revision, reason, rollback).
2. Take a fresh Neon backup / snapshot and record its id.
3. From an operator machine (never Render, never a container): run this
   service's `alembic upgrade head` with the Neon URL; confirm only the
   `message_requests` change set applies (never backend-owned tables).
4. Run post-migration smoke (section 17) before announcing.
5. Rollback is `downgrade <previous revision>` with the same approval, or a
   snapshot restore if the shape changed incompatibly.

## 12. Attachment-storage requirements

None for this service. It stores no bytes on disk or in object storage; the
only row it writes is `message_requests`. If attachments are ever added here,
they must go to durable storage — never container-local disk, which Render
discards on redeploy.

## 13. Render Docker deployment settings

In the repo Blueprint `render.yaml` (service `message-docker-service`):

* `runtime: docker`, `region: singapore`, `plan: free` (scaffold tier).
* `rootDir: message-service`, `dockerfilePath: Dockerfile`,
  `healthCheckPath: /api/v1/health`.
* `PORT: "8001"` committed (Render overrides at run time; CMD honours `$PORT`).
* `APP_ENV: production`, `DEBUG: "false"` committed (fail-closed guards).
* `DATABASE_URL`, `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `CORS_ORIGINS`
  as `sync: false` — dashboard values, never in the file.

## 14. Secret configuration in Render

Dashboard, `message-docker-service`, Environment: `DATABASE_URL` (Neon pooled
URL), `JWT_SECRET`/`JWT_ISSUER`/`JWT_AUDIENCE` (exact copies from
`mahaa-backend-docker`), `CORS_ORIGINS` if a browser client exists. A typo
surfaces as the config error shape (field names only, exit 1) — fix the value.

## 15. Mobile integration and production URL setup

No code change. `src/lib/messageApiBaseUrl.ts` resolves the message base:
explicit `EXPO_PUBLIC_MESSAGE_API_BASE_URL` wins, else a local main base
derives `:8001`, else unconfigured. After deploy, set in the mobile env:

```
EXPO_PUBLIC_MESSAGE_API_BASE_URL=https://message-docker-service.onrender.com/api/v1
```

(real Render host substituted). The `/api/v1` suffix is a shared contract.

## 16. HTTPS and CORS

Render terminates HTTPS; the service listens plain HTTP on `$PORT` in the
private network. `CORS_ORIGINS` lists exact origins, never `*` (refused at
boot in production); mobile-only stays empty (no `Origin` header).

## 17. Smoke tests after a future deployment

```powershell
$base = 'https://message-docker-service.onrender.com'
curl.exe -s "$base/api/v1/health"   # 200 ok
curl.exe -s "$base/api/v1/ready"    # 200 ready
curl.exe -s -H "Authorization: Bearer <real-token>" "$base/api/v1/message-requests/count"
curl.exe -s -o NUL -w 'HTTP=%{http_code}\n' "$base/api/v1/message-requests"   # 401
```

`/ready` failing after deploy means env values or Neon connectivity — do not
redeploy blindly.

## 18. Logging and troubleshooting

JSON lines (`timestamp, level, logger, message, request_id, method, status,
duration_ms`) — no path, query, body, token, DSN or secret. Correlate with
`x-request-id` (echoed as `X-Request-Id`).

| Symptom | Likely cause | Fix |
|---|---|---|
| Exit 1, `Configuration is invalid` | placeholder secret, `DEBUG=true`, wildcard CORS | correct the env value |
| `/ready` 503 `OperationalError` | wrong Neon URL / password | verify dashboard, Neon status |
| 401 on every call | `JWT_*` mismatch with backend | copy exact backend values |
| 404 for a stranger's id | by design (unified 404, never 403) | not a bug |
| `docker stop` hangs, exit 137 | `exec` removed from CMD | restore `exec` (uvicorn = PID 1) |

## 19. Rollback procedure

Render, `message-docker-service`, Deploys, Rollback to the previous good
deploy. Database rollback per section 11. Mobile needs no rollback — the
base-URL contract is unchanged.

## 20. Cost and platform limitations

Free tier: sleeps when idle, ephemeral filesystem (irrelevant — no disk use),
restarts at Render's discretion. Image ~300 MB, one process, no workers —
fits comfortably; scale the plan before adding workers. Keep the default DB
pool (no `--workers` in CMD) unless load testing says otherwise.

## 21. Explicit owner approvals required before deployment

* [ ] Neon `DATABASE_URL` confirmed and stored in Render (never in git).
* [ ] `JWT_*` confirmed byte-identical to `mahaa-backend-docker`.
* [ ] Fresh Neon backup taken; migration and rollback revisions named.
* [ ] Service migration run against Neon from an operator machine + smoke.
* [ ] `EXPO_PUBLIC_MESSAGE_API_BASE_URL` value decided for the mobile release.
* [ ] Owner approves creating the Render service from the Blueprint (apply
  once; manage in the dashboard afterwards).


Live smoke (tokens minted with the local test secret):

```powershell
$base = 'http://127.0.0.1:8011'
curl.exe -s "$base/api/v1/message-requests"   # 401 without token
curl.exe -s -X POST -H 'Content-Type: application/json' `
  -H "Authorization: Bearer <token>" `
  -d '{"recipient_id":"<uuid>","note":"hello"}' "$base/api/v1/message-requests"
# 201 first time, 200 same id while pending; accept/reject 200, re-respond 409
```

Every failure uses the envelope `{"error":{"code":...,"message":...}}`.

## 10. Database migration procedure (local/test)

```powershell
cd C:\mahaa\backend
$env:DATABASE_URL='postgresql+psycopg://msgsvc:msgsvc_local_dev@127.0.0.1:5435/msgsvc_dockertest'
C:\mahaa\backend\.venv\Scripts\python.exe -m alembic upgrade head
cd C:\mahaa\message-service
$env:DATABASE_URL='postgresql+psycopg://msgsvc:msgsvc_local_dev@127.0.0.1:5435/msgsvc_dockertest'
C:\mahaa\backend\.venv\Scripts\python.exe -m alembic upgrade head
```

Migrations never run at startup — always this explicit step, always a
`*_dockertest`-style database, never production.
