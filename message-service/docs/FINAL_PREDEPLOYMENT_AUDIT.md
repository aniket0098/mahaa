# MAHAJOB Message Service — Final Pre-Deployment Audit

Date (UTC): 2026-10-15
Auditor: automated file + limited runtime audit (no deploy, no prod DB, no commit)
Scope: `C:\mahaa\message-service`, `C:\mahaa\render.yaml` (`message-docker-service`), mobile `EXPO_PUBLIC_MESSAGE_API_BASE_URL`, main backend auth contract.

Prior reports (paths verified):
- `message-service/docs/DOCKER_RENDER_DEPLOYMENT.md` — EXISTS
- `message-service/docs/DOCKER_BUILD_REPORT.md` — EXISTS
- `docs/DOCKER_BUILD_REPORT.md` (prompt path) — NOT FOUND; canonical is `message-service/docs/`

Safety: no Render apply, no Neon connection, no prod migration, no git commit/push/reset/clean, no `.env` values printed. Images/containers/volumes untouched.

## 1. Timestamp / Git state

- Branch: `main`, HEAD: `7a6202c` (short)
- Scoped status: `M render.yaml`, `?? message-service/`
- Full worktree is dirty (pre-existing backend/mobile changes + scratch files) — preserved.
- Meaning: Render builds from git. Untracked `message-service/` + uncommitted `render.yaml` cannot build on Render today. Gates deployment alone.

## 2. Verdict: NOT READY

Top 3 blockers:
1. Uncommitted deployment unit (FAIL): `message-service/` untracked, `render.yaml` uncommitted.
2. No genuine backend-token E2E (BLOCKED): file parity yes, live login→verify not executed here.
3. Migration not re-executed + prod state UNKNOWN (BLOCKED/UNKNOWN): linear/additive in files, but no fresh-DB upgrade run in this audit; prod revision/backup/privileges unverified by design.

## 3. Docker readiness

- Context/Dockerfile: PASS — `rootDir: message-service`, `dockerfilePath: Dockerfile`, named COPYs only.
- Deps: PASS — bounded ranges; dev extras excluded from image.
- Bind 0.0.0.0: PASS — `exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}` (confirmed via `docker inspect`).
- $PORT: PASS — `${PORT:-8001}`, `ENV PORT=8001`, healthcheck reads `$PORT`.
- Foreground/signals: PASS (files + prior report `docker stop` exit 0; not re-run here).
- Non-root: PASS — `USER appuser` confirmed in inspect; `EXPOSE 8001`.
- .dockerignore: PASS — `.env`, caches, venvs, `tests/`, `.git`, compose, logs, `_*`, `*.md` excluded.
- Secrets in layers: PASS (files) + reported-not-reproduced (prior `docker history`/container checks clean; re-check truncated by runner).
- Dev tools: PASS — multi-stage, no toolchain, no tests in image.
- Healthcheck: PASS — stdlib probe of `/api/v1/health` (liveness, no DB). `/ready` correctly NOT the probe.
- Images present: `mahajob-message-service:local 303MB`, `:nocache 304MB` — not rebuilt/removed/pushed.
- `/health` = process alive only. `/ready` = `SELECT 1` on *that* DB only. Neither proves auth/migrations/Neon.

## 4. Migration chain

Single migration `0a1b2c3d4e5f` (parent None, base). CREATE TABLE message_requests (uuid pk, created_at timestamptz default now(), sender/recipient FK users.id CASCADE, status default pending, note null, responded_at null, 3 CHECKs) + 2 indexes + partial unique WHERE pending. Additive, no extensions, needs CREATE + REFERENCES. Not repeatable (downgrade drops table). Run AFTER backend users (+ media_assets for avatar read).

- Linear YES, single head YES (`alembic heads` executed), auto-migrate NO (PASS), shared-DB dedicated-ownership PASS, cross-ownership guarded PASS (separate Base, id-only users stub, include_object admits only message_requests).
- Fresh-DB upgrade BLOCKED (not run here; prior dockertest claim not reproduced). Existing-DB upgrade NOT TESTED. Prod revision UNKNOWN.

## 5. DB ownership + Neon readiness

Shared PG (Neon prod); owns message_requests + alembic_version_message_service; reads users/media_assets.served_at read-only. Driver psycopg enforced PASS. Pool pre_ping/recycle/size/overflow PASS. Gap: no connect/statement timeout — FAIL minor. TLS in URL not code — UNKNOWN (confirm sslmode=require). Pooled-vs-direct for DDL — UNKNOWN. Least-privilege — not evidenced.

