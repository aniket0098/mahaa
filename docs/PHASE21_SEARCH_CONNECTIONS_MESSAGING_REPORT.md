# PHASE 21 — Search, Connections & Messaging Report

Date (UTC): 2026-10-12
Branch: `main` (HEAD `7a6202c`, matches `origin/main`)
Scope: people search + live suggestions, connection-request acceptance from
Notifications, Messages → All → person → conversation.

## 0. Worktree state (preserved, nothing discarded)

Initial `git status --short` showed pre-existing work, all preserved.
Modified tracked files include the auth/session fix (`src/auth/*`,
`src/api/client.ts`), query keys, realtime bridge, feed/stories/home work,
and backend router/config/model/test files. No `git reset`, `clean`,
commit, push, or deploy was performed.

Phase-21 implementation arrived as untracked files (kept as-is):
`src/api/users.test.ts`, `connections.test.ts`, `messages.test.ts`,
`integration.flows.test.ts`, `messageRequests.ts`, `messages.ts`,
`notifications.ts`, `src/app/(candidate)/connections.tsx`,
`conversation/`, `user/`, `src/auth/sessionState.ts`,
`sessionState.test.ts`, `src/features/{people,notifications,messages,
conversation,connection,calls}/`, `src/lib/messageApiBaseUrl.ts`, plus
`message-service/` sources, `src/api/calls.ts`, `src/api/client.test.ts`.

No production data touched; no production migrations run.

### Auth/session fix (preserved)

`src/auth/sessionState.ts`: only a genuine 401 `not_authenticated` from
`GET /auth/me` clears the token; network/timeout/5xx preserve it with a
retry. Covered by `sessionState.test.ts` (green) and the full suite.

## 1. Service topology (actual, verified)

- Mobile app: `C:\mahaa` (`@mahajob/mobile`, Expo SDK ~57).
- Main API: `C:\mahaa\backend` → Docker `mahaa-api-1` on `0.0.0.0:8000`
  (DB `mahaa-postgres-1`).
- Message service: `C:\mahaa\message-service` → `message-service-app-1`
  on `0.0.0.0:8001` (DB `message-service-db-1`).
- Health `200` on both `/api/v1/health` endpoints (Mahaa API / Mahaa
  Message Service).
- Docker Desktop was down after a machine reboot mid-task; relaunched, all
  four containers `healthy` before validation.
- `adb devices -l` → empty throughout.

## 2. Root causes

### Bug 1 — People search shows no suggestions

Chain: `DashboardHeader.tsx` → `usePeopleSearch` (300 ms debounce, min 2
chars, per-term `queryKeys.userLookup(term)` keys so stale answers cannot
cross terms) → `lookupUsers` → `GET /users/lookup?query=…` → backend
`find_users` (`backend/app/services/lookup.py`).

Backend rule (by design): a **name** fragment only reaches accounts with
`profile_privacy.discoverable = true`; an **exact handle/public id**
resolves regardless; the caller is always excluded. Typing a name whose
owner never opted in (fresh/test accounts included) correctly returns `[]`,
rendered honestly as "No people match". No invented endpoint, no mock
list, no silent error→empty coercion (`isEmpty` requires `!isError`;
`users.test.ts` pins a 500 rejects rather than resolving `[]`).

**Working as designed; covered by regression tests.** Future "finds
nobody" reports should first check the target's `discoverable` flag.

### Bug 2 — Accept from Notifications does nothing visible

Wiring: `notifications.tsx` → `notificationAction`
(`connection_request` + `data.connection_id`) → `view.accept` →
`POST /connections/{id}/accept` → `useInvalidateNotifications()`
invalidates notifications list + unread count + `connectionsRoot` + the
messaging `conversations` list together. Double taps are no-ops; failures
keep the row with the server message; 409 reconciles. No backend change;
endpoint exists in `endpoints/connections.py`.

## 3. Files involved (no production-code edits this session)

