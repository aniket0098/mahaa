# LOCAL INTEGRATION VERIFICATION REPORT — message service & main backend

Date (UTC): 2026-10-15 (this run)
Scope: isolated local verification only. No deploy, no commit, no push, no production access.
This document is credential-free: no secret, token, password or DSN value appears anywhere below.

- Main backend: `C:\mahaa\backend` (FastAPI `app.main:app`), served at `http://127.0.0.1:8100`.
- Message service: `C:\mahaa\message-service`, served at `http://127.0.0.1:8011`.
- Target database: `msgsvc_verify2` in the pre-existing container `msgsvc-verify-db` (`127.0.0.1:5439`).
- Verdict: **READY FOR NEXT DEPLOYMENT-PREPARATION STEP**.

## 0. Supersession notice

A previous revision of this file documented an earlier verification attempt on the same
date (a 32-case matrix that additionally exercised suspended accounts via direct SQL and
ran the backend auth + health suites together). That content is **superseded by this
report**, which records only the results of the current authorized run. No number below is
reused from that earlier document; every status here was observed in this run's transcripts.

## 1. Stage results (this run)

| # | Stage | Result | Evidence |
|---|-------|--------|----------|
| 1 | Preflight: paths, git, docker context, container, ports, DB reachability | **PASS** | sections 2-3 |
| 2 | Alembic heads (repo files) == DB revisions, both projects | **PASS** | section 3 |
| 3 | Baseline DB rows = 0 users / 0 message_requests | **PASS** | section 3 |
| 4 | Configuration and local-safety review (source-level) | **PASS** | section 4 |
| 5 | Startup both services on loopback, process-scoped env | **PASS** | sections 5-6 |
| 6 | Health + readiness, both services | **PASS** | section 6 |
| 7 | Genuine-token integration matrix (25 cases) | **PASS 25/25** | section 7 |
| 8 | Message-service pytest on `msgsvc_verify2` | **PASS — 61 passed, 0 skipped** | `61 passed, 5 warnings in 5.68s`, exit 0 |
| 9 | Backend authentication pytest | **PASS — 118 passed** | `118 passed, 1 warning in 9.20s`, exit 0 |
| 10 | Ruff, message service | **PASS** | `All checks passed!` exit 0 |
| 11 | Cleanup and post-state verification | **PASS** | section 10 |

No stage is FAIL or BLOCKED. One matrix row is NOT TESTED by design (live suspension —
see section 7.3).

## 2. Host, Git, Docker

| Item | Value |
|---|---|
| OS / shell | Windows / PowerShell only |
| Docker context | `desktop-linux` |
| Branch | `main` (tracking `origin/main`) |
| Commit | `7a6202ca13cd8ba02b4eefca3741f5fed9224fa0` |
| `git status --short --branch` at start | `## main...origin/main`; ~60 modified tracked files and ~150 untracked entries (incl. the untracked `message-service/` tree) — all pre-existing |
| `git status` at end | 214 short-status lines — identical count; this run changed no tracked file and staged/committed nothing |

No `git add`, `stash`, `reset`, `commit`, `push`, or checkout was executed at any point.

## 3. Database identity, baseline, revisions — PASS

| Item | Value |
|---|---|
| Container | `msgsvc-verify-db` (postgres:16) — Up before and after |
| Volume | `msgsvc_verify_pgdata` mounted at `/var/lib/postgresql/data` (verified via `docker inspect`) |
| Reachability | `127.0.0.1:5439` accepted psql connections; `current_database()` confirmed `msgsvc_verify2` |
| Other databases present | `msgsvc_verify`, `postgres` — untouched |
| Baseline counts | `users = 0`, `message_requests = 0` |
| Final counts | `users = 2`, `message_requests = 2` — created **only** by this run's matrix through the real APIs; left in place deliberately (row deletion was not authorized for this run; see section 10) |

| Project | Head in repo files | Revision in DB | Match |
|---------|-------------------|----------------|-------|
| backend | `c1a2b3d4e5f6` (linear chain of 13; `phase_23_discoverable_default`) | `alembic_version = c1a2b3d4e5f6` | **yes** |
| message-service | `0a1b2c3d4e5f` (single revision `message_requests`) | `alembic_version_message_service = 0a1b2c3d4e5f` | **yes** |

Heads were derived from the revision files themselves (three backend files use the
`revision: str | None = ...` annotation style; the full down-revision chain is linear with
one head). The two version tables are distinct — `message-service/alembic.ini` sets
`version_table = alembic_version_message_service` and `alembic/env.py` re-asserts it — so
the two services share one database without contending over history. **No `alembic
upgrade`, `downgrade`, `stamp`, or any other schema-changing command was executed.**

## 4. Configuration and local-safety findings (Phase 2)

