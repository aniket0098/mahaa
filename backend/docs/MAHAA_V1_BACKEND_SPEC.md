# Mahaa V1 — Backend Technical Specification

**Status: DESIGN ONLY. Nothing in this document has been implemented.**
This file specifies what the Mahaa backend must provide for the V1 mobile
application. It creates no endpoint, no model, and no migration. Every route
marked *Proposed* below does not exist yet.

- **Backend inspected:** `C:\mahaa\backend`
- **Mobile inspected:** `C:\mahaa` (Expo SDK 57, expo-router, React Native 0.86.3)
- **Infrastructure:** FastAPI on Render (`mahaa-backend`, free plan, Singapore),
  PostgreSQL on Neon, LiveKit planned
- **Date of inspection:** based on repository HEAD `87fea2c`

---

## 0. Executive summary — the single most important fact

**The backend is a scaffold with exactly two routes. The mobile app already
assumes dozens more.**

`backend/app/api/v1/router.py` includes exactly one module:

```python
from app.api.v1.endpoints import health
api_router = APIRouter()
api_router.include_router(health.router)
```

| Route | State |
|---|---|
| `GET /api/v1/health` | **Exists** |
| `GET /api/v1/ready` | **Exists** |
| Everything else | **Does not exist** |

`app/models/`, `app/schemas/` and `app/services/` are empty packages.
`alembic/versions/` contains only `.gitkeep` — **there is not a single migration
revision in the repository**, so the database currently has no application tables
regardless of what `alembic upgrade head` reported.

The mobile app meanwhile ships API modules, TypeScript contracts, and a live
integration test suite written against a **previous** backend tree (`apps/api/`)
that has since been deleted. Those modules are this specification's most
reliable source of truth, because they encode exact paths, methods, field names
and status codes that the new backend must honour. Where the mobile code and this
document's brief disagree, the mobile code wins and the difference is called out.

> **Naming caution.** The mobile code refers to the deleted backend as
> `apps/api/…`. In this repository the backend lives at `backend/app/…`. This
> document uses `backend/app/…` for real paths and preserves the
> `apps/api/app/…` prefix only when quoting a mobile comment verbatim.

---

## 1. Target architecture

```text
                    ┌──────────────────────┐
                    │    Mahaa Mobile App  │
                    │ React Native / Expo  │
                    └──────────┬───────────┘
                               │
                         HTTPS / REST
                               │
                               ▼
                    ┌──────────────────────┐
                    │   Mahaa Backend      │
                    │ FastAPI / Render     │
                    └──────────┬───────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
                ▼                             ▼
       ┌─────────────────┐          ┌─────────────────┐
       │ Neon PostgreSQL │          │    LiveKit      │
       │ persistent data │          │ realtime media  │
       └─────────────────┘          └─────────────────┘
```

### 1.1 Responsibilities

**Mobile app (already built, treat as the client contract)**
Owns presentation, local device state, secure token storage (iOS Keychain /
Android Keystore via `expo-secure-store`), navigation, and the `react-query`
cache. It owns **no** business rules that the server also owns — in particular it
never computes profile completeness and never renders an unread count the server
did not supply.

**FastAPI backend**
Owns authentication and authorization; owns users, profiles, connections,
messages, call metadata, posts, stories, notifications, and the career domain.
It is the only component that decides who may read or write what. It never
transports audio or video and never stores media bytes in a way that leaks them.

**PostgreSQL (Neon)**
Stores application state. Single source of truth for accounts, profile records,
relationships, message history, call records, feed content and notifications.
Accessed only through SQLAlchemy 2 and Alembic. Binary media is *not* stored here
(see §11).

**LiveKit**
Handles realtime audio/video **transport** only: rooms, participant connections,
and media flows. It knows nothing about Mahaa's authorization rules.

### 1.2 Non-negotiable boundaries

- **PostgreSQL stores application state.** Call records, message bodies, and feed
  content are rows. Media binaries and call media are not.
- **FastAPI owns authentication and authorization.** No route trusts a user id,
  role, or ownership claim supplied by the client.
- **FastAPI owns user, profile, connection, message and call metadata.**
- **LiveKit handles realtime audio/video transport.**
- **LiveKit credentials must never be exposed to the mobile app.**
---

## 2. Backend areas inspected

| Path | Finding |
|---|---|
| `app/main.py` | `create_app()` factory; CORS (`allow_credentials=False`); request-id middleware; four exception handlers; router mounted at `settings.api_prefix` |
| `app/core/config.py` | `Settings(BaseSettings)`; DSN normalisation; fail-closed production validator; `lru_cache`d `get_settings()` |
| `app/core/errors.py` | `ErrorCode`, `DEFAULT_MESSAGES`, `error_payload`, `ApiError` |
| `app/core/logging.py` | `JsonFormatter`, idempotent `configure_logging` |
| `app/api/v1/router.py` | Includes `health` only |
| `app/api/v1/endpoints/health.py` | `/health`, `/ready` |
| `app/db/base.py` | `Base(DeclarativeBase)` — no models registered |
| `app/db/session.py` | Engine with `pool_pre_ping=True`, `pool_size=5`; `session_scope`; `get_db`; `ping_database` |
| `app/models/`, `app/schemas/`, `app/services/` | **Empty packages** |
| `alembic/env.py` | URL from settings, `-x db_url=` override, `compare_type`/`compare_server_default` |
| `alembic/versions/` | **`.gitkeep` only — no revisions** |
| `tests/test_health.py` | Health/readiness + error envelope + fail-closed config assertions |
| `requirements.txt` | fastapi, uvicorn, pydantic, pydantic-settings, sqlalchemy, alembic, psycopg 3, pytest, httpx, ruff |
| `.env.example` | Stale: still claims Render supplies `DATABASE_URL` via `fromDatabase` |
| `render.yaml` | Service only; no `databases:`; `DATABASE_URL: sync: false` |
| `backend/README.md` | Self-describes as "scaffold only" |

## 3. Mobile areas inspected

`src/api/` (client, auth, users, profile, onboarding, connections, posts, stories,
media, opportunities, company, institutions, resumes, health, errors, queryKeys,
queryClient, integration tests) · `src/auth/` (AuthProvider, RoleGuard, tokenStorage,
roleHome) · `src/config/navConfig.ts` · `src/types/` (api, auth, profile, onboarding,
opportunity, story, company, resume) · `src/features/` (feed, stories, profile, home,
connection, stages, onboarding, settings) · `src/lib/` (env, apiBaseUrl, passwordRules,
localMedia) · `src/app/` (all routes) · `docs/feed-api-contract.md` · `AGENTS.md`.

### 3.1 What the mobile code has decided (binding constraints)

1. **One HTTP client** — `src/api/client.ts`. Bearer attached unless `auth:false`.
2. **15-second default timeout**, 8s for health probes.
3. **A `401` from any request clears the token** and fires an unauthorized
   listener that demotes the session. The backend gets no second chance to be
   "unauthorized but fine".
4. **`204` responses are handled** (`return undefined as T`).
5. **Errors must use the envelope** in §15 or the client falls back to
   `invalid_response` and shows a generic sentence.
6. **No WebSocket client exists.** No `ws://`, no socket library in
   `package.json`. Messaging delivery is therefore unspecified on the client.
7. **No LiveKit client SDK is installed.** `package.json` has no `livekit-client`
   or `livekit-react-native`. No call screen exists.
8. **Three roles**: `candidate`, `employer`, `college` (plus a non-self-registerable
   `admin`). `RoleGuard` bounces cross-role deep links.
9. **Password rules**: min 8, max 128, ≥1 letter, ≥1 digit — asserted by
   `src/lib/passwordRules.test.ts` for parity with the server.
10. **Two different pagination envelopes** are already consumed (§17).

  `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` live only in the Render dashboard.
  The backend mints short-lived, per-user, room-scoped access tokens and returns
  only the token and the room name.
---

## 4. Authentication specification

> **Scope warning.** Only three auth routes are referenced by mobile code today:
> `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`. The brief's additional
> endpoints (`verify-email`, `refresh`, `logout`, `forgot-password`,
> `reset-password`) are **all Proposed**, and one of them is actively
> contradicted by the current client contract — see §4.8 before implementing.

### 4.1 `POST /api/v1/auth/signup` — Proposed (mobile already calls it)

| Aspect | Specification |
|---|---|
| Auth | None (`auth: false` on the client) |
| Request | `{ name, email, password, phone?, role }` |
| Validation | `name` non-empty; `email` valid and normalisable; `password` per §4.9; `role ∈ {candidate, employer, college}`; **`extra="forbid"`** |
| Response | `201` + `TokenResponse` |
| Errors | `409` duplicate email (human-readable message); `422` field-level |

The client sends exactly `{name, email, password, phone, role}` and sends `phone`
as explicit `null` when blank. A server schema that forbids `phone` will 422 an
otherwise valid signup.

`TokenResponse` is fixed by `src/types/auth.ts`:
```ts
{ access_token: string; token_type: string; expires_in: number }
```
**There is no `refresh_token` field.** See §4.8.

Server-assigned identity fields the client already expects: `public_id`
(permanent, immutable), `username` (searchable handle, changeable with password +
cooldown), `role`, `memberships[]`.

### 4.2 `POST /api/v1/auth/login` — Proposed (mobile already calls it)

| Aspect | Specification |
|---|---|
| Auth | None |
| Request | `{ email, password }` |
| Response | `200` + `TokenResponse` |
| Errors | `401` `invalid_credentials`; `423` suspended; `403` unverified (if verification ships) |

`401` must use the shared envelope with `code: "invalid_credentials"`. This code
already exists in the mobile vocabulary (`src/api/errors.ts`) but **not** in
`ErrorCode` — see §24.3.

A wrong password and an unknown email must produce the **identical** response,
byte for byte, so the endpoint cannot enumerate accounts. The message must be
written for a person, not a log parser.

### 4.3 `GET /api/v1/auth/me` — Proposed (mobile already calls it)

Resolves the session. Returns `Principal`:
`{id, public_id, username, name, email, role, designation?, memberships[]}`.
`memberships[]` carries `{company_id, company_name, role, status}`.

A `403` here demotes the session to `forbidden` (distinct from `unauthenticated`),
which drives the employer/college tree selection. This is load-bearing behaviour
in `AuthProvider`.

### 4.4 `POST /api/v1/auth/logout` — Proposed, no client caller
### 4.5 `POST /api/v1/auth/refresh` — Proposed, **conflicts with the client**

Required only for token rotation. The mobile `TokenResponse` has no
`refresh_token` field, and `apiClient` attaches the same single token to every
request. Implementing refresh requires a mobile change first. See §24.3.

### 4.6 `POST /api/v1/auth/verify-email` — Proposed, no client caller

The mobile client documents the current stack as having **no email verification**
(`src/api/users.ts`: "this stack has no email verification") and relies on a
password confirmation to change `email`. Adding verification is a product
decision, not a free addition.

### 4.7 `POST /api/v1/auth/forgot-password` + `POST /api/v1/auth/reset-password` — Proposed

`src/app/reset-password.tsx` is an explicit honest notice: it deliberately does
**not** render a form, because a form that accepts an address and silently does
nothing is worse than an honest "not yet". The route is registered and linked from
`login.tsx`. Building the backend endpoints unblocks this screen.

### 4.8 Token strategy — decision required

**Recommended for V1: single short-lived access token, no refresh token.**

Rationale: it is the only design the current mobile contract can consume without
a client change. Cost: a signed-out experience when the token expires.

If refresh is chosen instead, these changes are required (documented, **not**
implemented): add `refresh_token` to `TokenResponse`; add a `src/api/auth.ts`
refresh function with single-flight de-duplication; queue and replay failed
requests once; keep the secure store keyed on the refresh token so a stolen access
token alone is short-lived.

**Either way**: LiveKit room tokens (§8) are *separate* short-lived tokens minted
per call and never persisted as the session token.

### 4.9 Password hashing

Argon2id. No password library is in `requirements.txt` today, so `argon2-cffi`
must be added as a dependency before any account can exist.

- Algorithm: Argon2id
- Parameters: OWASP baseline — m=19456 KiB (19 MiB), t=2, p=1
- Salt: unique per password, random
- Verification: constant-time comparison only
- Migration: store an algorithm tag so a future rehash-on-login is possible
- Never log, return, or include a hash in any error detail

**Free-tier caveat, documented not solved:** Render's free instance is a small
container. Argon2id at 19 MiB × concurrency can exhaust memory. Parameters must be
measured on the actual free instance before launch; `m=19456` may need lowering
there. This is a real risk, which is why these are stated as a baseline.

### 4.10 Rate limiting

Per-IP and per-account, on a shared store (a free instance's in-process
dictionary does not survive redeploy and is per-instance).

| Operation | Suggested limit |
|---|---|
| `POST /auth/login` | 5 / minute / account, 20 / hour / IP |
| `POST /auth/signup` | 3 / hour / IP |
| `POST /auth/forgot-password` | 3 / hour / email, 10 / hour / IP |
| `POST /auth/reset-password` | 5 / attempt / token |
| Everything authenticated | generous baseline |

`ErrorCode.RATE_LIMITED` and a 429 default message already exist. Set `Retry-After`.

### 4.11 Account status

`users.status` ∈ `active | suspended | deactivated`. The client already models a
soft pause: `POST /users/me/deactivate` returns the updated account and signing in
again reactivates it. `DELETE /users/me` is irreversible and requires **both** the
password and a typed `DELETE` confirmation string.

### 4.12 JWT claims

