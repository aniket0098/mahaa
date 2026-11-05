# Phase 17 — Report A: Branch Integration & Message-Service Verification

**Date:** 2026-10-11 · **Repo:** `c:\mahaa` · **Branch:** `main` @ `7a6202c`

## 1. Merge assessment — MERGE BLOCKED (deliberate)

| Item | Finding |
|---|---|
| `message` branch tip | `6b360d6 update gitignore` |
| Commits ahead of `main` | exactly 1 |
| Diff | root `.gitignore` only — **124 deletions, 1 file changed, no message code** |
| Remote branches | only `origin/main` (no `origin/message`) |

The merge premise was invalid. The `message` branch carries **no
message-service code** — its only effect would be deleting the 124-line
root `.gitignore`. All real integration work lives in the **uncommitted
working tree on `main`** (46 modified files plus untracked directories
such as `message-service/`).

Merging would (a) delete `.gitignore` and (b) create a merge commit on top
of a dirty tree, endangering the uncommitted work this phase must
preserve. **Decision: merge skipped; no git history was mutated.** HEAD
stayed at `7a6202c` for the entire phase.

## 2. Verification stack (brought up locally by this phase)

- DB `msgsvc` @ `127.0.0.1:5435` (container `message-service-db-1`, healthy); backend + message-service alembic migrations applied — **36 tables**.
- Isolated DB `msgsvc_pytest` (+ backend migrations) so row-count assertions cannot be polluted by live-backend rows.
- `message-service-app-1` built from `message-service/Dockerfile`, healthy on **:8001** (health/ready 200, clean logs).
- Main backend uvicorn on **:8000** against `msgsvc`.
- JWT parity (issuer / audience / secret) proven by **SHA-256 hash equality** — no secret values printed anywhere.

## 3. Automated verification results — all green

| Suite | Target | Result |
|---|---|---|
| Backend messaging (`tests/test_p5_messaging.py` + `tests/test_realtime_messaging.py`) | isolated `msgsvc_pytest` | **134 passed, 0 failed** (151.67 s) |
| Message-service suite (`message-service/tests`) | isolated DB | **61 passed, 0 skipped, exit 0** |
| Mobile integration (`src/api/integration.test.ts`) | live backend | **44 / 44 passed** |
| Full mobile suite (`npm test`) | live backend | **990 passed / 990** (56 files) |
| Custom E2E script (`%TEMP%\mahaa_e2e_msg.py`) | live stack | **21 / 21 PASS** |
| `docker compose config -q` | message-service | OK |

**Diagnosed false failures.** The first backend run against the *shared*
`msgsvc` DB reported 129 passed / 5 failed. Root cause: live-backend rows
in the same database vs. tests asserting *global* row counts —
cross-connection interference, not a code defect. In isolation all five
previously-failing tests pass and the full suite is 134/134.

**E2E scenarios (21 checks):** connections; conversation list; send →
retrieve → persist across re-fetch; idempotency (identical payload → 200,
same record id); ordering; 404 anti-enumeration on a foreign conversation;
401 on an invalid token; message-request state machine (pending →
accepted, re-accept → 409, request-count endpoint).

## 4. Working-tree integrity

- `git status` before vs. after: identical — **46 modified files**, HEAD `7a6202c`, no `.git/index.lock`, nothing staged/committed/reverted.
- The only files added by this phase are this report and Report B under `docs/` (untracked, deliberate deliverables).
- The uncommitted message-integration work is fully preserved.

## 5. Final service state

- Backend uvicorn (started by this phase): **stopped**.
- message-service stack: **stopped and removed** (`docker compose -p message-service down`); named volume `message-service_msgsvc_pgdata` **retained** (local test data kept).
- Ports 8000 / 8001 free. Pre-existing Metro dev server on 8081 left running untouched.

## 6. Reproduction

```powershell
# stack
cd C:\mahaa\message-service; docker compose up -d --build   # :8001 + db :5435
$env:DATABASE_URL='postgresql+psycopg://msgsvc:msgsvc_local_dev@127.0.0.1:5435/msgsvc_pytest'
cd C:\mahaa\message-service; python -m alembic upgrade head
cd C:\mahaa\backend; .venv\Scripts\python -m uvicorn app.main:app --port 8000
# suites
$env:TEST_DATABASE_URL='postgresql+psycopg://msgsvc:msgsvc_local_dev@127.0.0.1:5435/msgsvc_pytest'
.venv\Scripts\python -m pytest tests\test_p5_messaging.py tests\test_realtime_messaging.py -q
cd C:\mahaa\message-service; python -m pytest tests -q
cd C:\mahaa; npm test                                       # 990 incl. 44 live integration
```

> Evidence: `%TEMP%\mahaa_backend_msg_clean.log`, `%TEMP%\mahaa_msg_clean.log`, `%TEMP%\mahaa_mobile_full.log`, `%TEMP%\mahaa_e2e_msg.py`.