- **Shared database:** both apps resolve `DATABASE_URL` via pydantic-settings
  (`backend/app/core/config.py`, `message-service/app/core/config.py`) and both accept the
  same `postgresql+psycopg://` scheme. Process-scoped environment variables override the
  `.env` files, so the pre-existing `.env` files were neither needed nor modified; their
  values were never printed.
- **Separate Alembic version tables:** confirmed in `message-service/alembic.ini`
  (`version_table = alembic_version_message_service`) and re-asserted in its `alembic/env.py`;
  both tables were observed in the database (section 3).
- **Test safety (`tests/conftest.py`, both projects):** `TEST_DATABASE_URL` is preferred
  over `DATABASE_URL`; a non-loopback host is refused outright (`pytest.fail` with an
  explicit refusal); a missing DSN skips DB tests honestly; every DB test runs inside one
  rolled-back transaction and no test mutates schema.
- **Real routes (read from source; none invented):**
  - Backend: `POST /api/v1/auth/signup` (201), `POST /api/v1/auth/login` (200),
    `GET /api/v1/auth/me` (200), `GET /api/v1/health`, `GET /api/v1/ready`. Signup body
    `{name, email, password, phone?, role?}` with `extra="forbid"`; password policy
    min 8 / max 128 / >=1 letter / >=1 digit; a suspended login is 403.
  - Message service: `GET /api/v1/message-requests` (received, default `status=pending`),
    `GET /api/v1/message-requests/count`, `POST /api/v1/message-requests`
    (`{recipient_id, note?}`, `extra="forbid"`), `POST /api/v1/message-requests/{id}/accept`,
    `POST /api/v1/message-requests/{id}/reject`, plus `/api/v1/health` and `/api/v1/ready`.
- **Documented service contract** (`app/services/message_requests.py` + endpoint docstrings):
  create is idempotent per pending pair (**201** created / **200** same record); respond is
  recipient-only and a non-recipient — including the sender — gets **404**, never 403;
  responding to a resolved request is **409**; self-request is **422**; unknown recipient is
  **404** with a generic body.
- **JWT validation (message service, `app/api/deps.py::decode_access_token`):** PyJWT decode
  with the shared `JWT_SECRET`, pinned `JWT_ALGORITHM` (the incoming `alg` header is never
  trusted), `issuer=mahaa-api`, `audience=mahaa-mobile`, and
  `require=[exp, iat, sub, iss, aud]`; `sub` must be a UUID of a living, non-suspended
  `users` row. Any `PyJWTError` collapses to one generic **401**; a known suspended account
  is **403**. The service never mints tokens.
- **Environment variables** (names/defaults only, from config source and `.env.example`):
  `DATABASE_URL`, `JWT_SECRET`, `JWT_ALGORITHM`, `JWT_ISSUER`, `JWT_AUDIENCE`, `APP_ENV`,
  `DEBUG`, `HOST`/`PORT`, `CORS_ORIGINS`, `LOG_LEVEL`, `MAX_BODY_BYTES`, plus the backend's
  rate-limit and optional push/Realtime/LiveKit variables. Production mode is fail-closed
  on placeholder secrets/DSNs.

## 5. Startup commands (secrets redacted)

Both processes used the project's existing Python environment
(`C:\mahaa\backend\.venv\Scripts\python.exe`), which contains every declared dependency
(fastapi, uvicorn, sqlalchemy, psycopg3, PyJWT, httpx, pytest, livekit, argon2, ruff).

```
# Backend (cwd C:\mahaa\backend), PID tree 65516 -> 38464 (listener)
set DATABASE_URL=postgresql+psycopg://<REDACTED>@127.0.0.1:5439/msgsvc_verify2
set APP_ENV=development  JWT_ALGORITHM=HS256  JWT_ISSUER=mahaa-api  JWT_AUDIENCE=mahaa-mobile
set JWT_SECRET=<REDACTED — committed development placeholder, process-scoped only>
python -m uvicorn app.main:app --host 127.0.0.1 --port 8100 --log-level info

# Message service (cwd C:\mahaa\message-service), PID tree 54072 -> 44896 (listener)
set DATABASE_URL=postgresql+psycopg://<REDACTED>@127.0.0.1:5439/msgsvc_verify2
set APP_ENV=development  DEBUG=true  JWT_ALGORITHM=HS256  JWT_ISSUER=mahaa-api  JWT_AUDIENCE=mahaa-mobile
set JWT_SECRET=<REDACTED — same placeholder, so both sides verify the same key>
python -m uvicorn app.main:app --host 127.0.0.1 --port 8011 --log-level info
```

Both bindings were loopback-only. Startup logs showed `Application startup complete` with
no errors. No pre-existing listener or container was disturbed.

## 6. Health and readiness — PASS

