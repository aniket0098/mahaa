# MAHAJOB — RENDER RELEASE READINESS REPORT — Message Service

Date (UTC): 2026-10-15
Author: repository review + minimal fixes performed in act mode on owner approval.
Scope: review of the current working tree against the Render release requirements for
`message-docker-service`, one minimal staging-hygiene fix, and exact operator runbooks
for database, Render, and mobile integration.

Safety attestation: this run did **not** commit, push, deploy, connect to Neon or any
production database, run any migration, edit any `.env` file, create/delete/reset any
database, container or volume, or print any secret, token, DSN or password value.
Every variable below is named, never valued.

Status legend (used consistently):

- **PASS** — verified in this run against the current files.
- **FAIL** — verified broken in this run (with a fix, or named as remaining).
- **BLOCKED** — cannot be completed here; requires an approval step (Section 10).
- **NOT TESTED** — deliberately not executed in this run; reason stated.

## 0. Verdict

| Question | Answer |
|---|---|
| Service code/config ready for the release step (commit → push → Render)? | **PASS** |
| Release unit present in Git so Render can build it? | **BLOCKED** — `message-service/` untracked, `render.yaml` uncommitted (Section 2.1) |
| Staging safe against secrets/venv/scratch entering the commit? | **PASS after fix** (Section 2.2) |
| Any running service, database or production touched? | **No** |
| Shortest safe next sequence? | Section 11 |

## 1. Verified deployment prerequisites (this run, current files)

| # | Prerequisite | Verdict | Evidence in this run |
|---|---|---|---|
| 1.1 | Render service uses correct `rootDir`, Dockerfile, health path, `$PORT` | **PASS** | `render.yaml` message block: `rootDir: message-service`, `dockerfilePath: Dockerfile`, `healthCheckPath: /api/v1/health`, `PORT: "8001"`, `APP_ENV: production`, `DEBUG: "false"`. `message-service/Dockerfile`: multi-stage (`python:3.12-slim`), non-root `appuser`, named `COPY app/ alembic/ alembic.ini pyproject.toml requirements.txt`, `CMD ["sh","-c","exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]`, HEALTHCHECK probes `/api/v1/health` on `$PORT` in plain Python. |
| 1.2 | Message-service files will be in the intended Git release | **FAIL → BLOCKED** | `git status` shows the entire `message-service/` tree as untracked and `render.yaml` as modified-unstaged; Render builds from the pushed branch, so nothing exists to build until Section 2.1 is approved. |
| 1.3 | Root `render.yaml` change is additive only | **PASS** | `git diff render.yaml` = **72 insertions, 0 deletions**; only the `message-docker-service` block is added; the `mahaa-backend-docker` block (rootDir `backend`, health `/api/v1/health`, `DATABASE_URL` `sync: false`) is untouched. |
| 1.4 | All production env vars identified by name, no values | **PASS** | Section 5. Both `app/core/config.py` files are fail-closed in production (placeholder `DATABASE_URL`, placeholder/short `JWT_SECRET`, `DEBUG=true`, wildcard CORS, empty issuer/audience → exit 1 with **field names only**). |
| 1.5 | JWT compatibility with real backend-issued tokens | **PASS** | Backend `app/services/tokens.py` mints `sub, role, public_id, type, jti, iat, exp, iss, aud`, algorithm pinned from config (`HS256` default), defaults `iss=mahaa-api`, `aud=mahaa-mobile`, 60-minute expiry. Message service `app/api/deps.py::decode_access_token` verifies with `algorithms=[settings.jwt_algorithm]` (incoming `alg` never trusted), `issuer`, `audience`, `options.require=[exp, iat, sub, iss, aud]`, `sub` must be a UUID of an existing, non-suspended user; generic 401, 403 only for suspended. Live compatibility was proven by the 25/25 genuine-token matrix (Section 4). |