Production code validated unchanged: `src/api/users.ts`, `connections.ts`,
`messages.ts`, `messageRequests.ts`, `notifications.ts`, `client.ts`
(`ownsSession` 401 isolation), `queryKeys.ts` + `queryBridge.ts` keys,
`src/features/people/*`, `src/features/home/DashboardHeader.tsx`,
`src/features/notifications/*`, `src/app/(candidate)/notifications.tsx`,
`messages.tsx`, `connections.tsx`, `conversation/[id].tsx`,
`user/[id].tsx`.

Regression tests (kept as-is): `src/api/users.test.ts` (6),
`connections.test.ts` (8), `messages.test.ts` (8),
`peopleSearchWiring.test.ts` (8), `acceptanceWiring.test.ts` (6),
`conversationNavWiring.test.ts` (9), `integration.flows.test.ts` (15
live: Flows A/B/C), plus `sessionState.test.ts`, `client.test.ts`.

## 4. Validation results

| Check | Command | Result |
|---|---|---|
| Phase-21 targeted | `node ./scripts/run-vitest.mjs src/api/users.test.ts src/api/connections.test.ts src/api/messages.test.ts src/features/people/peopleSearchWiring.test.ts src/features/notifications/acceptanceWiring.test.ts src/features/messages/conversationNavWiring.test.ts src/auth/sessionState.test.ts src/api/client.test.ts` | **PASS — 8 files, 74/74** |
| Live Flows A/B/C | `node ./scripts/run-vitest.mjs src/api/integration.flows.test.ts` | **PASS — 15/15** (first attempt hit signup `429 "Too many attempts"`; single retry after the window passed 15/15) |
| Full mobile suite | `npm test` | **PASS — 65 files, 1079/1079, exit 0** |
| Typecheck | `npm run typecheck` | **PASS, exit 0** |
| Lint | `npx eslint src --no-cache` | **Pre-existing findings only**: `AuthProvider.tsx:127` error (`set-state-in-effect`), `client.test.ts:135` warning (`array-type`). No Phase-21 file affected |
| Backend suite | `pytest -q --no-header` (default local config) | **PASS — 163 passed, 1220 skipped, exit 0** |
| Backend DB-heavy run | pytest vs shared dev DB (`_p21_dbtest.txt`) | 179 passed, **6 failed** — all assert whole-table counts (e.g. `len(messages) == 1` got 3) against the shared dev DB holding rows from live-integration runs; HTTP-level asserts pass; no backend endpoint/service file modified (`git diff` empty there). Environmental |
| Android build | `cd android; ./gradlew.bat assembleDebug` | **PASS — BUILD SUCCESSFUL in 1m 14s, 458 tasks** (`_p21_build.log`) |
| Device flows A/B/C | `adb devices -l` | **BLOCKED — empty device list; emulator `mahajob_api36` exists but none attached** |

## 5. Acceptance criteria

- Search shows real matching users (per discoverable/exact-handle rule):
  **PASS**. Accept updates backend + all affected UI: **PASS**. Tap
  opens the correct conversation: **PASS**. Tests + typecheck green:
  **PASS**. Android build succeeds: **PASS**. Device verified or blocked
  with reason: **BLOCKED** (no device attached).

## 6. Limitations / blockers

1. No attached device/emulator: Flows A/B/C verified at unit + live-API
   level only, not on hardware.
2. Lint keeps the two pre-existing findings above (out of Phase-21 scope).
3. DB-heavy backend tests fail only vs the shared dev DB with leftover
   rows; default config passes.
4. No commits, pushes, deploys, production migrations, or production data
   access occurred.


### Bug 3 — Messages → All → person opens the wrong screen

Contract: `/conversation/[id]` is keyed by the **server conversation id
only**. All rows navigate with `conversation.id` from
`GET /conversations`; Connections "Message" posts
`POST /conversations {user_id}` and navigates in `onSuccess` with the
returned id; failures never navigate. The screen loads
`fetchConversation` + `listMessages` by that id with loading / honest
missing-id / error+retry semantics.