| Probe | Expected | Actual | Body (sanitized) |
|-------|----------|--------|------------------|
| backend `GET /api/v1/health` | 200 | **200** | `{"status":"ok","app":"Mahaa API","version":"0.1.0","environment":"development"}` |
| backend `GET /api/v1/ready` | 200 | **200** | `{"status":"ready","checks":{"database":"ok"}}` |
| msgsvc `GET /api/v1/health` | 200 | **200** | `{"status":"ok","app":"Mahaa Message Service","version":"0.1.0","environment":"development"}` |
| msgsvc `GET /api/v1/ready` | 200 | **200** | `{"status":"ready","checks":{"database":"ok"}}` |

## 7. Genuine-token integration matrix — 25/25 PASS

Tokens were genuine: accounts were created via the real `POST /api/v1/auth/signup` with
random test-only `@example.com` addresses and strong test-only passwords, and the resulting
server-issued access tokens were presented to the message service. The four deliberately
broken tokens (expired / wrong-secret / wrong-audience / malformed) were minted only to
prove rejection, using the standard negative-test recipe.

| # | Case | Expected | Actual | Result |
|---|------|----------|--------|--------|
| 1 | signup user A | 201 | 201 | PASS |
| 2 | signup user B | 201 | 201 | PASS |
| 3 | login user A | 200 | 200 | PASS |
| 4 | login user B | 200 | 200 | PASS |
| 5 | `/auth/me` A and B return distinct identities | 200/200 distinct | 200/200 distinct | PASS |
| 6 | missing token rejected (msgsvc) | 401 | 401 | PASS |
| 7 | malformed token rejected (msgsvc) | 401 | 401 | PASS |
| 8 | expired token rejected (msgsvc) | 401 | 401 | PASS |
| 9 | wrong-secret token rejected (msgsvc) | 401 | 401 | PASS |
| 10 | wrong-audience token rejected (msgsvc) | 401 | 401 | PASS |
| 11 | wrong-secret rejected (backend `/auth/me`) | 401 | 401 | PASS |
| 12 | wrong-audience rejected (backend `/auth/me`) | 401 | 401 | PASS |
| 13 | create message request A->B | 201 | 201 | PASS |
| 14 | duplicate pending create idempotent | 200, same record | 200, same id | PASS |
| 15 | recipient B lists and sees the request | 200, item present | 200, present | PASS |
| 16 | sender does not see own request in received list | 200, item absent | 200, absent | PASS |
| 17 | sender cannot accept own request | 404 | 404 | PASS |
| 18 | recipient B accepts request | 200 `status=accepted` | 200 `accepted` | PASS |
| 19 | repeat accept -> conflict | 409 | 409 | PASS |
| 20 | new request after resolution | 201 | 201 | PASS |
| 21 | duplicate of new pending -> 200 same record | 200, same id | 200, same id | PASS |
| 22 | self-request rejected | 422 | 422 | PASS |
| 23 | unknown recipient rejected, no private data leaked | 404, no PII in body | 404, no email/password/traceback in body | PASS |
| 24 | cross-user respond denied | 404 | 404 | PASS |
| 25 | create without token rejected | 401 | 401 | PASS |

### 7.1 Contract confirmation

The live API matched the documented contract exactly in all 25 cases: 201-once/200-on-duplicate
create, recipient-only responses with 404 for the sender, 409 on re-response, 422 self-request,
404 unknown recipient with a generic, PII-free envelope.

### 7.2 One harness finding (not a product defect)

The first matrix attempt used `@example.test` addresses and received **422** from signup:
`value is not a valid email address: The part after the @-sign is a special-use or reserved
name`. The live email-validator rejects special-use TLDs outside test-environment mode —
correct behavior, and the reason the repo's own test suites use `example.test` only inside
pytest (which enables test mode) while this live matrix must use `example.com`. The matrix
was corrected and re-run; all 25 cases then passed. Root cause recorded; no code changed.

### 7.3 Suspended-user behavior — NOT TESTED live (documented limitation)

There is no API or admin route to suspend an account; the only way to produce a suspended
row locally would be a direct SQL `UPDATE users SET status=...`, i.e. bypassing the
authorization model and mutating data through a side channel. Per the run's safety rules this
case was **not executed live** and is reported honestly as NOT TESTED. It is covered by the
automated suite: `message-service/tests/test_auth.py` exercises suspended accounts through
the rolled-back test fixtures (suspended -> 403 on guarded routes), and those tests passed
in section 8. Backend `app/api/deps.py` implements the matching 403 for suspended callers.

## 8. Automated tests and lint (Phase 5)

