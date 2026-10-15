# FINAL HARDENING REPORT — message service
Date UTC 2026-10-15. Read-only + safe non-write evidence only.
No deploy/Blueprint/commit/push/stage/Neon/prod writes/secrets/deletions.
Verified-here = observed this phase. Previously-reported = prior docs.
Unverified = marked unknown.

## 1. Exact test totals (verified here)

Setup: conftest uses TEST_DATABASE_URL else DATABASE_URL, local-host guard
only, no schema mutation, skips honestly with no DB. Both DB env vars absent
(Test-Path False/False), so no DB run attempted without approval.
Prior isolated DB container/msgsvc_verify/msgsvc_verify2 = previously
reported only, not touched here.

Safe runs in C:/mahaa/message-service with backend venv, no env changes:
- ruff check . => exit 0, All checks passed (x2, incl concise).
- pytest --collect-only -q -p no:warnings => exit 0, 61 total:
  auth 7, config 24, health 4, message_requests 20, guards 6.
- pytest -q -p no:warnings -rf => exit 0, 39 passed, 22 skipped, 0 failed.
- pytest -p no:warnings -rf --tb=short to TEMP msgsvc-pytest-final.txt
  => exit 0, 39 passed, 22 skipped in 5.41s.
- pytest -p no:warnings -rs => same 39/22, all skips = honest no-local-DB.
Warnings not counted (-p no:warnings); inventory open.
Full 61-passed DB run NOT reproduced here (needs container + DB writes).
Do not claim 61 passed on current evidence.
## 2. Rate limiting: ABSENT (verified by file read)

Checked main.py, router, endpoints, deps, config, requirements, guards.
No limiter lib, no middleware, no 429/Retry-After, no XFF/proxy trust.
Guards only: 64KiB 413, 422 validation, limit 1..100, note <=500.
Unthrottled authed: GET list, GET count, POST create, POST accept/reject.
Health/ready also unthrottled (liveness must stay open).
No scope exists; in-memory would be per-process and unsafe multi-instance.
Never trust arbitrary XFF; no workaround added; Render edge unverified.
Proposal (no code changed): POST create strictest (~30/min/user + IP burst),
accept/reject ~60/min/user, GETs generous ~300/min/user, health none.
Shared store or edge, key on sub UUID, 429 in envelope + Retry-After,
document 429, add isolation/persistence tests after approval.
## 3. DB timeouts/pooling (verified by file read)

Engine: pool_pre_ping True, recycle 1800, size 5, overflow 5 (same as
backend). Absent: connect_timeout, pool_timeout, statement_timeout,
idle/txn timeouts, sslmode enforcement. Migrations use NullPool (good).
psycopg v3 via postgresql+psycopg. /ready SELECT 1 has no timeout; pool
exhaustion default 30s slow 500. Up to 10 conns per process; x workers or
instances multiplies vs Neon pooled limit. .env.example says pooled Neon
for prod app traffic; pooled-vs-direct for app vs migrations and pooler
mode (txn/session) NOT pinned = doc gap. TLS not enforced in code; Neon
strings not inspected (forbidden) = unknown. create() idempotent
(SELECT pending, INSERT, IntegrityError=>SELECT winner) safe retry; no
auto-retry wrapper. respond() FOR UPDATE + single commit, retry => 409 not
dup, but generic retry without idempotency keys could confuse.
Proposal (no change): connect_timeout 5, pool_timeout 10,
statement_timeout 10s, TLS require/assert, doc pooled-app vs direct-migrate
+ mode + single-process sizing, fast-fail tests after approval.
## 4. Render config (verified file read)

render.yaml: backend block untouched + message-docker-service added (~72
lines). web/docker/singapore/free, rootDir message-service, Dockerfile,
healthCheck /api/v1/health (liveness, no DB; /ready NOT probe = correct),
PORT 8001, APP_ENV production, DEBUG false, DATABASE_URL/JWT_*/CORS sync
false (no secrets in YAML). Dockerfile: context message-service, named
COPYs, appuser, exec uvicorn PORT, stdlib healthcheck. dockerignore drops
env/caches/venvs/tests/git/compose/logs/_*/md (keeps README). Free sleep
+ ephemeral noted (stateless OK), single process no workers (correct).
File-level PASS; NOT applied; cannot build remote until section 5 done.