```json
{
  "sub": "<user uuid>",
  "role": "candidate|employer|college|admin",
  "public_id": "MJ-XXXXXXXX",
  "type": "access",
  "iat": 0, "exp": 0, "jti": "<uuid>"
}
---

## 5. Users and profile

### 5.1 The aggregate read (already assumed by mobile)

`GET /profile` returns **one round trip** carrying:
`{identity, privacy, completeness, education[], experience[], projects[],
certifications[], achievements[], links[], skills[], preferences|null}`.

This is the most load-bearing contract in the profile domain: the profile screen
calls exactly this. `preferences` is `null` when never set — distinct from an
empty object.

### 5.2 Endpoint classification

Legend: **[M]** already required by mobile code · **[V1]** required for V1 ·
**[F]** optional/future.

| Endpoint | Class | Notes |
|---|---|---|
| `GET /users/me` | **[M]** | `Me`: id, public_id, username, name, email, phone, role, designation, avatar_url, created_at |
| `PATCH /users/me` | **[M]** | `email`/`username` changes require `current_password` |
| `DELETE /users/me` | **[M]** | Body `{password, confirmation}`; irreversible |
| `POST /users/me/password` | **[M]** | `{current_password, new_password}` |
| `POST /users/me/deactivate` | **[M]** | Soft pause; returns updated `Me` |
| `GET /users/me/username/availability?username=` | **[M]** | `{username, available}` |
| `GET /users/lookup?query=` | **[M]** | Bare array (no envelope); name search only reaches discoverable accounts; exact handle/public_id resolves regardless |
| `GET /users/{public_id}` | **[M]** | `PublicProfile`, privacy-filtered |
| `PUT /users/me/photo?kind=image` | **[M]** | Raw body upload; returns updated `Me`; **replaces** in place |
| `DELETE /users/me/photo` | **[M]** | Returns updated `Me` |
| `GET /profile` | **[M]** | Aggregate, §5.1 |
| `PATCH /profile` | **[M]** | Identity fields only: headline, summary, location, interests |
| `GET /profile/completeness` | **[M]** | Server-derived `{percent, sections[]}`; **never** computed on the client |
| `GET /profile/privacy` · `PUT /profile/privacy` | **[M]** | `PUT` is **full state**, not a patch; `extra="forbid"` |
| `GET /profile/preferences` · `PUT /profile/preferences` | **[M]** | `PUT` full state; read before write or lists are erased |
| `GET/POST /profile/skills`, `PATCH/DELETE /profile/skills/{id}` | **[M]** | `Page<CandidateSkillRead>` |
| `GET/POST/PATCH/DELETE /profile/education[/{id}]` | **[M]** | `Page<EducationRead>` |
| `GET/POST/PATCH/DELETE /profile/experience[/{id}]` | **[M]** | `Page<ExperienceRead>` |
| `GET/POST/PATCH/DELETE /profile/projects[/{id}]` | **[M]** | `Page<ProjectRead>`; create accepts `skill_ids[]` |
| `GET/POST/PATCH/DELETE /profile/certifications[/{id}]` | **[M]** | Written by section screen |
| `GET/POST/PATCH/DELETE /profile/achievements[/{id}]` | **[M]** | `category` is a closed 6-value union, required on create |
| `GET/POST/PATCH/DELETE /profile/links[/{id}]` | **[F]** | Read inside the aggregate; no mobile API module writes them |
| `GET /skills/catalog?q=&limit=&offset=` | **[M]** | Database-backed catalogue, never a client list |
| `GET /onboarding/state` | **[M]** | `{role, state, percent, next_step, steps[]}`; single authority for wizard position |
| `GET /profile/skills/{id}` (single read) | **[F]** | Not called by mobile |

### 5.3 Privacy semantics (load-bearing)

`PublicProfile` uses **absent** fields, not `null`, when the viewer is not allowed
past the owner's setting. "Not shown" and "shown and empty" are different claims
and the client renders them differently. Returning `null` for withheld fields
breaks that distinction.

Privacy fields: `profile_visibility ∈ {private, employers, public}`, `discoverable`,
`allow_messages`, `show_email`, `show_phone`.

### 5.4 Profile completeness

Weighted, server-derived, section-keyed: `{key, label, weight, earned, complete,
hint}[]` plus a `percent`. The client treats the server as authoritative and
`AGENTS.md` forbids computing it client-side. It must never be a constant.

### 5.5 Enumerated vocabularies the client already depends on

- `SkillLevel` = `beginner | intermediate | advanced | expert`
- `ProfileVisibility` = `private | employers | public`
- `AchievementCategory` = `competition | award | academic | hackathon | publication | leadership`
---

## 6. Connections

**Important deviation from the brief.** The brief lists
`POST /connections/{id}/reject`. The mobile client calls
**`POST /connections/{id}/decline`** and names it `declineConnection`. The
database enum value is `declined` (not `rejected`). The mobile naming wins; a
`/reject` route would be a second, unused path.

| Endpoint | Class | Notes |
|---|---|---|
| `GET /connections?status=` | **[M]** | Bare array (no envelope) |
| `POST /connections` | **[M]** | Body `{user_id}` — the **internal** id from `/users/lookup` |
| `POST /connections/{id}/accept` | **[M]** | Addressee only |
| `POST /connections/{id}/decline` | **[M]** | Addressee only (**not** `reject`) |
| `POST /connections/{id}/cancel` | **[M]** | Requester only |
| `DELETE /connections/{id}` | **[M]** | Remove an accepted connection; either participant |
| `GET /connections/requests` · `GET /connections/sent` | **[F]** | `GET /connections?status=` already covers both via `is_outgoing` |

### 6.1 State machine

```text
                 POST /connections
                          │
                          ▼
                     ┌─────────┐
                     │ pending │
                     └────┬────┘
          accept ────────┼──────── decline
             │           │           │
             ▼           │           ▼
      ┌────────────┐     │     ┌──────────┐
      │  accepted  │     │     │ declined │  (terminal)
      └─────┬──────┘     │     └──────────┘
   DELETE   │  cancel    │
      │     ▼            │
      │  ┌───────────┐   │
      └─▶│ cancelled │◀──┘
         └───────────┘
```

Client enum: `'pending' | 'accepted' | 'declined' | 'canceled' | 'removed'`.
Note the spelling difference — the enum uses **one** `l` (`canceled`), matching
US convention, while the route verb is `cancel` and the action is `decline`.
`removed` is a projection for a deleted connection, not necessarily a stored row.

### 6.2 Rules

- **Self-connection is impossible.** A check plus a DB constraint.
- **Duplicate requests are impossible** in either direction. The pair
  `(requester, addressee)` must be unique regardless of status, so a re-request
  after a decline must either revive the existing row or follow an explicit
  documented rule. Recommended: **revive** the same row (reset to `pending`,
  clear `responded_at`) so history is not fragmented.
- **Every action is participant-scoped server-side.** A request that is not the
  caller's answers **404**, not 403. This is deliberate: a stale list row should
  be shown as removed rather than retried, and a 403 would leak existence.
- **`is_outgoing` decides which buttons the UI may render.** The server sends it
---

### 6.3 Notification side-effects

Accepted/declined/cancelled should each emit a notification (§13) to the other
party. These are the first notification types the platform can actually produce,
which makes connections the natural first integration test for that domain.

- `EducationLevel` = `school | diploma | undergraduate | postgraduate | doctorate | other`
- `WorkMode` = `remote | hybrid | onsite`
- `OpportunityType` = `job | internship | apprenticeship | project_gig`
- `EmploymentType` = `full_time | part_time | internship | contract`
- `CompPeriod` = `hour | month | year`
- `UserRole` = `candidate | employer | college | admin`
- `SignupRole` = `candidate | employer | college` (`admin` never self-registerable)

```

- `sub` is the **internal** user id, never the public id and never the username.
- `role` is embedded so authorization does not need a database read per request.
- `jti` permits future revocation lists.
- Algorithm pinned to one family; `alg` from the token must never be trusted.
- Expiry: 30–60 minutes recommended. Any value is a product decision, not a
  technical one.

Currently the app signs out by clearing local storage only. A server-side logout
endpoint is required **if and only if** refresh tokens are revocable (§4.8).
With stateless access tokens it is a no-op and should not be built.

## 7. Messaging

### 7.1 Current state: nothing exists

- No `src/api/messages.ts` or `conversations.ts` module.
- No backend router.
- `src/app/(candidate)/messages.tsx` and `src/app/(employer)/employer/messages.tsx`
  are both `StageScreen` notices ("Stage 8 — messaging").
- **No WebSocket client is installed** and no socket URL is configured anywhere.

### 7.2 Decision: transport

**Recommended: REST for V1 delivery, with a documented read-poll, and a
transport-agnostic message model.**

Why not WebSocket yet:

1. The client has no WebSocket capability whatsoever — this is a client change
   plus a dependency plus a reconnection strategy plus background behaviour on a
   phone.
2. Render's **free** plan spins down when idle. A long-lived WebSocket both keeps
   the instance awake and is the first thing dropped when it does. A stateless
   REST API degrades far more gracefully here.
3. LiveKit already supplies the realtime path that genuinely needs it (media).
   Adding a second realtime transport doubles the operational surface for V1.

V1 delivery: the app polls `GET /conversations` for the list and
`GET /conversations/{id}/messages?since=` for new messages, with a 5–10s interval
while the thread is focused and none when it is not.

**The message model must not bake in polling.** Store a monotonic `id` and
`created_at`; the same model works unchanged when a WebSocket or SSE transport is
added later. This is the one design decision that keeps the transport reversible.

> If WebSocket is chosen instead, the required additions are: a socket library,
> an auth handshake (bearer in the first frame or a ticket endpoint), reconnect
> with backoff, and a Render-compatible single-instance or sticky-session
> constraint. None of that exists today.

### 7.3 Endpoints (all Proposed)

| Endpoint | Purpose |
|---|---|
| `GET /conversations` | List for the caller, newest activity first, with unread counts |
| `POST /conversations` | Open (or reuse) a 1:1 conversation with `{user_id}` |
| `GET /conversations/{id}` | Detail; members, last message |
| `GET /conversations/{id}/messages` | Page, oldest→newest within the page |
| `POST /conversations/{id}/messages` | Send; returns the stored message |
| `POST /conversations/{id}/read` | Mark read up to a point |
| `DELETE /messages/{id}` | Soft delete for the sender |

### 7.4 Rules

- **One-to-one only in V1.** A conversation is uniquely determined by the
  unordered pair of participants. Enforce with a unique constraint on a sorted
  participant key, or a deterministic lookup of the two `conversation_members`
  rows.
- **Group conversations are future.** The `conversation_members` join table is
  already the right shape for them, so the schema must not assume exactly two
  members even though the API does.
- **Authorization**: only members may read, write, or mark read. A non-member
  gets **404**, not 403, for the same anti-enumeration reason as connections.
- **Ordering**: `ORDER BY created_at, id`. Timestamps alone are not unique; the
  `id` tiebreak makes pagination stable.
- **Pagination**: keyset on `(created_at, id)` for stability under new inserts.
- **Read state**: `conversation_members.last_read_message_id` — a pointer, not a
  per-message boolean, so a read receipt costs one row update.
- **Blocked users**: if a block exists, the sender gets `403 forbidden` and no
---

### 7.5 `allow_messages` interaction

`profile_privacy.allow_messages` exists today. A `POST /conversations` against a
user who has disabled messages must be refused **before** a conversation row is
created — otherwise the sender learns the setting by trial.

  so the client never guesses whether it may offer Accept or Cancel.
- **Blocked users** are a `blocked_users` relationship (§13), not part of the
  connection state machine.

## 8. LiveKit call architecture

### 8.1 Current state

- **No LiveKit code exists anywhere in the repository.** A repo-wide search for
  `livekit` returns zero results.
- `livekit-client` / `livekit-react-native` are **not** in `package.json`.
- There is no call screen, no call route, and no call tab in `navConfig.ts`.
- `calls` is not in `queryKeys.ts`.

Every endpoint in this section is **Proposed**, and Phase 7 requires mobile work
before any of it is reachable.

### 8.2 Call lifecycle

```text
  created ──▶ ringing ──▶ accepted ──▶ active ──▶ ended
                 │                        │
                 ├──▶ rejected            ├──▶ failed
                 ├──▶ missed              └──▶ cancelled
                 └──▶ cancelled
```

`created` is a transaction boundary: the row is written before any LiveKit call,
so a crash between the two leaves a `created`/`ringing` record that a sweeper can
reconcile rather than a ringing call with no record.

### 8.3 Endpoints (all Proposed)

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /calls` | participant | `{receiver_id, conversation_id?, media:{audio,video}}` → `201` + call record |
| `POST /calls/{id}/accept` | callee only | `ringing → accepted` |
| `POST /calls/{id}/reject` | callee only | `ringing → rejected` |
| `POST /calls/{id}/end` | either participant | → `ended`; computes `duration` |
| `POST /calls/{id}/token` | participant only | **Mints a LiveKit access token.** Never the API secret |
| `GET /calls/{id}` | participant only | Current state |
| `GET /calls/history` | self only | Paginated; `?direction=incoming\|outgoing\|missed` |

### 8.4 Division of responsibility

**LiveKit owns:** the room, participant connections, audio and video transport,
adaptive streaming, and reconnect/quality behaviour.

**Backend owns:** who may call whom, whether a call is allowed at all, room
naming, token minting, the call state machine, ringing/push fan-out, and call
history.

**Neither owns:** the other's data. The backend stores call *metadata* only.

### 8.5 Token generation — the security core

```python
# Sketch only. NOT implemented.
token = AccessToken(api_key=LIVEKIT_API_KEY, ttl_minutes=10)
grant = VideoGrant(room_join=True, room=room_name,
                   can_publish=..., can_subscribe=True, can_publish_data=True)
token.add_grant(grant)
token.identity = str(user.id)      # internal id, so webhooks can be attributed
return token.to_jwt()              # signed with LIVEKIT_API_SECRET
```

Hard rules:

- `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are **never** sent to the client, in
  any response, in any error detail, or in any log line.
- Tokens are **short-lived** (≈10 minutes) and **room-scoped**.
- `identity` is the internal user id so LiveKit webhooks can be attributed.
- `POST /calls/{id}/token` returns **only** `{token, room_name, url, expires_at}`.
- A token is issued only to a participant of a call in
  `created|ringing|accepted|active`. Never for an ended call, never for a
  non-participant, never for a self-call.