| Suite | Command | Result |
|-------|---------|--------|
| message-service, full | `python -m pytest --tb=short` from `C:\mahaa\message-service` with `TEST_DATABASE_URL` set explicitly in the test process (pointing at `msgsvc_verify2` via `127.0.0.1:5439`) | **61 passed, 0 failed, 0 skipped, 0 errored**, 5 warnings, **5.68s**, exit 0 |
| message-service lint | `python -m ruff check .` from `C:\mahaa\message-service` | **All checks passed**, exit 0 |
| backend authentication | `python -m pytest tests/test_auth_api.py tests/test_auth_tokens.py tests/test_auth_passwords.py` from `C:\mahaa\backend` with `TEST_DATABASE_URL` set explicitly | **118 passed, 0 failed, 0 skipped, 0 errored**, 1 warning, **9.20s**, exit 0 |

No suite is reported as passing with hidden failures: every test executed and none were
skipped, xfailed, or errored. The 5 message-service warnings are library deprecations
(starlette TestClient/httpx, `HTTP_413_REQUEST_ENTITY_TOO_LARGE`) and one PyJWT
`InsecureKeyLengthWarning` raised by a test that deliberately signs with a 23-byte key to
prove wrong-secret rejection — expected, non-blocking. The backend warning is the same
TestClient deprecation. Backend ruff was not re-run (out of this run's scope; the message
service is the subject under verification).

## 9. Root causes for every failure or blocker

| Observation | Root cause | Outcome |
|-------------|-----------|---------|
| First matrix attempt: signups returned 422 | Harness used the special-use `.test` TLD, which the live email-validator correctly rejects outside test mode | Harness corrected to `example.com`; matrix re-run 25/25 PASS; no product change |
| Live suspended-user case not executed | No supported local mechanism exists (no admin/suspend API); the only alternative would be direct SQL mutation, bypassing authorization | Reported as NOT TESTED; covered by `tests/test_auth.py` (passed within the 61) |
| No other failure or blocker occurred in any stage | — | — |

## 10. Cleanup and post-state (Phase 6)

- **Processes:** the four PIDs this run owned (backend 65516 -> listener 38464; message
  service 54072 -> listener 44896) were re-verified against their uvicorn command lines and
  then stopped by exact PID. Ports 8100 and 8011 were confirmed released afterwards.
  No other process was touched.
- **Temporary artifacts:** every file this run created in the system TEMP directory (matrix
  driver, results JSON, signup probe, Alembic-chain parser, PID file, uvicorn logs, pytest
  output captures) was deleted. A pre-existing `msgsvc-pytest-final.txt` in TEMP from an
  earlier session was left alone.
- **Containers/volumes/databases:** `msgsvc-verify-db` (Up), `message-service-app-1`
  (Up 2 hours, healthy) and `message-service-db-1` (Up 2 hours, healthy) were all verified
  running after cleanup. Nothing was created, deleted, reset, stopped, or recreated.
  Volume `msgsvc_verify_pgdata` remains mounted.
- **Database rows:** the 2 users and 2 message_requests created by the matrix through the
  real APIs were **left in place** — deleting rows was not authorized for this run; the
  baseline (0/0) and final (2/2) counts are both recorded above so the next operator can
  decide. No schema object was altered.
- **Git:** final `git status --short` shows the same 214 entries as at start (the report
  file lives inside the already-untracked `message-service/` tree). Nothing was staged,
  stashed, reset, committed, or pushed; no tracked file was modified.

## 11. Safety-boundary attestation

This run **did not**: access Neon or any production endpoint; run `alembic upgrade`,
`alembic downgrade`, `alembic stamp`, or any schema-changing command; create, delete,
reset, or recreate any container, volume, or database; modify any `.env` file; stage,
stash, reset, commit, or push anything in Git; stop or modify any pre-existing container
(especially `message-service-app-1` and `message-service-db-1`); or print any password,
token, DSN, or personal data into logs or this report. All credentials used were
process-scoped environment variables carrying the committed development placeholder and
random test-only values.

## 12. Verdict

| Question | Answer |
|----------|--------|
| Migrations current (backend `c1a2b3d4e5f6`, message service `0a1b2c3d4e5f`)? | **PASS** |
| Health/readiness on 8100 and 8011? | **PASS** — 200/200 on both |
| Genuine-token compatibility backend <-> message service? | **PASS** — 25/25 matrix cases |
| Message-service suite on the isolated DB? | **PASS** — 61 passed, 0 failed, 0 skipped |
| Backend authentication suite? | **PASS** — 118 passed, 0 failed |
| Lint (message service)? | **PASS** — clean |
| Any stage FAIL or BLOCKED? | **No** |
| Suspended-user live case? | **NOT TESTED** (no supported mechanism; covered by automated suite) |
| Credentials exposed? | **No** |

**READY FOR NEXT DEPLOYMENT-PREPARATION STEP.**