## 5. Git inventory (verified git commands)

ls-files message-service = empty (fully untracked). status scoped =
M render.yaml + 36x ?? under message-service/ (list below). diff render =
additive message block only. check-ignore: .env ignored, .env.example not.
On-disk ignored: .env, pycache, pytest/ruff caches. Root scratch out of
scope, preserved untouched.

Required build/run:
Dockerfile, .dockerignore, requirements.txt, pyproject.toml, alembic.ini,
alembic/env.py, alembic/script.py.mako, app/__init__.py, app/main.py,
app/api/__init__.py, app/api/deps.py, app/api/v1/__init__.py,
app/api/v1/router.py, endpoints/__init__.py, endpoints/health.py,
endpoints/message_requests.py, core/__init__.py, core/config.py,
core/errors.py, core/logging.py, db/__init__.py, db/base.py,
db/dependencies.py, db/session.py, models/__init__.py,
models/message_request.py, schemas/__init__.py, schemas/message_requests.py,
services/__init__.py, services/identity.py, services/message_requests.py,
.env.example, .gitignore, README.md, render.yaml (modified).

Migrations/tests: alembic/versions/0a1b2c3d4e5f_message_requests.py,
tests/conftest.py, test_auth/config/health/message_requests/request_guards,
requirements-dev.txt, docker-compose.yml.

Docs: DEPLOYMENT.md, docs/DOCKER_RENDER_DEPLOYMENT.md,
docs/DOCKER_BUILD_REPORT.md, docs/LOCAL_INTEGRATION_VERIFICATION_REPORT.md,
docs/FINAL_PREDEPLOYMENT_AUDIT.md, docs/FINAL_HARDENING_REPORT.md (this).

Local-only, never publish: .env, pycache/pyc, pytest/ruff caches,
venv, *.log, _*, .env.bak*, compose overrides, .vscode/.idea/.DS_Store.
No dumps/creds/token files in message-service. No git add -A; use explicit
paths above for human review. Render cannot build until published.
## 6. Neon preflight (NOT executed, operator later)

1 Confirm Neon project/database names (no creds). 2 Confirm shared DB,
owns only message_requests + alembic_version_message_service. 3 Pooled for
app traffic, direct for alembic; record hosts + pooler mode. 4 Verify
sslmode=require/TLS both endpoints. 5 Privileges: CONNECT/CREATE/
REFERENCES/SELECT read users+media_assets, no superuser, no outside DDL.
6 Read-only SELECT both alembic versions; do not assume 0a1b2c3d4e5f.
7 Extensions expected none; check users/media_assets/message_requests.
8 Fresh backup outside repo. 9 Verify backup usable (no prod restore test).
10 Review pending sequence (history + offline --sql, only owned table).
11 Recovery plan: binary rollback (no DB) vs downgrade drops table (data
loss, separate approval). 12 Schedule approved migration + ready/smoke.

## 7. Blockers

Critical: (1) unpublished unit (untracked + uncommitted); (2) no current
full-DB evidence (39/22 here, prior 61 not reproduced); (3) Neon state
unknown by design; (4) no rate limits; (5) no DB timeouts/TLS pin.
Non-critical: warnings inventory, full render diff re-review, free sleep,
type:access unenforced note, mobile smoke pending.

## 8. Proposed fixes needing approval (none applied)

A Fresh isolated full-DB rerun (new container+volume, loopback, throwaway
DBs, backend-then-service upgrades, genuine-token matrix, pytest capture,
remove only test container). B Rate limits per section 2 + tests.
C Timeouts/TLS/endpoint docs per section 3 + tests. D Human path-list
review then separate add/commit/push/apply decisions.

## 9. Recommendation: NOT READY

Safe local evidence green (ruff 0; pytest 39/22 exit 0 no-DB; file-level
Render/Docker/auth/shape pass) but 5 critical blockers remain. Do not
deploy/apply/migrate/publish until approvals + blockers cleared.