- Validating a LiveKit **webhook** is a separate inbound path (HMAC over the raw
  body with the API secret) — it authenticates LiveKit *to* the backend, and must
  not be confused with token issuance.

### 8.6 Call record metadata

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Also the client-facing id |
| `caller_id` | FK users | NOT NULL |
| `receiver_id` | FK users | NOT NULL |
| `conversation_id` | FK conversations | **Nullable** — a call may precede a conversation |
| `room_name` | text | Unique. Server-generated, never client-supplied |
---

### 8.7 Never

- Never store audio or video binaries in PostgreSQL.
- Never store them anywhere the API serves without an ownership check.
- Never accept a client-supplied `room_name` and mint a token for it. That is an
  arbitrary-room-join vulnerability.

  message is stored. Never accept-then-hide.
- **Deleted messages**: soft delete (`deleted_at`). The row and its ordering
  position are preserved so the timeline does not shift; the body is replaced
  with a tombstone. Hard delete is a retention-policy decision (§13.4).
- **Duplicate prevention**: see §18.

## 9. Posts

### 9.1 Existing contract

`docs/feed-api-contract.md` is the only surviving backend design document and
describes an **implemented** posts/media stage against the deleted `apps/api`.
The mobile client is written to that contract. Treat `docs/feed-api-contract.md`
as normative for shape, and re-create the endpoints here.

| Endpoint | Class | Notes |
|---|---|---|
| `GET /posts?category=&limit=&offset=` | **[M]** | `PostPage` = `{items, total, limit, offset, has_more}` |
| `GET /posts/mine?limit=&offset=` | **[M]** | Own published posts; `total` must be a real count, not a page length |
| `POST /posts` | **[M]** | Returns the stored `WirePost`; the client renders only after `201` |
| `PATCH /posts/{id}` | **[M]** | Owner only; `{body?, title?}` |
| `DELETE /posts/{id}` | **[M]** | Owner only; **soft delete** |
| `GET /posts/{id}` | **[M]** | Feed contract lists it; not currently in `src/api/posts.ts` |
| `POST`/`DELETE /posts/{id}/like` | **[F]** | **No mobile caller.** `docs/feed-api-contract.md` says stage 2; like state is device-local today |
| `GET`/`POST /posts/{id}/comments` | **[F]** | **No mobile caller.** `CommentsSheet` shows an honest empty state |
| `POST`/`DELETE /posts/{id}/bookmark` | **[F]** | **No mobile caller.** Saves are device-local |
| `DELETE /comments/{id}` | **[F]** | Follows comments |
| `POST /posts/{id}/report` | **[F]** | Deliberately absent — no moderation queue exists |
| `GET /posts/{id}/share` | **Never** | Sharing is the OS share sheet; the client never mints a permalink |

### 9.2 Post shape (as the client parses it)

`{id, kind, category, title, body, media[], project|null, achievement|null,
tags[], created_at, updated_at, author{name, headline, avatar_url, verified,
is_self}}`.

- `category ∈ {projects, achievements, learning, community}`.
- `kind` is **derived server-side** from which payload is present, never accepted
  as a free string. The client sends it, but the server decides.
- `media[]` entries: `{id, kind, mime_type, width, height, duration_ms,
  size_bytes, uri, position}`. `width`/`height` **must be accurate** — the client
  sizes every image from them and never decodes an image itself.
- **Engagement counts are intentionally absent.** The card shows no number when
  the API returns none; that is a supported state, not a break.
- `author.verified` **must default to `false`** and require a real signal. The
  client renders a badge from this field and nothing else, so a wrong `true` is a
  false credential claim in production.
- `author.is_self` drives whether tapping the author opens `/profile`. The app has
  no other-user profile screen, so the client sets `profileHref: null` for
  another author.

### 9.3 Rules and limits

- Validation: `body ≤ 5000` chars, `title ≤ 200`, `≤ 20` tags, `≤ 10` media items.
- At least one of `body`, `media`, `project`, `achievement` must be present.
- `extra="forbid"` on write schemas, matching every other write path.
- **Ownership**: `PATCH`/`DELETE` answer 403 or 404 for another author's post —
  never success. Excluding a post from a private profile is better than returning
  it with hidden fields.
- **Soft delete** so a published post's position and its comments survive.
- **Moderation**: out of scope. No report endpoint, no queue, no ranking. The
  client deliberately shows no Report action, and inventing one server-side would
  create a dead-end for users.
- Pagination: `limit`/`offset` per the `PostPage` envelope (see §17 for why this
  differs from `/stories`).

---

## 10. Stories

| Endpoint | Class | Notes |
|---|---|---|
| `GET /stories?page=&page_size=` | **[M]** | `FastApiPage<Story>` — `page`/`page_size`/`pages` |
| `GET /stories/{id}` | **[M]** | Single story for the viewer |
| `POST /stories/{id}/view` | **[M]** | Idempotent per viewer; returns `{story_id, viewed, already_recorded, viewed_at}` |
| `POST /stories` | **[F]** | **No mobile caller.** Stories are published server-side (platform/company) |
| `DELETE /stories/{id}` | **[F]** | No mobile caller |

### 10.1 Shape

`{id, content_type, caption, status, publisher{name, logo_url, verified, kind},
opportunity|null, viewed, created_at}`.

- `content_type ∈ {job, internship, announcement, event}`.
- `publisher.kind ∈ {company, platform}` — this is why the app is described as a
  *student* feed: stories are recruiter/platform-published, not peer content.
- `opportunity` is a summary `{id, title, location, work_mode}` — a story is
  often an advertisement for an opportunity.
- `viewed` is **per viewer**, returned on the list, so the ring can render
  viewed/unviewed without a second request.
- `status ∈ {published, archived}`.

### 10.2 Expiration strategy
---

## 11. Media

### 11.1 Metadata vs binary — the distinction that matters

**1. Metadata lives in PostgreSQL.** One `media_assets` row per upload: id, kind,
mime type, dimensions, duration, byte size, owner, storage key, timestamps. This
is what `PostPage.media[]` embeds by reference.

**2. Binary storage is a separate concern.** `docs/feed-api-contract.md`
documents a deliberate prior decision: `storage_kind` / `storage_key` are reserved
columns so moving from database bytes to S3-compatible storage is *a
configuration change and a row, not a schema redesign*. That reasoning is
retained here.

A local disk mount was **explicitly rejected** before, and the reason still
holds: the API runs on an ephemeral host filesystem, so files would not survive a
redeploy, which would break the rule that a published post stays available. That
rules out Render's local disk for binaries on the free plan.

### 11.2 Endpoints

| Endpoint | Class | Notes |
|---|---|---|
| `GET /media` | **[M]** | **Limits, not a list.** `MediaLimits` — see §11.4 |
| `POST /media?kind=&width=&height=` | **[M]** | Raw body, `Content-Type` = the file's real type |
| `GET /media/{id}` | **[M]** | Bytes; **uploader only** |
| `PUT /users/me/photo?kind=image` | **[M]** | Raw body; returns updated `Me`; replaces in place |
| `DELETE /users/me/photo` | **[M]** | Returns updated `Me` |
| `DELETE /media/{id}` | **[F]** | Not in `src/api/media.ts`; referenced by the brief |
| `POST /media/{id}` (private document) | **[M]** | `uploadDocument(path, …)` — a private PDF (resume/certificate) |

### 11.3 Why raw body, not multipart

`POST /media` takes a **raw request body** with metadata in query parameters and
the file's real type in `Content-Type`. Two reasons, both already settled:

1. It keeps `python-multipart` out of the server's dependencies.
2. It lets the client use `expo-file-system`'s native upload task, which reports
   **genuine byte progress**. `fetch` cannot report upload progress at all, so a
   progress bar built on it would have to be a lie.

The client depends on this: `uploadRawFile` in `src/api/media.ts` sets
`uploadType: UploadType.BINARY_CONTENT` and consumes `bytesSent`/`totalBytes`.
Changing to multipart would break the progress bar on every upload screen.

The client's `uploadUrl` sends `kind=image` with `width`/`height`; the server must
accept those and **must not trust them** — re-derive dimensions from the bytes
where feasible, and reject a mismatch.

### 11.4 `GET /media` — limits, not a list

A genuine trap: this path returns a *limits document*, not a collection.
`MediaLimits` fields the client already reads:

`max_bytes`, `max_items_per_post`, `max_body_chars`, `image_mime_types[]`,
`video_mime_types[]`, `document_mime_types[]`, `max_document_bytes`,
`video_duration_enforced`.

`video_duration_enforced: false` is an honest signal: the server cannot yet
decode a duration, so the UI does not claim it does. It becomes `true` when a
decoder exists. **The server publishes these limits so the client never
hard-codes a copy** — a limit change must not require a client release.

### 11.5 Validation, ownership, and limits

- Images: PNG/JPEG/WebP, max 10 MB.
- Video: **max 30 seconds, enforced server-side by probing the file**, never by
  trusting a client-declared duration. Reject with a `422` that names the limit.
- Documents: PDF only, private, owner-only, lower ceiling than video.
- **Ownership**: `GET /media/{id}` serves bytes only to the uploader. This is why
  `authenticatedImageSource` attaches the bearer token to every `expo-image`
---

## 12. Career system

### 12.1 Opportunities — read-only for candidates in V1

| Endpoint | Class | Notes |
|---|---|---|
| `GET /opportunities?type=&work_mode=&q=&page=&page_size=` | **[M]** | `FastApiPage<Opportunity>` |
| `GET /opportunities/{id}` | **[M]** | Full detail incl. `requirements[]` and `company` |
| `POST /opportunities` · `PATCH`/`DELETE /{id}` | **[F]** | Employer job posting is an honest notice (`/employer/jobs/new` is `implemented: false`) |
| Applications (`GET /applications`, `POST /opportunities/{id}/apply`) | **[F]** | `/applications` is `StageScreen` ("Stage 6") |
| Saved/bookmarked opportunities | **[F]** | `/saved` is `StageScreen`; `is_saved` is optional and nullable |

The `Opportunity` type the client parses is fully specified in
`src/types/opportunity.ts`, including `is_saved?` and `my_application_id?` as
**optional and nullable** — so the server may omit them entirely. Making either
non-nullable would break the client type.

Filters the client sends: `type`, `work_mode`, `q`, `page`, `page_size`. Search is
`q` against title/description. `/opportunities/{id}` is a real screen
(`/jobs/[id]`, `implemented: true`).

### 12.2 Companies — membership-based, and the client is already built

| Endpoint | Class | Notes |
|---|---|---|
| `GET /companies/mine` | **[M]** | Bare array of `MyCompanySummary`; role resolved from the token |
| `POST /companies` | **[M]** | Creator becomes `owner` **server-side, atomically** |
| `GET /companies/{id}` | **[M]** | `CompanyRead` |
| `PATCH /companies/{id}` | **[M]** | `slug` and `verification_status` are **server-owned** and absent from the update schema |
| `POST /companies/{id}/verification-request` | **[M]** | Moves status to `pending`, returns the server's own `note`. **Request-only in V1** |
| `GET /companies/{id}/members` | **[M]** | Bare array; must include the `owner` |
| `POST /companies/{id}/members` | **[M]** | Invites an **existing** employer account by email; creates membership as `invited` |
| `PATCH /companies/{id}/members/{member_id}` | **[M]** | Role/status change |
| `DELETE /companies/{id}/members/{member_id}` | **[M]** | Remove |
| `POST /companies/{id}/members/me/accept` | **[M]** | Accept your own pending invite |
| `GET /companies` (public directory) · `GET /companies/{id}/jobs` | **[F]** | No mobile caller |

**Two hard constraints, both already asserted by the mobile integration test:**

1. **An invite can never mint an owner.** `InvitableRole` excludes `owner`;
   ownership changes only through a role change on an existing member.
2. **A non-member gets `404`, not `403`,** so membership is not enumerable.
   Conversely a **candidate hitting a company route gets `403`** — the
   integration suite asserts exactly this asymmetry
   (`refuses candidate access to employer company routes`).

**No email is sent for an invite in V1.** The membership is created as `invited`
and the invitee accepts while signed in, so the UI must not say "invitation
sent". The client already handles this correctly.

### 12.3 Institutions — the college workspace, fully built

| Endpoint | Class | Notes |
|---|---|---|
| `GET /institutions/mine` | **[M]** | `{institution, program_count}` — a **real `COUNT`** |
| `POST /institutions` | **[M]** | Registering contact person becomes owner server-side |
| `GET /institutions/{id}` | **[M]** | `Institution` |
| `PATCH /institutions/{id}` | **[M]** | `slug`/`verification_status` server-owned |
| `POST /institutions/{id}/verification-request` | **[M]** | Request-only; returns `pending` + server `note` |
| `GET /institutions/{id}/programs` | **[M]** | Bare array |
| `POST /institutions/{id}/programs` | **[M]** | `{name, level?, description?}` |
| `PATCH /institutions/{id}/programs/{program_id}` | **[M]** | |
| `DELETE /institutions/{id}/programs/{program_id}` | **[M]** | |
| `GET /institutions` (public directory) | **[F]** | No mobile caller |

**Every route is ownership-scoped**: the registering contact person owns the
institution and anybody else gets `404`. The client therefore never sends an
---

### 12.4 Resumes — server-generated snapshots, no upload

`src/api/resumes.ts` is unambiguous: a "resume" is a **server-generated frozen
version** of structured profile data. There is no PDF generation and the client
never submits snapshot content — only `{label, is_default}`.

| Endpoint | Class | Notes |
|---|---|---|
| `GET /resumes` | **[M]** | Bare array of `ResumeSummary` (no snapshot body) |
| `GET /resumes/{id}` | **[M]** | `ResumeDetail` = summary + `snapshot` |
| `POST /resumes` | **[M]** | `{label, is_default}`; snapshot built server-side from the profile as it stands |
| `PATCH /resumes/{id}` | **[M]** | `{label?, is_default?}` |
| `DELETE /resumes/{id}` | **[M]** | |
| Resume PDF download | **Never in V1** | No client caller; would need a renderer dependency |

