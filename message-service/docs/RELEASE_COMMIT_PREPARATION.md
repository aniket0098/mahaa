# MAHAJOB — RELEASE COMMIT PREPARATION — Message Service

Date (UTC): 2026-10-15
Project root: `C:\mahaa`
Input evidence: `message-service/docs/RENDER_RELEASE_READINESS_REPORT.md` (read in full,
including its include/exclude lists in §9 and the staging sequence in §7 step 2).

Safety attestation for this run: no `git add`, `git commit`, `git push`, no Render change,
no deployment, no database connection, no migration, no `.env` read or edit, and no secret
value printed, read aloud or copied. Secret-like patterns found in release files were
classified by **derived booleans only** (host shape, credential shape, length, character
classes) — never by displaying the value. A temporary classification script created under
`message-service/docs/_tmp_secret_scan.ps1` was deleted; no other file was created, modified,
moved or deleted by this run.

---

## 1. Verdict

**READY FOR MANUAL STAGING** — with one required correction discovered in this run:
the 9 Python package `__init__.py` files are silently swallowed by
`message-service/.gitignore`'s `_*` scratch rule (line 17) and will **not** be staged by a
plain `git add <path>`. Section 6 therefore adds nine explicit `git add -f` lines for
exactly those paths. With that correction applied, the staging list below is complete,
secret-free, additive-only, and touches none of the user's unrelated in-flight work.

Not a blocker because: no secrets exist in any release path (Section 4), the scope is
unambiguous (Section 3), and the correction is fully explicit — nine named paths, no
broad commands, nothing overwritten.

## 2. Files to include (52 explicit paths)

### 2.1 Root files (2)

| Path | Why |
|---|---|
| `.gitignore` | +46/−0 additive "Release staging hygiene" block (verified in this run) |
| `render.yaml` | +72/−0 additive `message-docker-service` block (verified in this run) |

### 2.2 `message-service/` — 41 git-listed files + 9 force-add files = 50

