# Message service - deployment reference

This service is **REST-only** (no WebSocket, no Redis) and owns exactly one
domain: **message requests** (`/api/v1/message-requests`) plus health/readiness.
It shares the main backend's PostgreSQL database and verifies the main backend's
JWT. It is a small, stateless HTTP service, which makes it straightforward to
host on any container platform.

> **Status.** This document describes a service that has been **built, run and
> tested locally in Docker**, but **not deployed**. Every item marked
> "tested locally" was verified in this repository; items marked
> "needs a host" require a hosting provider and a real environment.

---

## 1. Runtime and container port

| Item | Value | Status |
| --- | --- | --- |
| Runtime | Python 3.12 (Debian slim base `python:3.12-slim`) | tested locally |
| Server | uvicorn, ASGI app `app.main:app` | tested locally |
| Listens on | `0.0.0.0:${PORT}` - default `8001` | tested locally |
| Container port | `8001` (the image binds `0.0.0.0:8001`) | tested locally |
| Published host port | `MESSAGE_SERVICE_PORT` (default `8001`) | tested locally |

`PORT` is honoured by the startup command (`${PORT:-8001}`), so the
platform-injected port is respected without a code change.

## 2. Build context and command

Build context is the `message-service/` directory (it has its own `Dockerfile`,
`.dockerignore` and `requirements.txt`).

```bash
# from message-service/
docker build -t message-docker-service:local .
```

The build is **multi-stage** (`builder` compiles wheels, `runtime` copies them),
installs **production dependencies only** (`requirements.txt` - the test extras
in `requirements-dev.txt` are deliberately absent from the image), and runs as a
**non-root** user (`appuser`, uid 999). tested locally

## 3. Container startup command

The image default command starts uvicorn on `0.0.0.0:${PORT}` and handles
SIGTERM/SIGINT for graceful shutdown (uvicorn default signal handling). There is
no separate start script. tested locally

```bash
docker run --rm -p 8001:8001 --env-file .env message-docker-service:local
```

## 4. Required environment variables (names)

Set these in the platform secret store. See `.env.example` for annotated,
non-secret examples.

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL DSN (`postgresql+psycopg://...`), reachable from the container. |
| `JWT_SECRET` | yes | Shared HMAC secret; must match the main backend. >=32 chars in production. |
| `JWT_ALGORITHM` | yes | `HS256` (pinned; other values refused). |
| `JWT_ISSUER` | yes | Token issuer to enforce (`mahaa-api`). |
| `JWT_AUDIENCE` | yes | Token audience to enforce (`mahaa-mobile`). |
| `APP_ENV` | yes | `production` for a live deploy. |
| `DEBUG` | yes | `false` in production. |
| `PORT` | no | Injected by the platform; defaults to `8001`. |
| `CORS_ORIGINS` | no | Exact browser origins, comma separated. Empty for mobile-only. |
| `LOG_LEVEL` | no | `DEBUG`/`INFO`/...; defaults from `DEBUG` when unset. |
| `MAX_BODY_BYTES` | no | Request body cap in bytes; default `65536`. |

**Never** commit real values. Production settings live only in the host.

## 5. Health and readiness paths

| Path | Purpose | Success | Failure |
| --- | --- | --- | --- |
| `/api/v1/health` | **Liveness** - process is up; touches nothing. | `200 {"status":"ok",...}` | always 200 while the process runs |
| `/api/v1/ready` | **Readiness** - can serve; checks the DB. | `200 {"status":"ready","checks":{"database":"ok"}}` | `503 {"status":"not_ready","checks":{"database":"<ExceptionClass>"}}` |

Both return consistent JSON. `/ready` reports only an exception **class name**
(never a DSN or driver message). Neither endpoint mutates the schema. Configure
the platform health probe against `/api/v1/health`. tested locally

## 6. Dependencies