| 1.6 | Production DB URL / SSL / pooling documented without credentials | **PASS** | Both configs normalise `postgresql://` → `postgresql+psycopg://` (psycopg3). `message-service/app/db/session.py`: `pool_pre_ping=True`, `pool_recycle=1800`, `pool_size=5`, `max_overflow=5`. TLS and pooled-vs-direct come from the operator-supplied Neon URL (`sslmode=require` documented in the hardening/audit docs); no value is stored in any file. |
| 1.7 | Migration runs safely against the intended production schema | **PASS (files) / NOT TESTED (live)** | `message-service/alembic/versions/0a1b2c3d4e5f_message_requests.py`: single head, `down_revision = None`, own version table `alembic_version_message_service` (ini + `alembic/env.py` re-assert), creates only `message_requests` with FK→`users.id`, 2 indexes + 1 partial unique; downgrade drops exactly this table. Backend chain verified on disk: `… → b7d2f8c41a93 → c1a2b3d4e5f6`. Applying it to production is an operator step (Section 6) — **NOT TESTED** here by design. |
| 1.8 | Mobile reads the message-service URL from config, correct `/api/v1` base | **PASS** | `src/lib/env.ts` → `src/lib/messageApiBaseUrl.ts`: explicit `EXPO_PUBLIC_MESSAGE_API_BASE_URL` wins (platform-scoped `_WEB`/`_LAN`), else port-8001 derivation for local-dev hosts only, else `null` → `src/api/messageRequests.ts` throws a clear configuration error (never a doomed request). `ApiClient.request` does `${baseUrl}${path}`, so the value **must include `/api/v1`**. No hardcoded production URL anywhere. |
| 1.9 | No unsupported capability claims | **PASS** | `README.md`, `DEPLOYMENT.md`, `docs/DOCKER_RENDER_DEPLOYMENT.md` consistently scope this service to 5 REST routes on `/api/v1/message-requests` + health/ready; conversations/messages remain the main backend's `/conversations`/`/messages`; no WebSocket, attachments, voice or calls exist or are claimed here. |
| 1.10a | Rate limiting assessed | **Not a release blocker** | Service is bearer-JWT-gated, 5 small routes, 64 KiB body cap, partial-unique index bounds pending duplicates; the main backend keeps its own limiter. Smallest safe follow-up: platform-level rate limiting (or a tiny middleware) in a later phase — deliberately not implemented now. |
| 1.10b | DB connect/statement timeouts assessed | **Not a release blocker** | `pool_pre_ping` prevents stale-connection 500s; `/api/v1/ready` exposes DB outages without failing liveness; the mobile client aborts at 15 s; production boot is fail-closed on configuration. Smallest safe follow-up (recommended later, not now): add `connect_args={"connect_timeout": …}` (and a statement timeout) to `message-service/app/db/session.py` with a targeted test — deferred to avoid touching code covered by the already-passing suite. |

## 2. Confirmed blockers and minimal fixes

### 2.1 BLOCKED — the release unit is not in Git (owner action required)

- `message-service/` is entirely untracked; `render.yaml` is modified but uncommitted.
  Render's Blueprint builds from the pushed branch, so the service cannot build or
  deploy in this state.
- The fix is a stage + commit + push, which is explicitly outside this run's authority.
  Exact commands: Section 7 step 2; the path list is in Section 9.
- Status: **BLOCKED** pending approval item 1 (Section 10).

### 2.2 FIXED — staging hygiene (a naive release commit would have staged secrets/venv/scratch)

- Observed: `backend/.gitignore` exists but is **empty** in the working tree (its
  HEAD content — the Python ignore rules — was removed). With it empty, `backend/.venv/`,
  every `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`, and dozens of scratch files
  (`_test_db_url.txt`, `_p6_secret.py` — a script that reads env secrets — `_p19_*.diff`,
  UI dumps, etc.) were **not ignored** and would enter a `git add -A`.
- Fix (additive only, nothing deleted): extended root `.gitignore` with the block
  starting at line 126 — Python/venv/cache patterns, named root scratch patterns,
  `/backend/_*`, `/docs/p22_*`, `/docs/phase26-evidence/`, `/.vscode/`.
  `backend/.gitignore` itself was left untouched, preserving the worktree exactly.
- Verification (exact results): Section 4.
- Status: **PASS after fix**.

### 2.3 NOT release blockers — rate limiting and DB connection timeouts