Preflight: confirm project/db; fresh backup + artifact + restore doc; read-only revision before/after; confirm users/media_assets exist; CREATE+REFERENCES; planned rev 0a1b2c3d4e5f only; record size; rollback = Render rollback + separate approved downgrade.

## 6. Auth compatibility (critical gate) — file parity PASS, live E2E BLOCKED

Backend vs message-service: HS256 pinned + alg never trusted MATCH; JWT_SECRET placeholder+min32+refusal MATCH (values must be byte-identical in dashboard — unverified); iss mahaa-api / aud mahaa-mobile + require exp/iat/sub/iss/aud MATCH; sub=users.id UUID, missing->401 MATCH; exp/iat verified MATCH; type:access minted but never enforced on either side (parity note, revisit if refresh appears); role ignored here by design; access-only/verify-only MATCH; identity mapping columns all exist (User + MediaAsset.served_at verified) MATCH modulo enum-string confirm; env names/defaults MATCH; generic 401 envelope + 403 suspended-only + auto_error=False MATCH (unit-tested).

Live matrix (missing/malformed/expired/wrong-sig/wrong-aud/genuine/cross-user) NOT executed — no local backend instance. Minted-claim tests are not proof. Do not weaken checks.

## 7. Render Blueprint — PASS (files, yaml.safe_load, no apply)

Services [mahaa-backend-docker, message-docker-service]. Message block: web/docker/singapore/free, rootDir message-service, dockerfilePath Dockerfile, healthCheckPath /api/v1/health, PORT 8001, APP_ENV production, DEBUG false, DATABASE_URL/JWT_SECRET/JWT_ISSUER/JWT_AUDIENCE/CORS_ORIGINS sync:false. Correct context, liveness probe (ready NOT used), PORT honored at runtime, fail-closed prod, no secrets in YAML, own start command, backend block additive-only, placeholder host docs-only. Free-plan sleep/ephemeral noted (stateless OK), single process no workers (correct for Free).

## 8. Security + API — PASS except rate limiting ABSENT

All 5 routes CurrentUser token-only; extra=forbid; self 422; unknown recipient 404; list/count recipient-scoped; accept/reject recipient-only with identical 404 (anti-enumeration); malformed id 404; redacted sender summary; note <=500 blank-refused; 64KiB 413; limit 1..100 def 50; envelope 422; CORS exact-only no-creds GET/POST; generic 500; ready leaks class only; config exit-1 field-names-only; JSON logs no secrets + X-Request-Id; idempotent create 200-same-row; re-respond 409; FOR UPDATE + CHECK backstop; race converges via partial index. No WS/push/attachments/voice — correctly disclaimed. Gap: NO rate limiting (backend has auth limiter); 429 undocumented — risk, needs platform/future fix.

## 9. Mobile integration — PASS (files)

Prod var EXPO_PUBLIC_MESSAGE_API_BASE_URL (+_WEB/_LAN), public-only. Base MUST include /api/v1 (client appends /message-requests). Contract/bodies/models mirror server; recipient_id = backend internal id; same bearer via tokenStorage, ownsSession:false so 401 never logs out (correct); same sub UUID; avatar path resolved vs main API; useMessageRequests persistent banners, no optimistic remove, invalidation on success + 409; null base -> clear notice; local derivation :8000->:8001 loopback/emulator/LAN only, public->null (no prod guessing); no hardcoded prod URL. Later smoke: set URL only after host confirmed; two-account list/count/create/accept/reject + 401/404/409.

## 10. Validation executed

Executed: git state; report existence; yaml parse; docker inspect; ruff (passed); alembic heads (single). NOT TESTED/BLOCKED here: history verbose full output, full pytest (runner pipe hangs; prior 61-passed historical), live container health/ready/auth, mobile typecheck (would disturb tree). No prod/deploys/commits/deletions/secrets.

## 11. Blockers/risks + future order (DOCUMENT ONLY)

Blockers: uncommitted unit; no genuine-token E2E; migration unreproduced + prod UNKNOWN; Neon TLS/pool/direct UNKNOWN. Risks: no rate limit; no timeouts; type never enforced; free-plan sleep; local .env must never commit (check-ignore before any add).

Future order: clear blockers -> approve diff/commit/push SHA -> fresh backup+restore doc -> approve migration -> run + read-only verify revision -> approve Render create/apply -> dashboard secrets -> deploy -> health/ready -> genuine-token auth -> two-account messaging/authz/errors -> set mobile URL -> final mobile checks + logs. Rollback binary via Render; schema downgrade separate approved data step. Exact commands in DOCKER_RENDER_DEPLOYMENT.md sections 10/17/19/21 (do not execute here).