| Dependency | Needed? | Notes |
| --- | --- | --- |
| PostgreSQL | **yes** | Shared with the main backend. This service owns only `message_requests`, but that table FKs reference the backend `users`. |
| Redis | **no** | There is no WebSocket/event fan-out here; Redis is intentionally absent. |
| Object storage | **no** | No attachments in this domain. |

## 7. Database and migrations

- This service **shares** the main backend database and owns one table.
- Migrations are **Alembic** (`message-service/alembic`). The container does
  **not** migrate on startup - schema changes are a separate, explicit step.
- Migration command (run from `message-service/` with `DATABASE_URL` set):

  ```bash
  alembic upgrade head
  ```

- A **fresh** database needs the backend migrations first (they create `users`),
  then this service migration (creates `message_requests`).
- The pool is tuned for hosted Postgres (`pool_pre_ping`, `pool_recycle=1800`,
  `pool_size=5`, `max_overflow=5`). Credentials and full DSNs are never logged.
  needs a host - migration order and connectivity verified only locally.

## 8. Authentication

- Identity is derived from the **validated JWT** in the `Authorization: Bearer`
  header - never from a body or path field.
- The token is verified against the shared `JWT_SECRET`, with a pinned algorithm
  and enforced `iss`/`aud`, and the `sub` claim must name an existing,
  non-suspended user.
- Failure is always one generic `401` (or `403` for a known-but-forbidden user)
  in the error envelope the mobile client parses. tested locally

## 9. WebSocket support

**None.** This service is REST-only by design (matching the main backend Phase
7.2 decision). No WebSocket route, no persistent-connection requirement, so it
deploys cleanly on a plain HTTP/HTTPS host. needs a host - n/a locally.

## 10. TLS, HTTPS and origins

- TLS terminates at the platform/reverse proxy; the container serves plain HTTP
  on `0.0.0.0:${PORT}`. needs a host.
- The mobile app sends no `Origin` header, so `CORS_ORIGINS` may be empty. If a
  browser client is ever added, list its **exact** origins; a wildcard is
  refused in production. CORS is not authentication and is not relied on as such.

## 11. Persistent storage

**None required.** The service is stateless; all state is in the shared
PostgreSQL database. The local Compose stack uses a named volume for the
throwaway dev database only (removed with `docker compose down -v`).

## 12. Logging and monitoring

- Logs are JSON on **stdout/stderr**, ready for platform log ingestion.
  tested locally
- Each log line carries a correlation `request_id` (also returned as
  `X-Request-Id`), so a client report maps to a log line.
- Logs never contain passwords, tokens, message contents, or DSNs.
- Recommended: probe `/api/v1/health` for uptime, `/api/v1/ready` for dependency
  health, and alert on repeated `not_ready`.

## 13. Graceful shutdown

The process handles SIGTERM/SIGINT (uvicorn default): it stops accepting new
connections and finishes in-flight requests before exiting. tested locally

## 14. Verify a deployment safely

```bash
curl -fsS https://<host>/api/v1/health                 # 200 {"status":"ok"}
curl -fsS https://<host>/api/v1/ready                  # 200 {"status":"ready"}
curl -i https://<host>/api/v1/message-requests/count   # 401 without a token
```

A green `/ready` plus a `401` on the protected route (no token) is the minimum
healthy signal. Do **not** test with a real user or send real messages.

## 15. Rollback

Because the migration is additive (one new table), a rollback is:

1. Redeploy the **previous image tag** (same env vars) - instant, no DB change.
2. Optionally `alembic downgrade` if the schema change must be reverted - this is
   a data-affecting step and must be a separate, approved operation. A plain app
   rollback never requires it.

---

## Hosting assessment

Render (where the main API runs) remains a **suitable** host: the service is a
stateless REST API with no WebSocket or persistent-connection needs, so it does
not require anything Render cannot provide. Any container host that offers
managed Postgres, an injected `PORT`, a health probe, and TLS will work. No host
has been provisioned or contacted - this is documentation only.