See 1.10a/1.10b. Neither prevents a safe initial Render deployment; both are recorded
as post-deploy hardening with the smallest proposed change named. No code was changed.

## 3. Files changed in this run

| File | Change | Why |
|---|---|---|
| `C:\mahaa\.gitignore` | Modified — **additive block only** appended after `/android` (block header "Release staging hygiene", rules `__pycache__/`, `*.py[cod]`, `*.egg-info/`, `.venv/`, `venv/`, `.pytest_cache/`, `.ruff_cache/`, `.mypy_cache/`, `/.tsc_out.txt`, `/apk-probe-bundle.js`, `/metro.log`, `/mt.txt`, `/exp.txt`, `/*.stackdump`, `/_injector`, `/_p*.diff`, `/_p*.ps1`, `/_p*.py`, `/_phase25_plan.md`, `/_run_*.bat`, `/_uinput_inject.c`, `/ui*.xml`, `/ui*.txt`, `/uih*.xml`, `/.vscode/`, `/backend/_*`, `/docs/p22_*`, `/docs/phase26-evidence/`) | Because `backend/.gitignore` was emptied in the worktree, the venv, caches and scratch files were unignored; a release `git add` would have staged them (Section 2.2). Unanchored Python patterns protect every tree; every scratch pattern is root-anchored or name-exact so it cannot reach real source files. Nothing existing was removed. |
| `C:\mahaa\message-service\docs\RENDER_RELEASE_READINESS_REPORT.md` | Created (this file) | Required deliverable of this run. |

No other file was created, modified, moved or deleted. No Python or TypeScript source,
no `.env`, no `render.yaml`, no `backend/` file was touched.

## 4. Targeted tests and exact results

Tests re-run this run: **none were required** — the only changed files are one
`.gitignore` and one Markdown report; neither is imported by any suite nor covered by
lint. (Rule applied: targeted tests/lint only for changed files.)

Verification executed instead, exact results:

| Check | Result |
|---|---|
| `git check-ignore -v` on 20 must-ignore paths (`.env`, `message-service/.env`, `backend/.venv/`, `backend/__pycache__/`, `backend/_test_db_url.txt`, `_p19_client.diff`, `_p6_secret.py`, `_p20_seed.ps1`, `apk-probe-bundle.js`, `.tsc_out.txt`, `message-service/.pytest_cache/`, `.vscode/launch.json`, `docs/p22_app.png`, `metro.log`, `mt.txt`, `exp.txt`, `_injector`, `_run_bt.bat`, `uih.xml`, …) | **PASS** — every path matched a printed rule |
| `git check-ignore` on must-stage paths (`render.yaml`, `message-service/Dockerfile`, `message-service/app/main.py`, `message-service/alembic/versions/0a1b2c3d4e5f_message_requests.py`, `message-service/docs/DOCKER_RENDER_DEPLOYMENT.md`, `src/lib/messageApiBaseUrl.ts`, `.env.example`) | **PASS** — no matches (committable); exit 1 |
| `message-service/.env.example` | **PASS** — committable via the `!.env.example` negation; `message-service/.env` **excluded** (exact-line check) |
| `git status --porcelain` line count | **PASS** — 214 before → **111 after**; remaining untracked entries are real source/docs/tools only |
| `git status --porcelain --untracked-files=all -- message-service/` | **PASS** — 40 files, all service sources/tests/docs/config; no `.env`, no caches |

Suites from the previous run (inputs unchanged this run, therefore not repeated —
cited from `docs/LOCAL_INTEGRATION_VERIFICATION_REPORT.md`):

| Suite | Result |
|---|---|
| message-service pytest | **PASS** — 61 passed, 0 failed, 0 skipped |
| backend authentication pytest | **PASS** — 118 passed, 0 failed, 0 skipped |
| Genuine-token integration matrix | **PASS** — 25/25 |
| Ruff (message service) | **PASS** — clean |
| Health + readiness, both services | **PASS** — HTTP 200/200 |
| Backend suite / mobile typecheck / vitest this run | **NOT TESTED** — no code changed; runs before the *mobile* release build instead (Section 8) |

## 5. Production environment variable names (names only — values live only in Render's dashboard)