Git-listed (verified committable via `git ls-files --others --exclude-standard`, 41 paths —
the readiness report says 40; the current tree has 41, the count having grown with the
Docker build/deployment docs; the list below is authoritative for today's tree):

- Root/config: `.dockerignore`, `.env.example`, `.gitignore`, `DEPLOYMENT.md`, `Dockerfile`,
  `README.md`, `alembic.ini`, `docker-compose.yml`, `pyproject.toml`,
  `requirements-dev.txt`, `requirements.txt` (11)
- Alembic: `alembic/env.py`, `alembic/script.py.mako`,
  `alembic/versions/0a1b2c3d4e5f_message_requests.py` (3)
- App: `app/main.py`, `app/api/deps.py`, `app/api/v1/router.py`,
  `app/api/v1/endpoints/health.py`, `app/api/v1/endpoints/message_requests.py`,
  `app/core/config.py`, `app/core/errors.py`, `app/core/logging.py`, `app/db/base.py`,
  `app/db/dependencies.py`, `app/db/session.py`, `app/models/message_request.py`,
  `app/schemas/message_requests.py`, `app/services/identity.py`,
  `app/services/message_requests.py` (15)
- Docs: `docs/DOCKER_BUILD_REPORT.md`, `docs/DOCKER_RENDER_DEPLOYMENT.md`,
  `docs/FINAL_HARDENING_REPORT.md`, `docs/FINAL_PREDEPLOYMENT_AUDIT.md`,
  `docs/LOCAL_INTEGRATION_VERIFICATION_REPORT.md`,
  `docs/RENDER_RELEASE_READINESS_REPORT.md` (6)
- Tests: `tests/conftest.py`, `tests/test_auth.py`, `tests/test_config.py`,
  `tests/test_health.py`, `tests/test_message_requests.py`, `tests/test_request_guards.py` (6)

Force-add required (9 — see Section 5.2): `app/__init__.py`, `app/api/__init__.py`,
`app/api/v1/__init__.py`, `app/api/v1/endpoints/__init__.py`, `app/core/__init__.py`,
`app/db/__init__.py`, `app/models/__init__.py`, `app/schemas/__init__.py`,
`app/services/__init__.py`.

Note: `this document` (`docs/RELEASE_COMMIT_PREPARATION.md`) is deliberately **not** in the
staging list — it is created after the list was frozen; the owner may add it with one extra
explicit `git add message-service/docs/RELEASE_COMMIT_PREPARATION.md` if desired.

## 3. Files to exclude (and why)

| Excluded | Reason |
|---|---|
| `message-service/.env` | Real credentials (`DATABASE_URL`, `JWT_SECRET`); exists on disk; ignored by `message-service/.gitignore:8` — verified with `git check-ignore` |
| `message-service/.pytest_cache/`, `.ruff_cache/`, all `__pycache__/` | Caches; verified ignored |
| `backend/**` (all modified and untracked: calls feature, `b7d2f8c41a93`, `c1a2b3d4e5f6`, `test_p25_message_media`, etc.) | Unrelated in-flight user work; readiness report §7 optionally lists backend message files, but this release is scoped to the smallest unit (message service + Render config + ignore fix); backend work stays in the worktree untouched |
| `src/**`, `package.json`, `package-lock.json` (mobile message modules, calls, stories, feed, auth, realtime…) | Same — intermixed in-flight user work; the mobile `EXPO_PUBLIC_MESSAGE_API_BASE_URL` wiring is a later release step (report §8) |
| `docker-compose.yml` (root), `.vscode/settings.json`, `backend/.gitignore` | Modified user files unrelated to this release; preserved unstaged |
| Root scratch/dumps (`/_p*.py`, `/_p*.ps1`, `_web.log`, `.vscode/`, `docs/p22_*`, …) | Ignored (mix of pre-existing rules like `/_*.log` and the new block); nothing matched is in the staging list |

## 4. Validation results (executed in this run)

| # | Check | Result |
|---|---|---|
| V1 | `render.yaml` YAML syntax | **PASS** — parsed with PyYAML (`backend/.venv` interpreter); `services` = `[mahaa-backend-docker (rootDir backend), message-docker-service (rootDir message-service)]`; message block has `dockerfilePath: Dockerfile`, `healthCheckPath: /api/v1/health` |
| V2 | `render.yaml` additive only | **PASS** — `git diff --numstat` = **72 insertions, 0 deletions**; backend service block untouched; existing `DATABASE_URL sync: false` line intact |
| V3 | Root `.gitignore` additive only | **PASS** — **46 insertions, 0 deletions**; block header "Release staging hygiene"; nothing pre-existing removed |
| V4 | `.gitignore` unintended effects | **PASS with notes** — all scratch rules are root-anchored or name-exact and cannot reach `message-service/` release files (`/docs/p22_*` and `/docs/phase26-evidence/` anchor to root `docs/`, not `message-service/docs/`). Only effect found: already-tracked files stay tracked despite the new `/.vscode/` rule (`.vscode/settings.json` modification still shows in `git status` and is excluded from staging by explicit path). `_web.log`/`_web.err.log` are ignored by the **pre-existing** rule `.gitignore:56 /_*.log`, not by the new block. Cosmetic: `.gitignore` has no trailing newline |
| V5 | `.env` exclusion | **PASS** — `message-service/.env` exists and matches `message-service/.gitignore:8 (.env)`; `.env.example` is committable via the `!.env.example` negation and contains placeholders only |
| V6 | Release-file inventory | **PASS after correction** — 41 committable files, all service sources/tests/docs/config; **9 `__init__.py` files exist on disk but are ignored** by `message-service/.gitignore:17 _*` (matches any name starting with `_`, including `__init__.py`) — corrected via explicit force-add (Section 6). The same `_*` rule exists in `message-service/.dockerignore`, so the Docker image also builds without them; the container was verified working (namespace packages, `DOCKER_BUILD_REPORT.md`), but the Git release should carry the complete verified source |
| V7 | Secret scan of all 41 committable files | **PASS** — patterns: `postgresql://`, JWT-shaped strings, private-key blocks, `password/secret/token = "…"` assignments. Results, classified by shape only: every `postgresql://` URL is localhost/`127.0.0.1`-hosted, a doc example (internal-style `name.name.name:port` host in `DOCKER_RENDER_DEPLOYMENT.md`), or a test fixture in `tests/test_config.py`; **no** `neon.tech`/`ep-…` host anywhere; no JWT-shaped string; no private-key block. The three secret-like assignments are: the fail-closed placeholder in `app/core/config.py` (placeholder-marked), its doc mirror in `DOCKER_RENDER_DEPLOYMENT.md` (placeholder-marked), and one 23-character mixed-case fixture signing key on `tests/test_auth.py:59` used by `headers_for(uuid.uuid4(), secret=…)` to mint throwaway tokens inside the test — a test constant, not a production credential |
| V8 | Scope unambiguity | **PASS** — `message-service/` contains no tracked files (entirely untracked); staging the 52 explicit paths cannot modify, overwrite or discard any existing user change |

## 5. Findings requiring operator attention

### 5.1 Report count drift (informational)
The readiness report §4/§9 says "40 files"; today `git ls-files --others --exclude-standard
message-service` lists **41** (the docs set grew — `DOCKER_BUILD_REPORT.md` /
`LOCAL_INTEGRATION_VERIFICATION_REPORT.md`). Section 2.2 of this document is the
authoritative list.

### 5.2 The `_*` → `__init__.py` footgun (corrected in the staging commands)
`message-service/.gitignore:17` uses `_*` to ignore scratch files, but `_*` also matches
`__init__.py`, so all 9 package markers are invisible to `git add`. They are force-added
individually below — no broad commands, each path named. **Recommendation for a future
commit** (not done here — this run does not modify release files): add
`!__init__.py` to `message-service/.gitignore` (and `.dockerignore`) so a future plain
`git add message-service` cannot silently drop them again.


## 6. Exact staging commands (run manually; nothing was executed by this run)

```powershell
Set-Location C:\mahaa

# --- Root release files (2) ---
git add .gitignore
git add render.yaml

# --- message-service: root and config files (11) ---
git add message-service/.dockerignore
git add message-service/.env.example
git add message-service/.gitignore
git add message-service/DEPLOYMENT.md
git add message-service/Dockerfile
git add message-service/README.md
git add message-service/alembic.ini
git add message-service/docker-compose.yml
git add message-service/pyproject.toml
git add message-service/requirements-dev.txt
git add message-service/requirements.txt

# --- message-service: alembic (3) ---
git add message-service/alembic/env.py
git add message-service/alembic/script.py.mako
git add message-service/alembic/versions/0a1b2c3d4e5f_message_requests.py

# --- message-service: app modules (15) ---
git add message-service/app/main.py
git add message-service/app/api/deps.py
git add message-service/app/api/v1/router.py
git add message-service/app/api/v1/endpoints/health.py
git add message-service/app/api/v1/endpoints/message_requests.py
git add message-service/app/core/config.py
git add message-service/app/core/errors.py
git add message-service/app/core/logging.py
git add message-service/app/db/base.py
git add message-service/app/db/dependencies.py
git add message-service/app/db/session.py
git add message-service/app/models/message_request.py
git add message-service/app/schemas/message_requests.py
git add message-service/app/services/identity.py
git add message-service/app/services/message_requests.py

# --- message-service: package markers, ignored by the `_*` rule -> force-add (9) ---
git add -f message-service/app/__init__.py
git add -f message-service/app/api/__init__.py
git add -f message-service/app/api/v1/__init__.py
git add -f message-service/app/api/v1/endpoints/__init__.py
git add -f message-service/app/core/__init__.py
git add -f message-service/app/db/__init__.py
git add -f message-service/app/models/__init__.py
git add -f message-service/app/schemas/__init__.py
git add -f message-service/app/services/__init__.py

# --- message-service: docs (6) ---
git add message-service/docs/DOCKER_BUILD_REPORT.md
git add message-service/docs/DOCKER_RENDER_DEPLOYMENT.md
git add message-service/docs/FINAL_HARDENING_REPORT.md
git add message-service/docs/FINAL_PREDEPLOYMENT_AUDIT.md
git add message-service/docs/LOCAL_INTEGRATION_VERIFICATION_REPORT.md
git add message-service/docs/RENDER_RELEASE_READINESS_REPORT.md

# --- message-service: tests (6) ---
git add message-service/tests/conftest.py
git add message-service/tests/test_auth.py
git add message-service/tests/test_config.py
git add message-service/tests/test_health.py
git add message-service/tests/test_message_requests.py
git add message-service/tests/test_request_guards.py
```

Explicitly **never** run: `git add -A`, `git add .`, `git clean`, `git reset`, `git stash`,
any broad restore, `git commit`, `git push` (commit/push are the owner's separate,
reviewed steps).

## 7. Final review command (after manual staging)

```powershell
git diff --cached --name-only
```

Expected output: **exactly 52 paths** — `.gitignore`, `render.yaml`, and the 50
`message-service/…` files listed in Section 2 (41 regular + 9 force-added `__init__.py`).
If any other path appears (a `backend/…`, `src/…`, `.vscode/…`, `*.env` other than
`.env.example`, `__pycache__/`, `*.log`, `_…` scratch file), unstage it by exact name with
`git restore --staged <path>` before committing. `message-service/.env` must **not** appear.

## 8. Confirmation of non-actions

This preparation run performed **none** of the following, and none should be inferred:

- no `git add`, `git commit`, or `git push` (staging is left to the manual run of §6);
- no Render dashboard or Blueprint change, no deployment of any kind;
- no connection to Neon or any production database; no migration executed or planned here
  (the message-service migration remains the owner-approved operator step in report §6);
- no `.env` file was opened, edited or copied; no secret value was displayed — every
  secret-shaped match was classified by derived shape booleans only;
- no existing user change was overwritten, discarded or staged — all unrelated modified
  and untracked work identified in `git status` remains exactly where it was.

## 9. Verdict (repeat)

**READY FOR MANUAL STAGING.** The release unit (verified message service + additive
`render.yaml` block + additive `.gitignore` hygiene block) is complete, syntactically
valid, secret-free, and separable from the user's unrelated in-flight work. The single
corrective amendment — nine explicit `git add -f` lines for the `_*`-swallowed
`__init__.py` markers — is spelled out path-by-path in §6 and must be included when
staging; without them the committed service would be missing its package markers.
