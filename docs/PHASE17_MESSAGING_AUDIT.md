# PHASE 17 — MahaJob Messaging System Audit

## 2. Root causes — people search (registered users cannot be found by name)

### Bug 1 — Name search excludes nothing about account status

`backend/app/api/v1/endpoints/users.py` `GET /users/lookup` → `lookup_service.find_users(session, current_user, query)` in `backend/app/services/lookup.py`.

**Root cause:** `find_users` filters on `User.id != viewer.id` plus (name → discoverable account / exact handle → any account). It does **not** filter on `User.status`, so a suspended or deactivated account can still be returned by name. The module's own docstring admits this: *"A suspended or deactivated account can still be found; nothing here filters on status, because §5.2 does not ask for it."*

**PHASE 17 requirement:** exclude deleted, suspended, or otherwise ineligible accounts → add `User.status == UserStatus.ACTIVE` to the `find_users` statement. `UserStatus` (`ACTIVE` / `SUSPENDED` / `DEACTIVATED`) lives in `backend/app/models/enums.py`; `User.status` is the column.

### Bug 2 — No other root cause found in search

Everything else in the people-search chain is already correct:

- Main search bar component: `src/features/home/DashboardHeader.tsx` (compact pill → expanded `TextInput`, in-place expansion).
- Search handler: `src/features/people/usePeopleSearch.ts` → `lookupUsers` → `GET /users/lookup?query=…`.
- Debounce: 300 ms, min 2 chars.
- Per-term React Query keys (`queryKeys.userLookup(term)`) prevent stale responses from replacing newer results.
- Self excluded: `excludeSelf(lookup.data, selfPublicId)`.
- Safe public fields only: `UserSummary` (`user_id`, `public_id`, `username`, `name`, `role`, `avatar_url`) — no email/phone/token.
- Authentication required (`CurrentUser` dependency); error/loading/empty/retry states rendered in `DashboardHeader.tsx`.

No mock data, no invented endpoint.


Date: 2026-11-14
Repository: `C:\mahaa` (`@mahajob/mobile`, Expo SDK ~57, React Native 0.86)
Status: **Audit complete — root causes documented below before changes.**

## Scope

Audit of the entire messaging workflow: people search, connection requests, notifications, messages, deployment topology, and delivery mechanism (installed-app / OTA vs rebuild).

## 1. Service topology (verified on disk)

| Component | Path | Port | Role |
|---|---|---|---|
| Mobile app | `C:\mahaa` | — | React Native + Expo Router; all messaging screens + API clients |
| Main API (backend) | `C:\mahaa\backend` | 8000 | `connections`, `conversations`/`messages`, `notifications`, `users/lookup` |
| Message service | `C:\mahaa\message-service` | 8001 | Independent `message_requests` table (permission-to-message workflow) |
| Postgres | backend + message-service containers | — | Each service owns its own DB |

Messaging REST traffic against the **main** backend goes through `GET /users/lookup`, `POST /connections`, `POST /conversations`, `GET /conversations/{id}/messages`, `GET /notifications`, `GET /notifications/unread-count`. Message-request traffic goes to `message-service` on `:8001`.

No WebSocket is used for V1 messaging; the backend explicitly rejects WebSocket for V1 (Render free plan spins down idle sockets; LiveKit owns realtime). Polling via `?since=` is the documented transport, and the mobile realtime bridge invalidates query keys on socket events where a socket exists.

## 3. Root causes — connection request workflow

No root cause found — the workflow is fully implemented and server-enforced:

- Send: `POST /connections` body `{user_id}` → `connections.send_request`.
- Persisted: `Connection` table (`requester_id`, `addressee_id`, `status`, `responded_at`), one row per pair (`LEAST`/`GREATEST` unique index).
- Duplicate prevention: a pending request from caller → 200 same record; declined/canceled → revived; accepted → 409 `_already_connected()`.
- Already accepted: `send_request` raises 409 when `existing.status is ACCEPTED`.
- Incoming/outgoing state: `is_outgoing` computed server-side from `requester_id == viewer.id`; client reads it, never guesses.
- Self-accept blocked: `find_participant` requires the viewer be a participant; `accept` requires `row.addressee_id != viewer.id`, else 404.
- Recipient-only accept/reject: `accept`/`decline` check `row.addressee_id == viewer.id`; requester gets the same 404 as a missing id (anti-enumeration).
- Repeated actions safe: `_move_to` is idempotent (already-in-target → no-op same record; non-pending → 409).
- Transactions: `_persist` / `_move_to` stage the notification inside the same `session.commit()` as the connection row — row and notification land together or not at all.

## 4. Root causes — notification workflow

No root cause found — fully implemented:

- Created server-side only (no create route; side effect of connection/messaging operations).
- On request send: `notifications.emit(..., recipient_id=addressee_id, ..., type=CONNECTION_REQUEST, data={connection_id})` — staged inside the send transaction, committed together.
- Recipient is the addressee (User B) — never the sender (User A). Neither actor nor recipient is a request field, so neither can be spoofed.
- Bell badge: `GET /notifications/unread-count`, hidden at zero, capped at `9+`.
- Accept/Reject actions on `connection_request` rows via `data.connection_id`; resolution invalidates notifications list + count + connections + conversations together.
- Resolution notification: `connection_accepted` sent to the requester (roles reversed).

## 5. Root causes — messages workflow

No root cause found — fully implemented:

- Conversation creation: `POST /conversations {user_id}` → 403 if the two are not connected (an accepted connection is required; pending/rejected requests cannot open a thread).
- Participant-only access: `GET /conversations/{id}` and message endpoints answer 404 to non-members (anti-enumeration).
- Message persistence: `Message` table with `client_message_id` unique constraint for idempotent retries.
- History retrieval: keyset pagination `GET /conversations/{id}/messages` with `cursor`/`since`.
- Empty conversations and network errors: `StatusBanner` with inline server message + retry; toasts reserved for non-critical confirmations.
- Conversation list refresh after acceptance: `useInvalidateNotifications()` invalidates `messagingQueryKeys.conversations`; the realtime bridge marks `conversations` stale on socket events.
- Realtime: backend publishes `notification.created` / `message.new` events; mobile query bridge invalidates affected keys (REST remains authoritative).

## 6. Deployment / delivery mechanism

Frontend changes are pure TypeScript/React Native with **no new native modules** (existing deps only). They can be delivered to the currently installed app via **Expo OTA (`eas update`)** — no APK rebuild, no version/package/signing changes, no device reconnection.

Backend changes (the lookup status filter) require deploying to the existing Render service — only when deployment authorization and access are available. Local code + local tests do **not** constitute a production fix.

## 7. Files that will change (planned)

- `backend/app/services/lookup.py` — add `User.status == UserStatus.ACTIVE` filter (PHASE B).
- Backend test for lookup status exclusion (PHASE B/G).
- `docs/PHASE17_MESSAGING_AUDIT.md` — this document.
- `docs/PHASE17_MESSAGING_FINAL_REPORT.md` — final report (PHASE I).

No frontend file changes are expected because the people-search chain, connection workflow, notification workflow, and message workflow are all already wired end-to-end; the only server-side gap is the status filter in `find_users`.

## 8. Honest status (pre-change)

- Code-level (local): PARTIAL — workflow exists end-to-end; one server-side gap (status filter) to close.
- Production verification: BLOCKED — no deployed-environment access/credentials confirmed yet; no backend deployment performed.
- Installed-app delivery: SUCCESS-eligible — frontend is OTA-deliverable once code is ready; no rebuild required.