**`message-docker-service` (Render → Environment):**

| Name | Where set | Value rule (never written down) |
|---|---|---|
| `APP_ENV` | committed in `render.yaml` | `production` (enables fail-closed boot) |
| `DEBUG` | committed in `render.yaml` | `"false"` |
| `PORT` | committed in `render.yaml` | `"8001"`; Render may inject at run time, CMD honours `$PORT` |
| `DATABASE_URL` | `sync: false` — dashboard only | Neon PostgreSQL connection string, `postgresql+psycopg://…`, TLS required; never committed |
| `JWT_SECRET` | `sync: false` — dashboard only | **byte-identical** to `mahaa-backend-docker`'s value; ≥ 32 chars |
| `JWT_ISSUER` | `sync: false` — dashboard only | **byte-identical** to the backend (`mahaa-api` is the committed default) |
| `JWT_AUDIENCE` | `sync: false` — dashboard only | **byte-identical** to the backend (`mahaa-mobile` is the committed default) |
| `CORS_ORIGINS` | `sync: false` — dashboard only | exact origins, comma separated; **empty** is correct for mobile-only; `*` refused at boot |
| `JWT_ALGORITHM` | optional | same as backend (`HS256` default) |
| `LOG_LEVEL`, `MAX_BODY_BYTES` | optional | unset (derive from `DEBUG` / default 65536) |

**Backend (`mahaa-backend-docker`) must already carry matching `JWT_SECRET`,
`JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_ALGORITHM`, `DATABASE_URL`.** Never modify the
backend service as part of this release.

**Mobile:** `EXPO_PUBLIC_MESSAGE_API_BASE_URL` (plus optional `_WEB`/`_LAN`
overrides) — Section 8.

## 6. Production database backup and migration checklist (operator; none of it executed here)

Expected revisions: backend **`c1a2b3d4e5f6`** (head of `… → b7d2f8c41a93 → c1a2b3d4e5f6`),
message service **`0a1b2c3d4e5f`** (its own version table, expected **absent** until first run).

1. **Read-only verification of current state** (no writes; run from an operator machine):
   - `psql "<neon-connection-string>" -c "SELECT version_num FROM alembic_version;"` → must print exactly `c1a2b3d4e5f6`.
   - `psql "<neon-connection-string>" -c "SELECT version_num FROM alembic_version_message_service;"` → absent (pre-deploy) or `0a1b2c3d4e5f` (already deployed once).
   - `psql "<neon-connection-string>" -c "SELECT to_regclass('public.users'), to_regclass('public.media_assets');"` → both non-NULL.
   - From each project directory: `alembic heads` → single head each; must equal the two revisions above.
   - Optional inventory: `psql … -c "SELECT count(*) FROM message_requests;"` recorded for before/after comparison.
2. **Fresh backup before any schema change:** take a Neon snapshot/branch through the
   Neon dashboard; record its ID; **verify it restores on a scratch branch** and re-run
   step 1's queries against that restore. No migration proceeds until restore
   verification passes.
3. **Migration order:** the backend is already at head in production (its `users` table
   is the FK target — confirmed by step 1). Only the message service migrates:
   from an operator machine, in `message-service/`, over a **direct (non-pooled)** Neon
   connection: `alembic upgrade head` → applies exactly `0a1b2c3d4e5f`.
   Dry-run first with `alembic upgrade head --sql` and confirm the SQL contains only
   `CREATE TABLE message_requests` + its indexes. Never from a Render container, never
   at application startup, never `create_all`.
4. **Post-migration read-only checks:** `SELECT version_num FROM
   alembic_version_message_service;` → `0a1b2c3d4e5f`; `alembic_version` unchanged;
   `message_requests` exists with the 3 CHECK constraints and 3 indexes; `users`
   row count unchanged.
5. **STOP conditions (abort everything, do not deploy):**
   - either `alembic current` differs from the expected revision, or a second head appears;
   - `alembic_version_message_service` exists with an unknown revision;
   - `users` or `media_assets` missing;
   - restore verification of the backup failed or was not performed;
   - the `--sql` dry-run contains anything beyond the `message_requests` change set;
   - any privilege error (needs `CREATE` on schema + `REFERENCES` on `users.id`);
   - the migration command errors for any reason. Record the error; re-verify from step 1.