`source_profile_updated_at` is captured at snapshot time so a resume can report
how stale it is.

  source — a post image is **not** a public URL.
- A served path is relative (`/api/v1/media/{id}`) and joined onto the configured
  base URL by `absoluteMediaUri`. Never hard-code a host.
- Media must be served over HTTPS.

> **Stale line in `docs/feed-api-contract.md` (§"Media"):** it says the app
> fetches media with `expo-image` "(no `Authorization` header), so a private
> asset store needs signed URLs". The current client code **does** attach the
> header (`authenticatedImageSource`), and `src/api/media.ts` documents
> uploader-only reads. The client is the source of truth; the doc line is stale.
> Flagged, not fixed (§25).

`GET /stories` returns **active** stories only; the client sends no date filter,
so the server owns the window.

Recommended: `stories.expires_at timestamptz NOT NULL`, and the list query
filters `expires_at > now()`. Explicit column rather than deriving
`created_at + interval '24h'`, because a per-story window is then adjustable
without a migration, and because an index on `(expires_at)` is then usable.

Retention, stated separately from visibility: rows may be **deleted** after a
retention period (e.g. 30 days) by a periodic job, because `story_views` rows
accumulate quickly. Deleting a story cascades its views.

`POST /stories/{id}/view` must be **idempotent**: re-viewing returns
`already_recorded: true` with the original `viewed_at` and does not insert a
second row. Enforced by a unique constraint on `(story_id, viewer_id)`.

Privacy: a story is visible to any authenticated candidate. There is no
per-viewer story ACL in V1, so `story_views` is a plain join table with no
privacy semantics of its own.

Ownership: `publisher.kind` determines authority — a `company` story is written
by the platform or by that company's membership; a `platform` story is written by
an admin. Neither is writable by the client today.

| `status` | enum | `created, ringing, accepted, active, ended, rejected, missed, cancelled, failed` |
| `media_kind` | enum | `audio \| video` |
| `created_at` | timestamptz | NOT NULL |
| `accepted_at` | timestamptz | Nullable |
| `started_at` | timestamptz | Nullable — media actually flowing; differs from `accepted_at` |
| `ended_at` | timestamptz | Nullable |
| `duration_seconds` | int | Computed at end; NULL while in flight |
| `end_reason` | text | Nullable, diagnostics only |

Indexes: `(receiver_id, created_at DESC)` for the incoming list, `(caller_id,
created_at DESC)` for outgoing, `(status, created_at)` for the sweeper that
expires stale `ringing` calls.

`call_participants` appears in the brief's entity list. **Recommendation:** a
2-row table for a 2-party call is not worth it in V1 — `caller_id`/`receiver_id`
is sufficient. Add `call_participants` when group calls arrive, or when a
participant needs per-user state (per-user mute, joined/left, connection
quality). Documented deliberately, not designed further.

## 13. Notifications

| Endpoint | Class | Notes |
|---|---|---|
| `GET /notifications` | **[F]** | `StageScreen` today ("Stage 6 — notifications") |
| `POST /notifications/{id}/read` | **[F]** | |
| `POST /notifications/read-all` | **[F]** | |
| Unread **count** | **[F]** | |
| `POST /notifications/devices` | **[F]** | Register a push device. §13.6 |
| `DELETE /notifications/devices/{device_id}` | **[F]** | Remove one. §13.6 |

> **Constraint the client has already imposed on itself.** The app shows **no
> unread badge, dot, or count anywhere** — `DashboardHeader.tsx` says the bell
> "carries no badge, dot, or count, because the API has no notifications router
> and a badge would be a number the server cannot supply". A count endpoint must
> be built **before** any badge is drawn. Shipping the list without a count keeps
> the client's current honesty intact.

> **No device-list endpoint in V1.** The client needs `register` and `remove`
> and nothing else; administrative device management is out of scope. Adding
> `GET /notifications/devices` would expose every token a user has registered,
> which is a credential inventory with no consumer.

### 13.1 Types, and which the platform can actually produce

| Type | Producible today? |
|---|---|
| `connection_request` | **Yes** — connections land first (§6.3) |
| `connection_accepted` | **Yes** |
| `message` | After §7 |
| `incoming_call` / `missed_call` | After §8 |
| `post_interaction` (like/comment) | **No** — likes/comments are not built (§9) |
| `opportunity` | After opportunity publishing exists |
| `system` | Yes — always available, no domain dependency |

So the honest V1 set is `{connection_request, connection_accepted, system}`.
The others must not be modelled as if they were live.

### 13.2 Shape

`{id, type, actor{user_id, name, avatar_url}|null, target_type, target_id, title,
body, data, is_read, created_at}`.

- `actor` is **nullable** — a system notification has no actor. "Not shown" and
  "shown and empty" must stay distinct, the same rule as `PublicProfile` (§5.3).
- `data` is a small JSON payload for the client's deep link (e.g.
  `{connection_id}`), never a rendered message. The client renders from `type` +
  `data`, so a wording change must not require a client release.
- `is_read` is a boolean on the row, with a partial index
  `(user_id, is_read) WHERE is_read = false` for the unread query.

### 13.3 Pagination and ordering

Keyset on `(created_at, id) DESC`, `limit` ≤ 50, optional `?unread_only=true`.
`total` is the full count, not the page length.

### 13.4 Retention and deletion

Notifications are **not** the system of record for anything: a notification
points at a row that may later be deleted. Recommended retention 90 days, removed
by a periodic job. Do **not** cascade-delete notifications when the actor's
content is deleted — the recipient still needs to know something happened, with
`actor` rendered as null/anonymous.

### 13.5 Push delivery, provider and payload

A WebSocket only reaches a running app. When the application is backgrounded or
killed, the socket is gone and nothing is delivered, so the recipient learns of a
connection request or a message only when they next open the app. **Push is the
transport that covers that gap**, and it is a transport like any other: the
notification row in PostgreSQL remains the record, and push is one way of telling
a device about it.

```text
Business operation
        ↓
notification row created          (existing behaviour — §13)
        ↓
DB COMMIT
        ↓
notification.created
        ├── WebSocket          → foreground app
        └── Push service       → background / killed app
```

**Provider: Expo Push Service for V1.** The mobile application is already Expo
(§0), so this needs no Firebase native configuration inside the app and no
service-account JSON in the repository. The backend remains responsible for
delivery, and the provider sits behind a service abstraction
(`app/services/push.py`) so a later swap to FCM changes one module rather than
every caller. **Direct FCM is not part of V1.**

**Push failure must never roll back notification persistence.** The row is
committed before any provider call, and a failed delivery is logged and
abandoned — a device that cannot be reached is not a reason to un-store a
notification the user is owed. Delivery is best-effort by design, and REST
remains authoritative either way.

**Push payload — identifiers only:**

```json
{
  "notification_id": "<notification id>",
  "type": "<notification type>",
  "target_type": "<target type or null>",
  "target_id": "<target id or null>"
}
```

This is what appears in the push payload, and deliberately not more: no
`password`, `JWT`, `access_token`, database URL, Redis URL, LiveKit credentials,
device credentials, private profile data, or message text. The client resolves
what it needs with the authenticated REST APIs it already has, using
`notification_id` as the key — so a push payload is a pointer, never a source of
truth.

**Message text MUST NOT appear in a V1 push payload.** A push notification is
rendered on a locked screen by anyone holding the phone, so a message body
delivered this way is disclosed to whoever is nearby. For `message`, the tray
shows a generic **"New message"**; the text is fetched over authenticated REST
once the app is unlocked. §13.2's `body` is a *stored* field for the in-app
screen and is not what push may carry.

**Notification types are unchanged by push.** The registry stays
`{connection_request, connection_accepted, message, system}` (§13.1). Push is a
delivery path, not a new kind of notification, so it adds no type.

**Foreground and background are separate paths and must not double-notify.**
While the app is running, `notification.created` over the WebSocket updates the
notification cache and is what the UI renders from; a push for the same event is
suppressed while the app is in the foreground. Push replaces neither the
WebSocket nor REST — a user with push working and the socket dead must still get
the notification, and a user with the socket live must not see it twice.

**Push-token lifecycle.** On an authenticated session the client requests
notification permission, obtains an Expo push token, and registers it through
`POST /notifications/devices`. The server associates it with the caller. On
logout the client removes the registration via
`DELETE /notifications/devices/{device_id}`. **A token becoming invalid never
invalidates the account or the session** — it is device metadata, and the worst
case of losing it is that one device stops receiving pushes.

**Invalid provider tokens.** If Expo reports a token as `DeviceNotRegistered` or
otherwise invalid, the implementation **marks that registration inactive**
(`is_active = false`, §14.13) rather than deleting the row, so a token that
later becomes valid again is not lost. The user's account is untouched, other
devices are unaffected, and one bad token never blocks delivery to the rest. **No
retry queue in V1** — a failed push is logged and dropped, and the notification
is still in PostgreSQL for the next fetch.

**Provider credentials are server-side only.** They are configuration on the
backend, set the way `JWT_SECRET` and `DATABASE_URL` are. They are never
hard-coded, never committed, never placed in the mobile bundle, never logged,
and never returned through any API.

**No job queue.** This specification defines no Celery, RabbitMQ, Kafka, or any
other distributed job system, and V1 must not introduce one for push. Delivery
sits behind `app/services/push.py` and is invoked after the commit, exactly as
`notification.created` is; the module must not block or fail notification
persistence.

### 13.6 Device registration

Two endpoints, both authenticated, both derived from the token:

```http
POST /notifications/devices
{ "push_token": "ExponentPushToken[…]", "platform": "android", "device_name": "Pixel 8" }
```

```http
DELETE /notifications/devices/{device_id}
```

**Ownership is the JWT subject, always.** The request body has **no `user_id`**
and `extra="forbid"` turns an attempt to supply one into a 422 rather than a
silently ignored key — the same rule §4 applies to `MessageCreate`. A device
belonging to another account is a **404**, not a 403, matching §16's
anti-enumeration rule and the `notifications/{id}/read` convention above.

