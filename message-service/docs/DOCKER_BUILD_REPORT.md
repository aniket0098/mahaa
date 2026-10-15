# Message service — Docker build report

Date: 2026-10-14. Image: `mahajob-message-service:local` (303 MB, amd64,
`python:3.12-slim` multi-stage). Local only — never pushed, never deployed.
No commit, no push, no production migration, no production data touched.

## A. Initial state

* Repo `C:\mahaa`, branch `main`, untouched user work preserved throughout.
  `message-service/` is untracked in git (new addition, not yet committed);
  the only tracked-file change from this task is the additive
  `message-docker-service` block in root `render.yaml` (+72 lines, backend
  block untouched). Pre-existing modifications elsewhere were not touched.
* Existing Docker setup (kept, verified, not replaced): multi-stage
  `Dockerfile` (non-root `appuser`, Python healthcheck, `exec` CMD),
  `.dockerignore` (excludes `.env`, `.git`, caches, tests, logs, scratch),
  `docker-compose.yml` (`db` postgres:16 on 127.0.0.1:5435 + `app` on 8001 +
  manual `migrate` profile). No destructive git commands used; local `.env`
  and all volumes preserved.
* Service architecture (traced, not assumed): FastAPI + uvicorn, entry
  `app.main:app`. Five routes on `/api/v1/message-requests` (list, count,
  create, accept, reject) + liveness `/api/v1/health` + readiness
  `/api/v1/ready`. REST only — no WebSocket/Redis/attachments/workers (those
  live in the main backend). Shares the backend's PostgreSQL; owns ONLY
  `message_requests` (FK to `users`), own Alembic version table, never
  migrates at startup. Verify-only JWT sharing the backend's key/issuer/
  audience. Env: `APP_ENV, DEBUG, PORT, DATABASE_URL, JWT_SECRET,
  JWT_ALGORITHM, JWT_ISSUER, JWT_AUDIENCE, CORS_ORIGINS, LOG_LEVEL,
  MAX_BODY_BYTES`; fail-closed in production. `.env.example` placeholders only.

## B. Docker artifacts

* Created: `docs/DOCKER_RENDER_DEPLOYMENT.md` (21 sections), this report.
* Updated: root `render.yaml` (+72 additive lines — `message-docker-service`
  block; see section F).
* Kept as-is (already satisfied every requirement): `Dockerfile`,
  `.dockerignore`, `docker-compose.yml`, `requirements.txt` (bounded ranges
  per project convention — no lockfile imposed), `.env.example`.
* Image: `mahajob-message-service:local`, 303 MB, amd64. User `appuser`,
  CMD `sh -c "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"`,
  healthcheck on `/api/v1/health` via `$PORT`, `EXPOSE 8001`, `ENV PORT=8001`.
* Build: `docker build -t mahajob-message-service:local .` from
  `C:\mahaa\message-service`, exit 0, no warnings, reproducible from a clean
  checkout (context-local files only).

## C. Runtime verification

Test DB `msgsvc_dockertest` created on the local Compose postgres
(127.0.0.1:5435); backend migrations then service migration applied from the
host; 4 dedicated test users seeded (dummy hashes). All writes local/test.

* Container starts, binds `0.0.0.0:8001`; throwaway ports 8011/8012/8013/8014
  verified (8001 = Compose app, 8000 = root API — never disturbed).
* `/api/v1/health` 200 `{"status":"ok",...}`; `/api/v1/ready` 200
  `{"status":"ready","checks":{"database":"ok"}}`; `/` 200 (misconfigured-URL
  hint, not 404).
* Wrong DB password: `/ready` 503 `not_ready`, `/health` still 200;
  protected route fails safe (generic 500 envelope, no leak).
* `APP_ENV=production` + placeholder secret: exits 1 with field-names-only
  JSON error (fail-closed, secret-free logs).
* Logs clean JSON with `request_id`; scanned for DSN/secret/password — clean.
  `docker history` secret scan — clean. `/app/.env` absent in container.
* `docker stop` → exit 0 (graceful, `exec` → uvicorn PID 1). Fresh container
  starts with no host files. Runs as `appuser` (uid 999).

## D. Messaging verification

* Suite: `pytest tests -q` → **61 passed** (`TEST_DATABASE_URL` → local test
  DB); `ruff check app tests` → clean. Per-file: test_auth 7, test_config 24,
  test_health 4, test_message_requests 20, test_request_guards 6.
* Live container flow (ports 8011/8012, real HTTP, dedicated accounts):
  no/garbage/wrong-secret/wrong-audience/expired token → 401; suspended user
  absent here (service has no status gate — governed by backend); empty list
  200 `items:[]`; create → 201 server-issued id; duplicate while pending →
  200 same id; recipient list/count correct; stranger count 0 (privacy);
  foreign/sender accept → 404 (unified, never 403); recipient accept → 200
  `accepted`; re-accept → 409; reject → 200 `rejected`; re-reject and
  accept-after-reject → 409; self-request → 422; unknown recipient → 404;
  2000-char note → 422 (limit 500); oversized body → 413 envelope.
* Not applicable by design (service is REST-only): text send/receive history,
  attachments/images/video, WebSocket, read receipts/unread badges beyond the
## E. Security