## 7. Exact Render deployment sequence

**Step 1 — validate `render.yaml` (read-only):**

```powershell
python -c "import yaml; d=yaml.safe_load(open('render.yaml', encoding='utf-8')); s=d['services']; assert [x['name'] for x in s]==['mahaa-backend-docker','message-docker-service']; m=s[1]; assert m['rootDir']=='message-service' and m['dockerfilePath']=='Dockerfile' and m['healthCheckPath']=='/api/v1/health'; print('OK', [(x['name'], x['rootDir']) for x in s])"
```

Expect `OK [('mahaa-backend-docker','backend'), ('message-docker-service','message-service')]`.
STOP if the backend entry changed — the diff must remain +72/−0.

**Step 2 — put the release unit on Git (approval item 1):**

```powershell
git status --short                      # review first
git add .gitignore render.yaml message-service
git add backend/app backend/schemas backend/tests backend/requirements.txt backend/alembic/versions backend/app/api/v1/router.py   # only the backend files belonging to this release
git status --short                      # verify: no .env, no .venv, no caches, no _* scratch
git commit -m "Release: message-docker-service + Render blueprint"
git push origin main
```

Stage explicitly — **never `git add -A` / `git add .`** (the worktree legitimately holds
other in-flight work: calls feature, profiles, reports — Section 9 decides scope).
After staging, `git diff --cached --name-only` must contain none of the never-stage
paths (Section 9). If `message-docker-service` already exists on Render, re-applying a
Blueprint is **not** how settings change (per `render.yaml` header) — see step 3.

**Step 3 — create/select the service (approval item 2):**
- If `mahaa-backend-docker` is **not** yet in Render: Render → New → Blueprint → pick
  this repository → apply **once** → both services reconcile.
- If `mahaa-backend-docker` **already exists**: Render → New → Web Service → same repo,
  branch `main` → Runtime **Docker** → Root Directory `message-service` → Health Check
  Path `/api/v1/health` → Region Singapore → name `message-docker-service`. This adds
  only the new service and never touches the backend.