**Registration is idempotent.** The same authenticated user re-registering the
same push token updates the existing row (§14.13's uniqueness constraint) and
returns it; it does not create a second device. A token is a *credential*, so it
is never echoed in a response body — the registration returns the device's `id`,
`platform` and `device_name` and nothing more.

### 13.7 Mobile contract, and the Phase 4A boundary

The mobile implementation of §13.5 and §13.6 will:

1. install `expo-notifications`;
2. request notification permission at a sensible point, not on every render, and
   continue normally when it is denied;
3. create an Android notification channel with safe defaults — a name, default
   importance, no aggressive sound or vibration;
4. obtain an Expo push token;
5. `POST /notifications/devices` to register it;
6. `DELETE /notifications/devices/{device_id}` at logout where the lifecycle
   supports it;
7. handle a notification tap by routing to the notification or conversation
   screen that exists — **and only to one that exists.** `notifications.tsx` and
   `messages.tsx` are `StageScreen` notices today, so a tap falls back to the
   notifications screen rather than inventing a route;
8. keep the existing WebSocket realtime system untouched. Push is added beside
   it, never over it.

`POST_NOTIFICATIONS` is the only permission this needs. `CAMERA` and `RECORD_AUDIO`
belong to §8's calls and are **not** requested here.

> **Phase 4A defines the contract only.** The sections above are the decision
> record that unblocks Phase 4. **No migration, application code, mobile code,
> provider configuration, or production database change occurs during Phase 4A.**
> `user_devices` (§14.13) is specified, not created.

owner id — the server derives it from the token.

**Verification is request-only in V1.** Both companies and institutions move to
`pending` and return an honest note that document review is a later stage.
**Nothing in the API may set `verified`.** A `verified: true` the server granted
without a real signal would be a false credential claim, and the client renders
no such badge.

`program_count` must come from a real `COUNT`, never a stored counter that drifts.

## 14. Database design (logical; nothing here is created)

**Conventions for every table:**

- Primary key `id uuid` — client-facing, generated in the application, never a
  sequential integer (sequential ids are enumerable across accounts).
- `created_at` / `updated_at` `timestamptz NOT NULL`, timezone-aware, default
  `now()`. Never naive timestamps.
- `deleted_at timestamptz NULL` on soft-deletable tables only.
- Deletion behaviour: **`ON DELETE RESTRICT`** for anything a user must not lose
  silently; `ON DELETE CASCADE` only for true children (join rows, views).
- Index every foreign key that is filtered on; every list endpoint has a
  deterministic `ORDER BY`.
- No table is created by this document. A migration is Phase 1 work.

### 14.1 Identity

**`users`**
`id` PK · `public_id text UNIQUE NOT NULL` (e.g. `MJ-XXXXXXXX`, immutable) ·
`username text UNIQUE NOT NULL` · `email citext UNIQUE NOT NULL` · `phone text
NULL` · `password_hash text NOT NULL` · `name text NOT NULL` · `role text NOT
NULL` CHECK in (candidate, employer, college, admin) · `status text NOT NULL`
CHECK in (active, suspended, deactivated) · `designation text NULL` ·
`avatar_media_id uuid NULL` FK media_assets · `email_verified_at timestamptz
NULL` · `last_login_at timestamptz NULL` · timestamps.
Indexes: unique on `email`, `username`, `public_id`; index on `role`.
`citext` for email so case-insensitive uniqueness is a constraint, not an
application convention.

**`email_verifications`** · **`password_reset_tokens`**
`id` PK · `user_id` FK RESTRICT · `token_hash text NOT NULL` (**hashed**, never
the raw token) · `expires_at` · `consumed_at NULL` · timestamps.
Unique index on `token_hash`; index on `(user_id, consumed_at)`. One-time use is
enforced by `consumed_at` **and** consumed atomically (`UPDATE … WHERE
consumed_at IS NULL`) so two concurrent redemptions cannot both win.

**`refresh_tokens`** (only if §4.8 chooses rotation) — `id` PK · `user_id` FK
CASCADE · `token_hash` UNIQUE · `family_id` for reuse detection · `expires_at` ·
`revoked_at NULL` · `replaced_by NULL`.

### 14.2 Profile

**`profiles`** — `user_id` PK/FK users CASCADE · `headline text NULL` ·
`summary text NULL` · `location text NULL` · `interests text[] NOT NULL DEFAULT
'{}'`. **1:1, so `user_id` is both PK and FK.**

**`profile_privacy`** — `user_id` PK/FK CASCADE · `profile_visibility text NOT
NULL` CHECK in (private, employers, public) · `discoverable bool NOT NULL` ·
`allow_messages bool NOT NULL` · `show_email bool NOT NULL` · `show_phone bool
NOT NULL`. Booleans need a **non-null default**; a nullable privacy flag is
always `NULL` in practice and that is a bug, not a feature.

**`profile_preferences`** — `user_id` PK/FK CASCADE · `work_modes text[] NOT
NULL DEFAULT '{}'` · `employment_types text[] NOT NULL DEFAULT '{}'` ·
`preferred_locations text[] NOT NULL DEFAULT '{}'` · `salary_min int NULL` ·
`salary_max int NULL` · `currency text NOT NULL` · `availability_date date NULL`
· `willing_to_relocate bool NOT NULL`. A nullable row = never set, which is why
`ProfileAggregate.preferences` is `| null`.

**`profile_links`** — `id` PK · `user_id` FK CASCADE · `kind text NOT NULL` ·
`label text NOT NULL` · `url text NOT NULL` · timestamps. Unique
`(user_id, kind)` if one link per network is intended.

### 14.3 Skills

**`skills`** (catalogue) — `id` PK · `name text UNIQUE NOT NULL` · `category text
NULL`. This is the table behind `GET /skills/catalog`; the catalogue is
**database-backed**, never a client list.

**`user_skills`** — `id` PK · `user_id` FK CASCADE · `skill_id` FK skills
RESTRICT · `level text NOT NULL` CHECK in (beginner, intermediate, advanced,
expert) · `years numeric NULL` · `verified bool NOT NULL DEFAULT false` ·
`source text NOT NULL` · timestamps.
**Unique `(user_id, skill_id)`** — the same skill cannot be added twice.
`verified` defaults **false** and needs a real signal (the client renders a
badge); no signal exists yet, so it stays false.

### 14.4 Profile sections (six near-identical tables)

`education`, `experience`, `projects`, `certifications`, `achievements` share a
shape. They are listed separately because their columns genuinely differ, and a
single generic "profile_items" table would make every read a `jsonb` scan.

**`education`** — `id` PK · `user_id` FK CASCADE · `institution text NOT NULL` ·
`degree text NULL` · `field_of_study text NULL` · `level text NULL` CHECK in the
6-value `EducationLevel` · `start_date date NULL` · `end_date date NULL` ·
`current bool NOT NULL DEFAULT false` · `grade text NULL` · `description text
NULL` · timestamps. Index `(user_id, start_date DESC)`.
`CHECK (end_date IS NULL OR end_date >= start_date)`; `current = true` requires
`end_date IS NULL`.

**`experience`** — `id` PK · `user_id` FK CASCADE · `title text NOT NULL` ·
`company_name text NOT NULL` · `location text NULL` · `work_mode text NULL`
CHECK in (remote, hybrid, onsite) · `start_date` · `end_date` · `current bool
NOT NULL DEFAULT false` · `description text NULL` · timestamps. Index
`(user_id, start_date DESC)`; same date CHECKs.

**`projects`** — `id` PK · `user_id` FK CASCADE · `title text NOT NULL` ·
`description text NULL` · `role text NULL` · `start_date` · `end_date` ·
`source_url text NULL` · `live_url text NULL` · timestamps.
**`project_skills`** — `project_id` FK CASCADE · `skill_id` FK skills RESTRICT ·
**PK `(project_id, skill_id)`**. Needed because `ProjectCreate` accepts
`skill_ids[]` and `ProjectRead.skills[]` returns `{skill_id, name}[]`; a `text[]`
column cannot carry a name or a FK.

**`certifications`** — `id` PK · `user_id` FK CASCADE · `title text NOT NULL` ·
`issuer text NOT NULL` · `issued_on date NULL` · `expires_on date NULL` ·
`credential_id text NULL` · `verification_url text NULL` · timestamps.

**`achievements`** — `id` PK · `user_id` FK CASCADE · `title text NOT NULL` ·
`issuer text NULL` · `category text NOT NULL` CHECK in the 6-value
`AchievementCategory` (required on create) · `achieved_on date NULL` ·
`description text NULL` · timestamps.

### 14.5 Connections

**`connections`** — `id` PK · `requester_id` FK users CASCADE · `addressee_id`
FK users CASCADE · `status text NOT NULL` CHECK in (pending, accepted, declined,
canceled) · `responded_at timestamptz NULL` · timestamps.
- **Unique `(LEAST(requester_id, addressee_id), GREATEST(requester_id,
  addressee_id))`** — the pair is unique in **either** direction, which is what
  makes a duplicate request impossible without an application check that races.
- **CHECK `requester_id <> addressee_id`** — no self-connection, at the database.
- Indexes: `(addressee_id, status)` for the incoming list, `(requester_id,
  status)` for the sent list.
- `removed` is **not stored**; it is a client-side projection of a deleted row.
- A `CHECK` on `(status = 'pending') = (responded_at IS NULL)` keeps the two
  fields from disagreeing.

### 14.6 Messaging

**`conversations`** — `id` PK · `created_by` FK users RESTRICT · `created_at` ·
`last_message_at timestamptz NULL` · `last_message_id uuid NULL`.
Index `(last_message_at DESC NULLS LAST)` for the list ordering.
**`direct_key text UNIQUE NULL`** — a deterministic sorted pair of participant ids
(`min:max`) giving a 1:1 uniqueness guarantee without a serialisable race. NULL
for future group conversations.

**`conversation_members`** — `conversation_id` FK CASCADE · `user_id` FK users
CASCADE · `joined_at` · `last_read_message_id uuid NULL` · `muted bool NOT NULL
DEFAULT false` · `archived bool NOT NULL DEFAULT false` · **PK
`(conversation_id, user_id)`**. Index `(user_id, conversation_id)` for the list.

**`messages`** — `id` PK · `conversation_id` FK CASCADE · `sender_id` FK users
RESTRICT · `body text NOT NULL` · `media_id` FK media_assets NULL (V1: text
only) · `client_message_id text NULL` · `created_at` · `edited_at NULL` ·
`deleted_at NULL` · `deleted_by` FK users NULL.
**Unique `(conversation_id, sender_id, client_message_id)`** — the duplicate
guard (§18). Index `(conversation_id, created_at, id)` for pagination.
A `body` of `''` is invalid; a deleted row keeps its slot with a tombstone.

### 14.7 Notifications

**`notifications`** — `id` PK · `user_id` FK users CASCADE (the **recipient**) ·
`type text NOT NULL` · `actor_id` FK users **SET NULL** (nullable, per §13.2) ·
`target_type text NULL` · `target_id uuid NULL` · `title text NOT NULL` ·
`body text NULL` · `data jsonb NOT NULL DEFAULT '{}'` · `is_read bool NOT NULL
DEFAULT false` · `created_at`.
Indexes: partial `(user_id, created_at DESC) WHERE is_read = false`; full
`(user_id, created_at DESC, id DESC)` for the list.
### 14.8 Calls

**`calls`** — see the full column table in §8.6. PK `id uuid`; FKs
`caller_id`/`receiver_id` (RESTRICT), `conversation_id` (SET NULL);
`CHECK caller_id <> receiver_id`; `room_name text UNIQUE NOT NULL`;
`status`, `media_kind`, four timestamps, `duration_seconds`, `end_reason`.

**`call_participants`** — deferred; see the §8.6 recommendation.

### 14.9 Feed

**`posts`** — `id` PK · `author_id` FK users CASCADE · `kind text NOT NULL`
(**derived**, §9.2) · `category text NOT NULL` CHECK in (projects, achievements,
learning, community) · `title text NULL` · `body text NULL` · `project jsonb
NULL` · `achievement jsonb NULL` · `tags text[] NOT NULL DEFAULT '{}'` ·
`created_at` · `updated_at` · `deleted_at NULL`.
Index `(created_at DESC, id DESC) WHERE deleted_at IS NULL`; `(author_id,
created_at DESC)`.
**`CHECK (body IS NOT NULL OR project IS NOT NULL OR achievement IS NOT NULL)`**
— at least one payload, enforced in the database rather than only in a schema.
`project`/`achievement` are `jsonb` because they are **display payloads, not
queryable records** (they duplicate `ProfileTimeline` output); the brief lists no
`post_projects` table and inventing one would be over-modelling.

**`post_media`** — `post_id` FK CASCADE · `media_id` FK media_assets RESTRICT ·
`position int NOT NULL` · **PK `(post_id, position)`**. Ordering is data, so
`position` is part of the key. Unique `(post_id, media_id)`.

**`post_likes`** — `post_id` FK CASCADE · `user_id` FK CASCADE · `created_at` ·
**PK `(post_id, user_id)`** — the composite key *is* the like.
**`post_bookmarks`** — same shape, `PK (post_id, user_id)`.
**`post_comments`** — `id` PK · `post_id` FK CASCADE · `author_id` FK users
RESTRICT · `body text NOT NULL` · `created_at` · `deleted_at NULL`. Index
`(post_id, created_at)`.

### 14.10 Stories

**`stories`** — `id` PK · `publisher_kind text NOT NULL` CHECK in (company,
platform) · `company_id` FK companies SET NULL · `content_type text NOT NULL`
CHECK in (job, internship, announcement, event) · `caption text NOT NULL` ·
`opportunity_id` FK opportunities SET NULL · `media_id` FK media_assets RESTRICT ·
`status text NOT NULL` CHECK in (published, archived) · `expires_at timestamptz
NOT NULL` · timestamps. Index `(expires_at)` and `(expires_at, created_at DESC)`.
**`CHECK (publisher_kind = 'company') = (company_id IS NOT NULL)`** — a company
story must name its company, and a platform story must not.

**`story_views`** — `story_id` FK CASCADE · `viewer_id` FK users CASCADE ·
`viewed_at` · **PK `(story_id, viewer_id)`** — which is exactly what makes
`POST /stories/{id}/view` idempotent and the `already_recorded` flag honest.

### 14.11 Media

**`media_assets`** — `id` PK · `owner_id` FK users CASCADE · `kind text NOT
NULL` (image | video | document) · `mime_type text NOT NULL` · `size_bytes bigint
NOT NULL` CHECK ≥ 0 · `width int NULL` · `height int NULL` · `duration_ms bigint
NULL` · `storage_kind text NOT NULL` DEFAULT 'database' · `storage_key text NOT
NULL` · `served_at timestamptz NOT NULL` · `created_at`.
Index `(owner_id, created_at DESC)`. `served_at` is the relative path the client
joins onto the base URL. `storage_kind`/`storage_key` stay reserved so storage is
a configuration change (§11.1). `DELETE` must be owner-only **and** must first
confirm no live post/story references the asset.

### 14.12 Career domain

**`companies`** — `id` PK · `name text NOT NULL` · `slug text UNIQUE NOT NULL`
(server-generated) · `website` · `industry` · `company_size` (6-value CHECK) ·
`location` · `description` · `logo_media_id` FK media_assets NULL ·
`verification_status text NOT NULL` DEFAULT 'unverified' CHECK in (unverified,
pending, verified, rejected) · `status text NOT NULL` · timestamps.

**`company_members`** — `id` PK · `company_id` FK CASCADE · `user_id` FK users
CASCADE · `role text NOT NULL` CHECK in (owner, admin, recruiter,
hiring_manager, viewer) · `status text NOT NULL` CHECK in (invited, active,
suspended) · timestamps. **Unique `(company_id, user_id)`**. Partial unique index
to guarantee **at most one owner per company**. The service layer must reject an
invite that names `owner` — the table must still be able to *represent* an owner,
so the prohibition is not a table CHECK.

**`institutions`** — as `companies`, plus `owner_id` FK users RESTRICT (the
registering contact person; every route is ownership-scoped).
**`programs`** — `id` PK · `institution_id` FK CASCADE · `name text NOT NULL` ·
`level text NULL` · `description text NULL` · timestamps. Index
`(institution_id)`. `program_count` is a live `COUNT`, not a column.

**`opportunities`** — `id` PK · `company_id` FK companies RESTRICT · `title text
NOT NULL` · `slug text UNIQUE NOT NULL` · `opportunity_type text NOT NULL` CHECK
(4 values) · `status text NOT NULL` · `visibility text NOT NULL` ·
`description` · `responsibilities` · `requirements_text` · `work_mode` CHECK (3) ·
`location` · `employment_type` CHECK (4) · `comp_min` · `comp_max` ·
---

### 14.13 Push devices

**`user_devices`** — `id` PK · `user_id` FK users CASCADE (the owner) ·
`push_token text NOT NULL` · `platform text NOT NULL` CHECK in (android, ios) ·
`device_name text NULL` · `is_active bool NOT NULL` DEFAULT true · `created_at` ·
`updated_at` · `last_seen_at timestamptz NULL`.

**Unique `(user_id, push_token)`.** A token is a credential, so re-registering one
on an authenticated session must update the existing row rather than accumulate
duplicates (§13.6). Index on `(user_id, is_active)` for the per-user lookup that
delivery performs.

`platform` is a two-value CHECK and not a PostgreSQL ENUM, matching every other
vocabulary in this document: `android` is what the current client uses, and `ios`
keeps the model honest if the app ships there without a schema change.

`CASCADE` on `user_id` matches every other user-owned table here (`profiles`,
`connections`, `user_skills`): the registration is part of the account and has no
meaning once the account is gone.

`is_active` and `last_seen_at` exist so an invalidated provider token is
**disabled, not deleted** (§13.5) — a transient provider error must not destroy a
registration the user will need again.

---

## 15. API conventions

### 15.1 Success responses

**There is no `{"data": …}` envelope, and there must not be one.** The existing
`/health` and `/ready` return bare objects, `apiClient` returns
`await response.json()` **unwrapped**, and every mobile type
(`Principal`, `Me`, `ProfileAggregate`, `CompanyRead`, `Opportunity`, `Story`…) is
a top-level object. Adding a `data` wrapper would break every screen at once.

```
Single resource   → 200/201 + the object itself
Collection        → 200 + a bare array  OR  a page envelope (§17)
Delete            → 204 No Content   (handled by the client)
No content        → 204
```

A bare array is used by `/companies/mine`, `/companies/{id}/members`,
`/institutions/{id}/programs`, `/institutions/mine`, `/resumes`,
`/users/lookup`, and `/connections`. This is not inconsistency to clean up — the
client's return types already encode it per endpoint.

### 15.2 Error format — exact current behaviour

Implemented in `app/core/errors.py` and rendered by the four handlers in
`app/main.py`. The mobile client parses it in `isApiErrorEnvelope`, which
requires `error.message` **and** `error.code` to both be strings.

```json
{
  "error": {
    "code": "validation_error",
    "message": "Some of the details provided were not valid.",
    "details": [
      { "field": "body.email", "message": "value is not a valid email address", "type": "value_error" }
    ],
    "request_id": "0f3c9a1b2c4d"
  }
}
```

| Element | Rule |
|---|---|
| `code` | One of `ErrorCode`. **The client switches on it.** Never invent a code ad hoc |
| `message` | A sentence for the person reading it. Rendered verbatim in a banner |
| `details` | A **list** of `{field, message, type}`. `field` keeps the framework's `body.`/`query.` prefix — the client strips it (`fieldErrors`) rather than guessing |
| `request_id` | Matches the `X-Request-ID` response header |

Rules that must hold:

- **Never** return a raw FastAPI `{"detail": …}`. The client would not recognise
  it and would fall back to `Request failed (422).`
- `details` is always a **list**, never an object. `error_payload` builds it that
  way and `ApiError.details` is `list | None`.
- An unhandled exception returns `500` with a **generic** message; the real
  exception is logged, never returned. No stack trace, SQL fragment or DSN ever
  reaches a caller.
- `RequestValidationError` → `422` with `code: "validation_error"` and per-field
  details, so an input can render its own message inline.
- 404 → `not_found`; any other `HTTPException` → `bad_request`.

### 15.3 Status codes

| Code | Used for |
|---|---|
| 200 | Successful read / update |
| 201 | Resource created (signup, post, call, message) |
| 204 | Delete, mark-read, no content |
| 400 | Malformed request |
| 401 | Missing/invalid/expired token — the client clears the session |
| 403 | Authenticated but not permitted (e.g. candidate → company route) |
| 404 | Absent **or not yours** — deliberately used instead of 403 to avoid leaking existence |
| 409 | Conflict (duplicate email, duplicate connection) |
| 422 | Validation failure with field details |
| 429 | Rate limited, with `Retry-After` |
| 503 | Readiness failure only |

### 15.4 Headers, verbs, and the request id

- `X-Request-ID` is echoed from the request when supplied, else minted as 12 hex
  chars, and is always set on the response. It is `expose_headers`-ed for CORS.
- `Content-Type: application/json` except for `GET /media/{id}` and the raw
  upload routes, which use the real file type.
- `PUT` = full replacement (`/profile/privacy`, `/profile/preferences`).
  `PATCH` = partial. The client relies on this distinction to avoid erasing
  server-owned fields.
- Write schemas use `extra="forbid"` so a client cannot smuggle `updated_at` or
  `verification_status` back in.

---

## 16. Authorization rules

| Rule | Failure response |
|---|---|
| A user may edit only their own profile | `403` (or `404` for another user's public id) |
| `GET /profile` and every `/profile/**` write are owner-only | `403` for another role |
| `GET /users/{public_id}` is public, but **privacy-filtered** | `200` with fields omitted (§5.3) |
| `PUT /profile/privacy` and `/preferences` are owner-only, full state | `403` |
| Only a connection's **addressee** may accept/decline | `404` when not the addressee |
| Only the **requester** may cancel | `404` |
| Either participant may `DELETE` an accepted connection | `404` for a third party |
| Only conversation **members** may read/write messages | `404` for a non-member |
| A blocked user cannot message | `403` on send |
| Only **call participants** may obtain a call token | `403`/`404` |
| Only **call participants** may accept/reject/end | `404` for anyone else |
| Only a **post author** may `PATCH`/`DELETE` their post | `403`/`404`, never success |
| Only a **comment author** may delete their comment | `403`/`404` |
| Only the **media owner** may read or delete bytes | `404` |
| Only a **company member** may read/manage the company | `404` for a non-member |
| A **candidate** may not use company routes at all | `403` (asserted by the mobile suite) |
| An **employer** may not use the candidate profile route | `403` (asserted by the mobile suite) |
| An institution is **owner-scoped** | `404` for anyone else |
| Only `company_members` with the right role may invite/remove | `403` |
| An invite **may never** grant `owner` | `422`/`403` |
| **No client-supplied user id is ever trusted** for the current user | derived from the token |

**The 404-over-403 rule is the important one.** The mobile integration suite
asserts it directly ("refuses a non-member access to someone else's company",
`status >= 400`), and `src/api/connections.ts` documents it as intentional: a
stale row should be shown as removed rather than retried. Use 403 only where the
*existence* of the resource is already public (a company, a public profile) and
the caller is the wrong kind of principal.

`comp_currency` · `comp_period` CHECK (hour, month, year) · `openings int NULL` ·
`deadline date NULL` · `start_date date NULL` · `published_at timestamptz
NULL` · timestamps.
Indexes: `(status, published_at DESC)`, `(company_id)`, and a `pg_trgm` GIN index
on `title` for `q` search once volume justifies it.
**`opportunity_requirements`** — `id` PK · `opportunity_id` FK CASCADE ·
`skill_id` FK skills RESTRICT · `kind text NOT NULL` CHECK in (required,
preferred) · `min_level text NULL` · `importance text NOT NULL`. Index
`(opportunity_id)`. Needed because `OpportunityRequirement` carries a skill
**name** and a `kind`, which a `text[]` cannot.

**`blocked_users`** — `blocker_id` FK users CASCADE · `blocked_id` FK users
CASCADE · `created_at` · **PK `(blocker_id, blocked_id)`** · CHECK the two
differ. This table is required by §7.4 and §12; the brief's entity list omits it,
so it is called out here.

`actor_id` is `SET NULL`, not `CASCADE`, precisely so §13.4 holds.

## 17. Pagination

**Decision: keep both existing envelopes. Do not unify them in V1.**

| Envelope | Shape | Used by |
|---|---|---|
| `Page<T>` | `{items, total, limit, offset, has_more}` | `/profile/skills`, `/profile/education`, `/profile/experience`, `/profile/projects`, `/profile/certifications`, `/profile/achievements`, `/skills/catalog`, `/posts`, `/posts/mine` |
| `FastApiPage<T>` | `{items, total, page, page_size, pages}` | `/stories`, `/opportunities` |
| Bare array | `[]` | `/connections`, `/users/lookup`, `/companies/mine`, `/companies/{id}/members`, `/institutions/mine`, `/institutions/{id}/programs`, `/resumes` |

`src/api/posts.ts` states this explicitly: "Two envelopes exist on the server
today; this one describes the one `/posts` uses, and pretending otherwise would
have the client read fields that are not there." Unifying them is a **breaking
change to two API modules and six screens** with no user-visible benefit in V1.

Rules:

- **Maximum page size 100** for `limit`; `/posts` is documented at max 50.
- `offset` pagination is acceptable at V1 scale (a student app), but **new**
  endpoints that will grow without bound — messages, notifications, call history,
  conversations — should use **keyset** pagination on `(created_at, id)`. Keyset
  is the reason to introduce the option, not offset's weakness.
- `has_more` is computed as `offset + len(items) < total`. Never derived from
  `len(items) == limit`, which is wrong on an exact final page.
- `total` is a real `COUNT`, never the length of the page. The profile screen
  depends on this: "the Posts statistic must be the count of records the server
  actually holds, never the length of whichever page happened to be fetched".

---

## 18. Idempotency

| Operation | Idempotent? | Mechanism |
|---|---|---|
| `POST /connections` | **Yes** | Natural key `(LEAST, GREATEST)` unique (§14.5); a repeat **revives** the existing row rather than inserting |
| `POST /connections/{id}/accept` \| `/decline` \| `/cancel` | **Yes** | Target-state transition; a repeat is a no-op returning the same record |
| `POST /stories/{id}/view` | **Yes** | `PK (story_id, viewer_id)` + `already_recorded` flag |
| `POST`/`DELETE /posts/{id}/like` · `/bookmark` | **Yes** | `PK (post_id, user_id)` — the key *is* the state |
| `PUT /profile/privacy` · `/preferences` | **Yes** | Full-state replacement, so a repeat converges |
| `POST /messages` | **Yes, via a client key** | `client_message_id` + `Unique (conversation_id, sender_id, client_message_id)` |
| `POST /media` | **No** | Each upload is a new object. **Never** key it on `Idempotency-Key` |
| `POST /calls` | **No** | Two calls are two calls. Dedupe client-side if double-tap is a real problem |
| `POST /auth/login` · `/signup` | **No** | A retry is a retry |
---

## 19. Environment variables

**No actual value appears in this document, and none belongs in the repository.**
Only key names and their purpose. Every secret lives in the Render dashboard (or
a local gitignored `backend/.env`).

### 19.1 Current (existing — do not change)

| Key | Source | Notes |
|---|---|---|
| `DATABASE_URL` | Render dashboard | Neon DSN. `sync: false` in `render.yaml`; never committed |
| `APP_ENV` | `render.yaml` | `production` in Render |
| `DEBUG` | `render.yaml` | `false`; production refuses to boot if true |
| `API_PREFIX` | `render.yaml` | `/api/v1` — a contract with the mobile client |
| `PYTHON_VERSION` | `render.yaml` | `3.12.8` |
| `CORS_ORIGINS` | Render dashboard | Exact origins, never `*` |
| `APP_NAME`, `APP_VERSION` | `.env.example` | Informational |
| `HOST`, `PORT` | local | Not used by Render (it injects `$PORT`) |

### 19.2 Required additions (Proposed)

| Key | Purpose |
|---|---|
| `JWT_SECRET` (or an RS256 key pair) | Signs access tokens. **Must** fail closed in production |
| `LIVEKIT_URL` | LiveKit server URL (e.g. `wss://…`) — **not** a secret |
| `LIVEKIT_API_KEY` | **Secret.** Server-side only |
| `LIVEKIT_API_SECRET` | **Secret.** Server-side only, signs room tokens |
| `EMAIL_*` (host, port, user, password, from) | Only if verification/reset ships (§4.6, §4.7) |
| `MEDIA_MAX_BYTES` etc. | Optional overrides of the limits published by `GET /media` |
| `APP_BASE_URL` | Public API origin, for links in emails and the OpenAPI server URL |

### 19.3 Rules

- **Never** place a secret in `render.yaml` as a literal, in `.env.example`, in a
  test fixture, or in a doc.
- Every secret needs a **non-placeholder default** that production refuses to
  boot with — the pattern already in `config.py` for `DATABASE_URL` should be
  extended, not reinvented.
- `Settings` is `extra="ignore"`, so a typo'd key is silently ignored. Consider
  `extra="forbid"` in production, or an explicit assertion that
  `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` are present when the calls router is
  mounted.
- Local development copies `backend/.env.example` → `backend/.env`, gitignored.

> **Stale, documented not fixed:** `backend/.env.example` still says "On Render
> this is supplied automatically by the Blueprint's `fromDatabase` reference".
> The Blueprint no longer has a `fromDatabase`; `DATABASE_URL` now comes from
> the dashboard. Flagged in §25.

---

## 20. Security

**The existing controls are the baseline and must not be weakened.** They are
already correct, so the work is additive.

### 20.1 Already implemented — keep as is

| Control | Where |
|---|---|
| Fail-closed production boot (placeholder DSN, `DEBUG=true`, `CORS_ORIGINS="*"`) | `app/core/config.py::_fail_closed_in_production` |
| DSN scheme normalisation to `postgresql+psycopg://` | `app/core/config.py::_must_be_a_postgres_dsn` |
| CORS with exact origins, `allow_credentials=False` | `app/main.py` |
| One error envelope rendered by handlers only — routes never hand-build errors | `app/core/errors.py`, `app/main.py` |
| Generic `500` with no internals leaked | `app/main.py::handle_unexpected` |
| `X-Request-ID` correlation, inbound id honoured | `app/main.py::request_context` |
| JSON logging that never logs the settings object, a URL or a body | `app/core/logging.py` |
| Readiness returns only an exception **class name**, never a driver message | `app/db/session.py::ping_database` |
| `pool_pre_ping` for pooled/persistent connections | `app/db/session.py` |

### 20.2 Required for V1

- **Argon2id** password hashing (§4.9), with a dependency added.
- **JWT validation** on every protected route: signature, `exp`, `nbf`,
  `iss`/`aud`, algorithm pinned. Reject `alg: none` and any unexpected family.
- **Refresh token strategy** — decided in §4.8; if rotation is chosen, add reuse
  detection via `family_id`.

### 20.3 Push and device registration

- **Device registration requires authentication.** `POST /notifications/devices`
  is behind `CurrentUser` like every other protected route (§13.6).
- **Ownership comes from the JWT subject.** The request body has no `user_id`,
  and `extra="forbid"` makes an attempt to supply one a 422 rather than a
  silently dropped field — the same rule §4 applies to `MessageCreate`.
- **A client cannot assign a device to another user**, and cannot delete one:
  another account's device is a **404**, not a 403 (§13.6, §16).
- **Push tokens are credentials.** A device token is stored like a password hash
  is treated like a password — never logged, never returned in a response body,
  never included in an error detail. `user_devices.push_token` is the one column
  whose value must never reach a log line.
- **Provider credentials never reach the mobile application.** Expo access
  details are server-side configuration, exactly like `JWT_SECRET` and
  `DATABASE_URL`: set in the environment, never committed, never bundled, never
  logged, never returned through an API.
- **Push payloads carry the minimum.** `notification_id`, `type`, `target_type`,
  `target_id` — nothing else. A push payload is a pointer resolved over
  authenticated REST, never a copy of server state (§13.5).
- **Message text is excluded from push payloads**, so private conversation
  content cannot be disclosed on a lock screen (§13.5).
- **The notification row remains authoritative.** Push is a transport; losing a
  push must not lose a notification, and a failed push must not roll back the
  write that produced it (§13.5).
---

## 21. Testing strategy

The existing `tests/test_health.py` sets the standard: **run without a
database**, substitute the probe rather than requiring infrastructure, and assert
the *contract* (envelope shape, field presence) rather than a status code alone.
A suite that skips on a fresh checkout is a suite that hides a broken health
endpoint exactly when it matters.

| Layer | Scope | Infrastructure |
|---|---|---|
| **Unit** | Password hashing, JWT mint/parse, completeness weighting, privacy field filtering, state-machine transitions, idempotency helpers, media limit validation | **None** |
| **API** | Every route: status, envelope, `details[].field`, auth requirement, role separation, ownership | `TestClient` + overridden `get_db` |
| **Database** | Constraints and cascades: the pair-unique connection, the no-self-connection CHECK, `(user_id, skill_id)` uniqueness, `story_views` idempotency, `LEAST/GREATEST` on uuid, `citext` email uniqueness, `program_count` | **Real PostgreSQL** (Neon branch or local) |
| **Integration** | FastAPI + real PostgreSQL, full request path through the session | **Required** — Neon staging, never production |
| **LiveKit** | Token generation: participant gets a token, non-participant gets 403/404, an ended call gets none, the API secret never appears in any response, webhook signature validation | Mock the LiveKit client; one live smoke test against a dev project |
| **Mobile/backend parity** | Every path in `src/api/**` has a matching route | Node/Vitest, as `integration.test.ts` already does |

### 21.1 Parity testing — the highest-value test in the project

`src/api/integration.test.ts` already runs the **real** `apiClient` and the real
`api/*` modules against a running FastAPI, and it reported **58 operations** read
from the live `/openapi.json`. That file is the parity harness, and it is the
single best guard against this specification drifting from the client.

Two rules for it:

1. **Assert against `/openapi.json`, never a hand-written route list.** A
   hand-written list drifts; a generated one cannot.
2. **It must skip, not fail, when the API is unreachable** — as it does today —
   so `npm test` stays green on a machine with no database.

The one addition needed: a test that walks `src/api/*.ts` for path literals and
asserts each is present in the server's OpenAPI. That catches a new client
function added before its route exists — the exact failure this project already
experienced once.

### 21.2 Test data rules

- Every test account gets a **unique random email**, so a run can never collide
  with or touch a real account. This is already the mobile suite's rule.
---

## 22. Implementation order

### Phase 1 — Database foundation
Base conventions (uuid PKs, timestamptz, `citext` email), the auth tables,
`profiles`/`profile_privacy`/`profile_preferences`, and Alembic revisions.
**Everything depends on this.** Do not write a route before its migration exists;
`alembic upgrade head` on an empty database is the only thing that makes the rest
honest. No endpoint yet — `/ready` still answers `{"database":"ok"}`.

### 22.1 Critical path

```text
Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──┬──▶ Phase 4 ──▶ Phase 5 ──▶ Phase 6
                                   ├──▶ Phase 8
                                   └──▶ Phase 9
Phase 2 ──────────────────────────▶ Phase 7 (needs a mobile decision)
                                   │
        all of the above ──────────┴──▶ Phase 10 ──▶ 11 ──▶ 12
```

**Phase 1 → 2 → 3 is strictly sequential and is the whole critical path.** Every
other phase can be reordered except that Phase 5 needs Phase 4 and Phase 7 needs
Phase 2 plus a mobile SDK decision.

- No test deletes a pre-existing account.
- **Never** run migrations or destructive fixtures against production Neon. Use a
  separate Neon branch or a local database, and assert the target DSN is not
  production before running anything destructive.

- **Rate limiting** (§4.10) on a store that survives redeploy and is shared
  across instances.
- **Secret handling**: Render dashboard only; never logged, never returned, never
  in an error detail. `logging.py`'s field allowlist stays in force.
- **SQL injection**: SQLAlchemy 2 parameter binding everywhere. No string-built
  SQL, including for the `q` search (§14.12) and any dynamic `ORDER BY` — sort
  direction must come from a fixed allowlist, never from user input.
- **Input validation**: Pydantic v2 with `extra="forbid"` on writes, length
  caps, and enum validation. The completeness and category unions (§5.5) are
  closed sets — validate them server-side, not only in the client type.
- **File upload validation**: MIME **and** magic-byte sniffing (a declared
  `Content-Type` is a claim, not evidence), size caps, and rejection of anything
  that fails. Serve with `X-Content-Type-Options: nosniff`. A filename is never
  used as a storage path.
- **Authorization**: §16, enforced in the service layer, never inferred from a
  client-supplied id.
- **Privacy**: §5.3 — omitted, not nulled; `allow_messages` enforced before a
  conversation row is created.
- **Production debug**: already refused at boot.
- **API documentation exposure**: `/docs`, `/redoc` and `/openapi.json` are
  currently **unconditionally enabled** (`app/main.py`), including in
  production. A published OpenAPI document is a free reconnaissance gift, and it
  contradicts the mobile README's note that the deployed service returns `404`
  for `/docs`. **Recommended:** disable them when `is_production`, serving
  nothing in production rather than redirecting. Documented in §25 — **not**
  changed here.
- **Security headers**: `X-Content-Type-Options: nosniff`,
  `Strict-Transport-Security` (HTTPS is mandatory for media), `Referrer-Policy`.
  `X-Frame-Options` is low-value for a JSON API.

| `POST /notifications/{id}/read` · `/read-all` | **Yes** | Boolean set to true |
| `PUT /users/me/photo` | **Yes** | Replaces in place; a retry converges on the same photo |

**`Idempotency-Key` header:** no operation in that table needs it, and that is
deliberate. The operations that must be idempotent are already idempotent by
natural key or target state, which survives a client restart — an
`Idempotency-Key` store does not (it needs the same durable storage, plus an
expiry policy, for a worse result). For `POST /messages` the client-supplied
`client_message_id` is better than a server key: it is generated on the device,
so a retry after a crash identifies the same message even if the original key
record was lost.

**Where `Idempotency-Key` *would* earn its place:** future payment-like or
capacity-consuming operations (an internship application with a submission fee, a
promoted opportunity). Not in V1.

---

### Phase 2 — Authentication
`users`, Argon2id, JWT mint/validate, `signup`, `login`, `me`, and the
`get_current_user` dependency. **This is the gate for the entire project:** until
an account can be created and a token obtained, no authenticated screen works.
Choose the token strategy (§4.8) *here*, because it shapes `TokenResponse` and
every later route.

### Phase 3 — Users + Profiles
`/users/**`, `/profile` aggregate, `/profile/completeness`, privacy, preferences,
the six profile sections, `/skills/catalog`, `/onboarding/state`, and media
upload for the profile photo. Unblocks the candidate home, profile, all seven
profile section screens, and the entire onboarding wizard.

### Phase 4 — Connections
`connections` + `blocked_users`. The first domain that exercises relationships
and the first source of notifications. Depends on Phase 2 (identity).

### Phase 5 — Messaging
`conversations`, `conversation_members`, `messages`. Depends on Phase 4 —
messaging between strangers needs a relationship rule, and the `allow_messages`
privacy field has no meaning before profiles exist.

### Phase 6 — Notifications
The notification table, the type registry, and the read endpoints. Depends on
Phase 4 (its first producers) and Phase 5. Build the **count endpoint before**
any client badge is drawn.

### Phase 7 — LiveKit calls
LiveKit credentials in Render, the `livekit` dependency, `calls`, and token
minting. Depends on Phase 2 (identity) and Phase 5 if a conversation is
optional-but-preferred. **Requires a mobile SDK decision first** (§8.1) — this
is the one phase that cannot be completed backend-only.

### Phase 8 — Posts + Stories + Media
Re-create the contract in `docs/feed-api-contract.md`, plus story expiry and view
logic. Depends on Phase 3 (media upload is shared with profile photos).
Likes/comments/bookmarks stay out of V1 — the client has no caller for them.

### Phase 9 — Companies + Institutions + Opportunities
Two workspace domains with a membership model, plus read-only opportunity
discovery. Depends on Phase 2 and Phase 3 (a company needs an owner identity and
a logo). Independently shippable from messaging/calls.

### Phase 10 — Mobile integration
Run `integration.test.ts` against the new backend; replace each `StageScreen`
with a real screen **one domain at a time**, each with its query-key
invalidation. Depends on all preceding phases. Update the `navConfig.ts`
`implemented` flags and the route inventory **together**, or `routeTree.test.ts`
fails.
---

### Phase 11 — End-to-end testing
Full-stack: signup → onboard → connect → message → call → post → read an
opportunity. Plus the parity test from §21.1 against the real OpenAPI.

### Phase 12 — Production hardening
Rate limiting, security headers, disabling `/docs` in production, Argon2id
parameters measured on the free instance, the sweeper for stale `ringing` calls,
notification/message retention jobs, error monitoring, and load-testing the free
plan's cold-start behaviour.

## 23. Mobile / backend parity table

"Exists now?" refers to the **backend repository as inspected** — the answer is
`yes` for two rows and `no` for every other one. "Mobile API used" is the actual
call in `src/api/`, or `—` where the mobile app has no caller.

| Mobile feature | Mobile API used | Backend route | Exists? | V1? | Notes |
|---|---|---|---|---|---|
| Connection probe | `fetchHealth` | `GET /health` | **Yes** | Yes | Unauthenticated; must never touch the DB |
| API readiness | `fetchReadiness` | `GET /ready` | **Yes** | Yes | 503 when the DB is down |
| Sign up | `signup` | `POST /auth/signup` | No | **Yes** | `extra="forbid"`; must accept `phone: null` |
| Sign in | `login` | `POST /auth/login` | No | **Yes** | `401 invalid_credentials`, identical for both failure modes |
| Session resolve | `fetchPrincipal` | `GET /auth/me` | No | **Yes** | 403 ⇒ `forbidden`, drives role routing |
| Sign out | — (local clear) | `POST /auth/logout` | No | No | Unnecessary with stateless tokens (§4.4) |
| Token refresh | — | `POST /auth/refresh` | No | **No** | **Blocked** — `TokenResponse` has no `refresh_token` (§4.8) |
| Email verification | — | `POST /auth/verify-email` | No | No | Client documents the stack as having none |
| Password recovery | — | `POST /auth/forgot-password` | No | **[F]** | `reset-password.tsx` is an honest notice awaiting it |
| Password change | `changePassword` | `POST /users/me/password` | No | **Yes** | |
| Account deactivate | `deactivateAccount` | `POST /users/me/deactivate` | No | **Yes** | Soft; reactivates on next sign-in |
| Account delete | `deleteAccount` | `DELETE /users/me` | No | **Yes** | Body `{password, confirmation}` — `DELETE` with a body |
| My account | `fetchMe` | `GET /users/me` | No | **Yes** | |
| Update account | `updateMe` | `PATCH /users/me` | No | **Yes** | `email`/`username` need `current_password` |
| Handle availability | `checkUsername` | `GET /users/me/username/availability` | No | **Yes** | |
| User search | `lookupUsers` | `GET /users/lookup` | No | **Yes** | Bare array; respects `discoverable` |
| Public profile | `fetchPublicProfile` | `GET /users/{public_id}` | No | **Yes** | Fields **omitted**, not nulled (§5.3) |
| Profile photo | `uploadProfilePhoto` / `deleteProfilePhoto` | `PUT`/`DELETE /users/me/photo` | No | **Yes** | Raw body; returns updated `Me` |
| Profile aggregate | `fetchProfile` | `GET /profile` | No | **Yes** | One round trip for the whole screen |
| Edit profile | `updateIdentity` | `PATCH /profile` | No | **Yes** | Identity fields only |
| Completeness | `fetchCompleteness` | `GET /profile/completeness` | No | **Yes** | Server-derived; client may not compute |
| Privacy | `fetchPrivacy` / `replacePrivacy` | `GET`/`PUT /profile/privacy` | No | **Yes** | `PUT` = full state |
| Preferences | `fetchPreferences` / `replacePreferences` | `GET`/`PUT /profile/preferences` | No | **Yes** | Read before write |
| Skills CRUD | `fetchMySkills`/`addSkill`/`updateSkill`/`removeSkill` | `/profile/skills[/{id}]` | No | **Yes** | `Page<…>` |
| Skill catalogue | `searchSkillCatalog` | `GET /skills/catalog` | No | **Yes** | Database-backed |
| Education CRUD | `educationApi` | `/profile/education[/{id}]` | No | **Yes** | |
| Experience CRUD | `experienceApi` | `/profile/experience[/{id}]` | No | **Yes** | |
| Projects CRUD | `projectsApi` | `/profile/projects[/{id}]` | No | **Yes** | Create accepts `skill_ids[]` |
| Certificates CRUD | `certificationsApi` | `/profile/certifications[/{id}]` | No | **Yes** | |
| Community feed | `fetchPosts` | `GET /posts` | No | **Yes** | `PostPage` (`limit`/`offset`) |
| My posts | `fetchMyPosts` | `GET /posts/mine` | No | **Yes** | Real `total` |
| Create post | `createPost` | `POST /posts` | No | **Yes** | Render only after `201` |
| Edit / delete post | `updatePost` / `deletePost` | `PATCH`/`DELETE /posts/{id}` | No | **Yes** | Owner only; soft delete |
| Post detail | — | `GET /posts/{id}` | No | **[F]** | In the feed contract, no caller |
| Likes | — (device-local) | `POST`/`DELETE /posts/{id}/like` | No | No | No client caller; stage 2 |
| Comments | — (empty state) | `/posts/{id}/comments` | No | No | No client caller; stage 2 |
| Bookmarks / saved | — (device-local) | `/posts/{id}/bookmark` | No | No | `/saved` is a `StageScreen` |
| Stories feed | `fetchStories` | `GET /stories` | No | **Yes** | `FastApiPage` |
| Story detail | `fetchStory` | `GET /stories/{id}` | No | **Yes** | |
| Record story view | `recordStoryView` | `POST /stories/{id}/view` | No | **Yes** | Idempotent |
| Publish story | — | `POST /stories` | No | No | Server/platform-published |
| Media limits | `fetchMediaLimits` | `GET /media` | No | **Yes** | Limits document, not a list |
| Image upload | `uploadPickedImage` | `POST /media` | No | **Yes** | Raw body; real progress |
| Private document | `uploadDocument` | `POST /media/{id}` (document) | No | **Yes** | PDF, owner-only |
| Media read | `authenticatedImageSource` | `GET /media/{id}` | No | **Yes** | Uploader only; bearer attached |
| Resumes | resumes API | `/resumes[/{id}]` | No | **Yes** | Server-generated snapshots |
| My companies | `fetchMyCompanies` | `GET /companies/mine` | No | **Yes** | Bare array |
| Create company | `createCompany` | `POST /companies` | No | **Yes** | Creator becomes owner atomically |
| Company detail | `fetchCompany` / `updateCompany` | `GET`/`PATCH /companies/{id}` | No | **Yes** | `slug`, `verification_status` server-owned |
| Verification request | `requestVerification` | `POST /companies/{id}/verification-request` | No | **Yes** | Request-only; never sets `verified` |
| Members | members API | `/companies/{id}/members[/{member_id}]` | No | **Yes** | Non-member ⇒ `404`; candidate ⇒ `403` |
| Accept invite | `acceptMyInvitation` | `POST /companies/{id}/members/me/accept` | No | **Yes** | |
| Institutions | institutions API | `/institutions[/{id}]` | No | **Yes** | Owner-scoped ⇒ `404` |
| Programs | programs API | `/institutions/{id}/programs[/{program_id}]` | No | **Yes** | `program_count` is a real `COUNT` |
| Opportunities | `fetchOpportunities` / `fetchOpportunity` | `GET /opportunities[/{id}]` | No | **Yes** | `FastApiPage`; read-only in V1 |
| Applications | — | `/applications` | No | No | `/applications` is a `StageScreen` |
| Post a job | — | `POST /opportunities` | No | No | `/employer/jobs/new` is `implemented: false` |
| Messaging | — | `/conversations`, `/messages` | No | **[F]** | No client module, no WebSocket (§7) |
| Calls | — | `/calls` | No | **[F]** | No LiveKit SDK, no call screen (§8) |
| Notifications | — | `/notifications` | No | **[F]** | `StageScreen`; no badge anywhere |
| Push devices | `pushDevices` | `/notifications/devices` | **Yes** | **Yes** | Phase 4. `src/api/pushDevices.ts`; permission → token → register on authenticated start, unregister on logout |

**Totals: 2 routes exist; 76 are proposed; 12 of those have no mobile caller
today** — logout, refresh, verify-email, profile links, connections
requests/sent, post detail, likes, comments, bookmarks, publish story,
applications, and post-a-job.

| Achievements CRUD | `achievementsApi` | `/profile/achievements[/{id}]` | No | **Yes** | `category` required |
| Profile links | — (read via aggregate) | `/profile/links[/{id}]` | No | **[F]** | No client writer |
---

## 24. Current state vs target state

### 24.1 Already implemented (verified in this repository)

**Backend**
- `GET /api/v1/health` — liveness, unauthenticated, never touches the database
- `GET /api/v1/ready` — readiness, checks the database, 503 on failure
- The `api_router` composition point in `app/api/v1/router.py`
- The error envelope, `ErrorCode`, `DEFAULT_MESSAGES`, and `ApiError`
- Four exception handlers: `ApiError`, `RequestValidationError`,
  `HTTPException` (registered on the Starlette class so 404s are covered), and
  the catch-all `Exception`
- `Settings` with DSN normalisation and a fail-closed production validator
- SQLAlchemy engine with `pool_pre_ping`, `session_scope`, `get_db`,
  `ping_database` (which returns only an exception class name)
- JSON structured logging that never logs settings, URLs or bodies
- Alembic wired to application settings, with `-x db_url=` override,
  `compare_type`, `compare_server_default`, and `transaction_per_migration`
- `render.yaml` for `mahaa-backend` with no database resource; `DATABASE_URL`
  supplied by the dashboard
- `tests/test_health.py` — a no-database suite asserting the envelope contract
  and the fail-closed rules

**Mobile (the client contract this specification must satisfy)**
- One HTTP client with bearer attachment, timeout, abort, and error mapping
- A typed error vocabulary including `invalid_credentials`
- Auth: signup, login, `/auth/me`, secure token storage, role-aware routing
- API modules for auth, users, profile (all six sections), onboarding,
  connections, posts, stories, media, opportunities, companies, institutions,
  resumes, health
- TypeScript mirrors of every schema, including the two pagination envelopes
- `navConfig.ts` as a single route inventory, enforced against disk by
  `routeTree.test.ts`
- `StageScreen` for every domain the backend does not serve — 13 screens carry an
  honest notice rather than fake content
- A live integration suite that runs the real client against a real server
- `docs/feed-api-contract.md` — the surviving posts/media design document

### 24.2 Planned (required for V1, not implemented)

Every row in the §23 table marked **Yes** or **[F]**: the entire auth domain;
users and the profile aggregate with all six sections; the skill catalogue;
onboarding state; connections; media upload and serving; posts; stories with
expiry; opportunities; companies and institutions with membership; resumes; and
the design decisions in §4.8, §7.2, §10.2, §11.3, §17 and §18.

**Also planned but not route work:** the Phase 1 migration set, an `argon2-cffi`
dependency, a `livekit` dependency in Phase 7, and the new environment variables
in §19.2.

### 24.3 Unknown (cannot be confirmed from this repository)

1. **The deleted `apps/api` implementation.** Every mobile comment citing
   `apps/api/app/schemas/…` points at source that no longer exists. This document
   reconstructs the contract from the TypeScript types and the mobile docstrings —
   high confidence, but the original server behaviour is unrecoverable.
2. **Whether the previously documented 58 OpenAPI operations included routes the
   mobile app never calls.** The count is quoted from the mobile test's own
   comment; it cannot be re-verified.
3. **Whether `/docs` returning `404` on the deployed service was deliberate
### 24.4 Blockers

| # | Blocker | Why it matters | Resolution |
|---|---|---|---|
| 1 | **No migration revisions exist** | `alembic/versions/` holds only `.gitkeep`, so Neon has no application tables and `upgrade head` is a no-op. Nothing can be written until Phase 1 lands | Phase 1. Confirm with `alembic current` against a **non-production** database first |
| 2 | **No password library** | `requirements.txt` has no Argon2id/bcrypt, so `POST /auth/signup` cannot exist | Add `argon2-cffi` in Phase 2, after measuring memory on the free instance (§4.9) |
| 3 | **No token strategy chosen** | §4.8 is a decision, not a fact. It determines `TokenResponse`, the mobile store, and whether logout/refresh exist at all | Decide before Phase 2 |
| 4 | **No LiveKit account or credentials** | Phase 7 cannot start. `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` must exist in Render before any call route ships | Provision the project; set the two secrets in the dashboard |
| 5 | **No LiveKit mobile SDK** | Phase 7 is the one phase that cannot be completed backend-only. The app cannot join a room without `livekit-react-native` | Mobile decision: add the SDK, or ship calls as signalling-only in V1 |
| 6 | **`ErrorCode.invalid_credentials` does not exist** | `POST /auth/login` must return this exact code or the client's error handling degrades | Add it in Phase 2 |
| 7 | **No object storage for media bytes** | Render's local disk is ephemeral, and the prior contract rejected it deliberately. Storing large binaries in Neon inflates the free plan's storage | Choose before Phase 8: keep the `storage_kind` abstraction and point it at a bucket |
| 8 | **Rate limiting has no store** | An in-process counter resets on every redeploy and is per-instance | Needed before Phase 2 ships, enforced from Phase 12 |
| 9 | **`/docs` is open in production** | Full route inventory published, contradicting the documented deployed behaviour | Disable when `is_production` — Phase 12 (§25.2) |
| 10 | **The free plan spins down** | Cold starts threaten the 15s client timeout budget and long-poll assumptions; WebSocket is effectively unavailable | Accepted for V1 (§7.2). Re-evaluate at Phase 12 |
| 11 | **The mobile suite is skipped without a server** | Parity goes unverified on a machine with no backend | Keep the skip (so `npm test` stays green) but run it in CI against a real service |

---

## 25. Discovered problems — documented, not fixed

Per the task rules, nothing below was changed. Each is recorded with why it
matters and what is proposed.

### 25.1 `render.yaml` and `.env.example` disagree about `DATABASE_URL`

`.env.example` still says: *"On Render this is supplied automatically by the
Blueprint's `fromDatabase` reference — do not type a connection string there."*
The Blueprint no longer has a `fromDatabase`; `DATABASE_URL` is `sync: false` and
comes from the dashboard. **Why it matters:** a developer following the comment
would believe the string is auto-generated and might not set it, or look for it
in the wrong place during an incident. **Proposed:** correct the comment in a
documentation-only commit.

### 25.2 `/docs`, `/redoc` and `/openapi.json` are enabled in production

`create_app()` passes them unconditionally. **Why it matters:** a published
OpenAPI document is a complete route inventory with schema shapes and validation
rules — free reconnaissance, and it contradicts the mobile README's statement
that the deployed service returns `404` for `/docs`. **Proposed:** pass `None`
for all three when `settings.is_production`. A one-line change in `app/main.py`,
deliberately **not** made here.

### 25.3 `ErrorCode` has no `invalid_credentials`

The mobile client switches on it, the integration suite asserts it, and the
correct `POST /auth/login` failure needs it. The backend class does not define it,
so a new code would be invented ad hoc at the call site. **Why it matters:** an
ad-hoc string is exactly what the envelope exists to prevent. **Proposed:** add
`INVALID_CREDENTIALS = "invalid_credentials"` in Phase 2, beside the 401 that
uses it.

### 25.4 The mobile README describes a deleted backend

`README.md` is written against `apps/api` and instructs `cd C:\mahajob\apps\api`.
That path does not exist; the backend is at `C:\mahaa\backend`. **Why it
matters:** it is the first thing a new developer reads, and every command in it
is wrong. **Proposed:** a documentation-only rewrite. Out of scope here — the
task forbids modifying READMEs.

### 25.5 A stale line in `docs/feed-api-contract.md`

Its §"Media" says the app fetches media with `expo-image` "(no `Authorization`
header), so a private asset store needs signed URLs". `src/api/media.ts` does the
opposite — `authenticatedImageSource` attaches the bearer, and the API serves
bytes to the uploader only. **Why it matters:** following the doc would push an
implementation toward public media URLs and break uploader-only access.
**Proposed:** correct the line. The client code is authoritative.

### 25.6 Two pagination envelopes, deliberately

`Page<T>` (`limit`/`offset`) and `FastApiPage<T>` (`page`/`page_size`) coexist
across `/posts` and `/stories`. **Why it matters:** it is a real inconsistency and
a reviewer will ask. But both are already encoded in the client's return types,
and unifying them is a breaking change across two API modules and several screens
for no user-visible gain. **Proposed:** keep both in V1 (§17); unify later in a
single deliberate change, or add keyset for the unbounded new endpoints only.

### 25.7 `SessionLocal` is created at import time

`app/db/session.py` builds the engine at module import, from a settings object
resolved at import. **Why it matters:** tests cannot swap the database without
patching the module, which is why `tests/test_health.py` monkeypatches instead of
using a fixture. It also means the engine is created even for a process that never
touches the database. **Proposed:** leave as is. It is a deliberate trade for a
single reusable pool, it works, and no phase requires changing it.

### 25.8 `pool_size=5, max_overflow=5` on a free plan

Ten concurrent connections against Neon from a free Render instance is plausible
under load. **Why it matters:** exceeding it raises rather than queues, and a pool
timeout surfaces as a 500. **Why it is left alone:** the numbers are defensible
and untested; tuning them without load data would be guessing. **Proposed:**
measure in Phase 12 before changing either value.

---

## Appendix — the honest summary

The Mahaa backend in this repository is a **carefully built, well-documented
scaffold** with two working routes, a correct error contract, fail-closed
configuration, and a real test suite. The Mahaa mobile app is a **mature client**
whose API modules, TypeScript contracts and integration suite were written
against a backend that has since been deleted.

The gap is not a design problem. It is a **volume** problem: roughly 76 routes and
30 tables must be rebuilt to satisfy a client that already knows exactly what it
expects. This document's job was to make that gap explicit and to record, from
the client's own code, the exact contracts that must be honoured — because that
information exists nowhere else in the repository.

The most valuable single artefact in this project is
`src/api/integration.test.ts`. It is a ready-made parity harness written against
58 operations. It should be pointed at the rebuilt backend continuously from
Phase 2 onward, because it is what turns "the app and the API agree" from an
assumption into a fact.

---

*Design document only. No endpoint, model, migration, dependency, configuration
or deployment was created, modified, run or published in producing it. The only
file written is this one.*