* Secret exclusion: no `.env`/secret in build context, layers (`docker
  history` scanned), container filesystem, logs, or error responses. All
  secrets arrive as run-time env vars; `render.yaml` uses `sync: false`.
* `.dockerignore` review: excludes `.env*`, `.git/`, caches, venvs, `tests/`,
  Compose files, logs, scratch (`_*`); keeps app code, migrations, manifests.
  `.gitignore` agrees on secrets plus local overrides. Both preserved.
* AuthN/Z enforced live: 401 variants, unified 404 (no existence leak), 409
  state machine, 422 guards, 413 body bound, generic 500 envelope.
* Storage: no persistent container-local data; no disk/object writes at all
  (attachment-free service). Volume `msgsvc_pgdata` holds local rows only.
* Production image runs non-root, binds `$PORT`, fails closed on bad config.

## F. Render readiness

* `Dockerfile` path: `message-service/Dockerfile`; build context:
  `message-service/` (`rootDir: message-service` — nothing outside is copied).
* New `message-docker-service` block in root `render.yaml`: `runtime: docker`,
  `region: singapore`, `plan: free`, `healthCheckPath: /api/v1/health`,
  `PORT: "8001"` / `APP_ENV: production` / `DEBUG: "false"` committed,
  `DATABASE_URL`, `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `CORS_ORIGINS`
  as `sync: false`. Backend block untouched. No secret in file.
* Remaining manual setup (owner): Neon `DATABASE_URL` + exact backend `JWT_*`
  in dashboard; run service Alembic `upgrade head` against Neon from an
  operator machine (backup first, approval recorded); set
  `EXPO_PUBLIC_MESSAGE_API_BASE_URL=https://<real-host>/api/v1` for mobile;
  apply the Blueprint once (then manage in dashboard). Nothing created,
  pushed, or deployed in this task.

## G. Failures and blockers

1. PowerShell `curl.exe --data '@file'` + inline JSON quoting broke twice
   (parser error, then 422 on a wrong field guess). Root cause: shell quoting
   and guessing the schema. Fix: read the real schema (`note`, ≤500 chars),
   write bodies with `Set-Content`. No app impact.
2. Mint-script argv confusion produced empty tokens once. Root cause: test
   harness args, not the service (all 401s real). Fix: positional discipline
   + length/part-count check. No app impact.
3. `pytest`/`ruff` appeared to hang under the runner pipe; logs showed `ruff`
   clean and `pytest` 61 passed. Root cause: output buffering through
   `Select-Object`, not the tools. Evidence re-collected directly.
4. BLOCKED: live sign-in against a real main-backend instance (none running
   locally with the test users). Covered instead by claim-identical minted
   tokens + shared-secret contract tests.
5. Out of scope by design: WebSocket/attachments/voice (not implemented in
   this service), production migration (explicitly forbidden), Render service
   creation (explicitly forbidden).

## H. Final status

| Requirement | Status |
|---|---|
| Production Dockerfile (pinned 3.12, multi-stage, non-root, `$PORT`, healthcheck, graceful) | PASS |
| Strict `.dockerignore` (secrets/caches/tests excluded, code kept) | PASS |
| Reproducible deps (bounded ranges per convention, clean container install) | PASS |
| Config/secrets (fail-closed, placeholders documented, none baked) | PASS |
| DB/storage compat (own table only, explicit migrations, no disk persistence) | PASS |
| Health/observability (liveness/readiness split, safe logs/errors, shutdown) | PASS |
| Local Compose (isolated DB, DNS names, manual migrate, healthy) | PASS |
| Image build (exit 0, 303 MB, recorded, no push) | PASS |
| Local run (bind, health/ready, failure modes, shutdown, non-root) | PASS |
| API + suite (61 passed, live auth/flow/privacy/state-machine) | PASS |
| Render prep (additive Blueprint, no secrets, docs) | PASS |
| Production image requirements (section 14 checklist) | PASS |
| Docs (deployment guide 21 sections + this report) | PASS |
| No deploy/commit/push/prod-migration; user work preserved | PASS |
| Live main-backend sign-in end-to-end | BLOCKED (no local instance; contract-tested) |
| WebSocket/attachments/voice in this service | NOT TESTED (not implemented by design) |

## I. Next steps

```powershell
# 1. Rebuild any time from a clean checkout:
cd C:\mahaa\message-service
docker build -t mahajob-message-service:local .
# 2. Migrate Neon (operator machine, AFTER backup + written approval):
$env:DATABASE_URL='<Neon URL>'
C:\mahaa\backend\.venv\Scripts\python.exe -m alembic upgrade head
# 3. Render dashboard → apply Blueprint (once) → message-docker-service →
#    Environment: DATABASE_URL, JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE,
#    CORS_ORIGINS (sync: false values) → Deploy.
# 4. Smoke: /api/v1/health 200, /api/v1/ready 200, authed /count 200,
#    unauthed /message-requests 401.
# 5. Mobile release env:
#    EXPO_PUBLIC_MESSAGE_API_BASE_URL=https://<real-host>/api/v1
# 6. Rollback: Render Deploys → Rollback; DB per deployment-guide section 11.
```

  `pending` count, voice/calling. Main-backend auth instance unavailable
  locally — cross-service token path covered by shared-claim tests + identical
  issuer/audience/secret contract, live backend sign-in marked BLOCKED.