**Step 4 — configure environment (approval item 3):** dashboard →
`message-docker-service` → Environment → set the names from Section 5
(`DATABASE_URL`, `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE` copied from
`mahaa-backend-docker`'s Environment page, `CORS_ORIGINS` empty). Commit → redeploy.

**Step 5 — first deploy + health:** watch Deploys until **Live**. Then, with
`<REAL_HOST>` from step 6:

```powershell
curl.exe -s https://<REAL_HOST>/api/v1/health     # 200 {"status":"ok",...}
curl.exe -s https://<REAL_HOST>/api/v1/ready      # 200 {"status":"ready","checks":{"database":"ok"}}
curl.exe -s -o NUL -w "%{http_code}`n" https://<REAL_HOST>/api/v1/message-requests   # 401 without token
```

`/ready` 503 ⇒ env value or Neon connectivity — fix the named cause; **do not redeploy
blindly**. Exit-1 boot logs print `Configuration is invalid` with **field names only**.

**Step 6 — determine the real URL:** dashboard → `message-docker-service` → the URL
field Render assigns. **The `https://message-docker-service.onrender.com` host in
comments is a placeholder guess — never assume it.** Record the real host here:
`________________` (host only, no credentials).

**Step 7 — check logs safely:** dashboard → Logs. Safe to read: JSON lines with
`timestamp/level/logger/message/request_id/method/status/duration_ms`, `X-Request-Id`
correlation, `readiness check failed` with exception **class** only, auth 401 counts.
Never copy `DATABASE_URL`/`JWT_SECRET`/`JWT_ISSUER`/`JWT_AUDIENCE` values out of the
Environment page into logs, tickets or chat.

**Step 8 — post-deploy API smoke** (real token from a real login, from Section 8's
account A): `GET /api/v1/message-requests/count` with `Authorization: Bearer …` → 200;
same request with the header removed → 401. Only after this passes is the service live.

**Rollback:** Render → `message-docker-service` → Deploys → Rollback to the previous
deploy (binary only; no DB change — the migration is additive). A schema rollback is a
separate approved operation (Section 6 rules).

## 8. Mobile configuration and two-account smoke test (prepare only — no build in this phase)

### 8.1 The variable

**`EXPO_PUBLIC_MESSAGE_API_BASE_URL`** must contain the deployed message-service base
URL **including `/api/v1`**:

```
EXPO_PUBLIC_MESSAGE_API_BASE_URL=https://<REAL_HOST>/api/v1
```

Optional platform-scoped overrides: `EXPO_PUBLIC_MESSAGE_API_BASE_URL_WEB` (web only),
`EXPO_PUBLIC_MESSAGE_API_BASE_URL_LAN` (physical Android only). Public values only —
no backend secret ever belongs in them.

### 8.2 Building the release (later, approval item 5) and verifying the URL in it

- EAS route: add `EXPO_PUBLIC_MESSAGE_API_BASE_URL` to the `production` profile `env`
  block in `eas.json` (alongside the existing `EXPO_PUBLIC_API_BASE_URL`), then
  `npx eas-cli@latest build --profile production --platform android` (iOS likewise).
- Local route: set the variable in the shell (or `.env`) and run
  `npm run bundle:android` (`expo export --platform android`).
- Before either: `npm run typecheck`, `npm test`, `npm run lint` (**NOT TESTED** this
  run — no mobile code changed here).
- Verify without printing secrets: search the exported bundle for the exact URL string
  (e.g. `findstr /c:"<REAL_HOST>/api/v1"` in `dist-android/_expo/static/js/android/*.hbc`
  or the JS bundle) → must be present; and confirm no emulator default (…`:8000/api/v1`
  message-service target) is what the built app resolves. `EXPO_PUBLIC_*` values are
  public, so this reveals nothing sensitive; never print `.env`, JWT or database values.

### 8.3 Minimum two-account smoke test (two real test accounts, A = sender, B = recipient)

Known gap to disclose in the test record: the app's **send** action
(`sendMessageRequest` in `src/api/messageRequests.ts`) has **no UI button wired yet**
(verified: no call sites); the Requests tab lists/accepts/rejects. Step 3 therefore uses
the same endpoint the module calls.

1. **Login both accounts** in the release build (A on one device/profile, B on another)
   — real sign-in against the backend; tokens are the same ones the message service verifies.
2. **Open the message section** (Messages tab) on both. B must see the Requests pane
   load without errors (skeleton → content or honest empty state — never a spinner hang).
3. **Create a message request:** A → `POST /api/v1/message-requests` with
   `recipient_id` = B's internal id and an optional note (via the app module/curl with
   A's bearer token). Expect **201** first time (200 same row while still pending).
4. **Verify recipient visibility:** B → Messages → Requests: B sees A's card (name,
   note, time), and the tab label shows `Requests (1)` from the server's `pending_count`.
   A's own Requests list stays empty (requests are recipient-scoped).
5. **Accept or reject as supported:** B taps **Accept** → the card leaves the list only
   after server confirmation, label returns to plain `Requests`. Repeat with a second
   request and **Reject**. Re-responding to a settled request (or accepting as A) must
   surface the server's message: 409 → "That request was already handled. Refreshing…"
   inline on the card; 404 → card shown as gone; never a crash, never a silent success.
6. **Verify persistence:** B navigates to Home and back to Messages → Requests (and
   cold-restarts the app) → resolved requests do not reappear; the pending list for a
   still-open request does reappear; counts come from the server on every load.
7. **Confirm failures are visible:** (a) point a build at an unconfigured message URL →
   the Requests pane shows the configuration notice, not an empty list;
   (b) disable the network → persistent `Could not load your requests` banner with
   Retry (server/timeout message), never "No message requests";
   (c) a 401 from the message service must **not** sign the user out of the app
   (non-session-owning client) — the error surfaces inline.

Record each step PASS/FAIL; any FAIL blocks release distribution.

## 9. Files: must be included in the release / must never be staged

**Must be in the release commit (Render builds from the branch):**

- `render.yaml` (with the +72-line message block), `.gitignore` (this run's fix)
- `message-service/` — all 40 files git currently lists: `Dockerfile`,
  `.dockerignore`, `.gitignore`, `.env.example`, `alembic.ini`, `alembic/**`
  (incl. `versions/0a1b2c3d4e5f_message_requests.py`), `app/**`, `requirements.txt`,
  `requirements-dev.txt`, `pyproject.toml`, `docker-compose.yml`, `README.md`,
  `DEPLOYMENT.md`, `docs/**` (incl. this report), `tests/**`
- Backend files of this release: `backend/app/**`, `backend/schemas`-equivalent
  (`backend/app/schemas/**`), `backend/tests/**`, `backend/requirements.txt`,
  `backend/alembic/versions/**`, plus the mobile message modules
  (`src/api/messageRequests.ts`, `src/lib/messageApiBaseUrl.ts`, `src/lib/env.ts`,
  `src/features/messages/**`, `src/app/(candidate)/messages.tsx`) if the release commit
  should carry them

**Must NEVER be staged (verified ignored this run):**

- `.env`, `message-service/.env`, any `.env*` except `.env.example`, `._env*`,
  `.env.bak*` — credentials
- `backend/.venv/`, `venv/`, any `__pycache__/`, `*.pyc`, `.pytest_cache/`,
  `.ruff_cache/`, `.mypy_cache/`
- Backend scratch: `backend/_*` (incl. `_test_db_url.txt`, `_db_user.txt`,
  `_p6_secret.py`-class probes live at root — `/_p*.py`, `/_p*.ps1`, `/_p*.diff`,
  `/_phase25_plan.md`, `/_run_*.bat`, `/_uinput_inject.c`, `/_injector`)
- Dumps/tokens/screenshots: `/_*.txt|png|xml|json`, `/docs/p22_*`,
  `/docs/phase26-evidence/`, `/.device-stage/`, `/.e2e-media/`,
  `/tools/.device-seed.json`, `/.test-email.txt`, UI dumps (`/ui*.xml`, `/ui*.txt`)
- Build artifacts: `dist*/`, `.expo/`, `node_modules/`, `android/`, `.gradle/`,
  `apk-probe-bundle.js`, `/metro.log`, `/.tsc_out.txt`, `/.vscode/`

Rule: stage by **explicit path** (Section 7 step 2) and confirm with
`git diff --cached --name-only` before committing.

## 10. Steps requiring owner approval (I have done none of them)

1. Stage + **commit + push** the release unit (Section 7 step 2).
2. Create/apply the Render service (Blueprint once, or New → Web Service; Section 7 step 3).
3. Set the Render dashboard secrets (`DATABASE_URL`, `JWT_SECRET`, `JWT_ISSUER`,
   `JWT_AUDIENCE`, `CORS_ORIGINS`) and redeploy.
4. Take and verify the Neon backup, then run the message-service migration against
   production (Section 6).
5. Set `EXPO_PUBLIC_MESSAGE_API_BASE_URL` in the release build config, build and
   distribute the mobile release (Section 8).

## 11. Shortest safe next sequence

1. Approve item 1 → stage exactly Section 7 step 2 → `git diff --cached --name-only`
   review → commit → push.
2. Validate `render.yaml` (Section 7 step 1) → approve item 2 → create the service.
3. Approve item 3 → set the five env names → redeploy → `/api/v1/health` 200,
   `/api/v1/ready` 200, unauthenticated 401 (Section 7 steps 4–5, 8).
4. Record the real host (Section 7 step 6).
5. Approve item 4 → backup → restore-verify → read-only revision checks →
   `alembic upgrade head` (message service only) → post-checks (Section 6).
6. Approve item 5 → `typecheck`/`test`/`lint` → add the mobile variable → build →
   bundle URL check → two-account smoke (Section 8).

## 12. Attestation

This run changed exactly two files (Section 3), executed no Git staging/commit/push,
no deployment, no migration, no database/container operation, accessed no production,
edited no `.env`, and printed no secret value. All prior verification results are cited
from `docs/LOCAL_INTEGRATION_VERIFICATION_REPORT.md` and were not re-executed because
no code was changed.
