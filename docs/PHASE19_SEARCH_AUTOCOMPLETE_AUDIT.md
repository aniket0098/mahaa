# PHASE 19 — MahaJob Search Autocomplete Audit

Date: 2026-11-14
Repository: `C:\mahaa` (`@mahajob/mobile`, Expo SDK ~57, React Native 0.86)
Status: **Audit complete — existing implementation verified**

## 1. Main search bar

| Component | File | Role |
|---|---|---|
| DashboardHeader search pill | `src/features/home/DashboardHeader.tsx` | Compact "Search people or skills…" → expands to `TextInput` on tap |
| Search state | `DashboardHeader.tsx` | `useState('query')`, `usePeopleSearch(query, principal.public_id)` |
| Minimum query length | `DashboardHeader.tsx` | `MIN_QUERY_LENGTH = 2` |
| Search expansion | `DashboardHeader.tsx` | In-place swap; results drop below the row |
| People search hook | `src/features/people/usePeopleSearch.ts` | Debounced `GET /users/lookup`; 300 ms; per-term React Query keys |
| Loading / empty / error | `DashboardHeader.tsx` | "Searching people…", "No people match…", Retry banner |
| Self-exclusion | `usePeopleSearch.ts` | `excludeSelf(lookup.data, selfPublicId)` |
| Server-side restrictions | `usePeopleSearch.ts` | Respects discoverability (`_is_discoverable()`) + `UserStatus.ACTIVE` (PHASE 17) |

## 2. People search hook

| Feature | File | Implementation |
|---|---|---|
| Debounce | `src/features/people/usePeopleSearch.ts` | `PEOPLE_SEARCH_DEBOUNCE_MS = 300`; `useState('')` + `setTimeout` |
| Minimum length | `usePeopleSearch.ts` | `PEOPLE_MIN_QUERY_LENGTH = 2` |
| Per-term cache keys | `usePeopleSearch.ts` | `queryKeys.userLookup(activeTerm)` — stale answers cannot cross terms |
| Server lookup | `usePeopleSearch.ts` → `src/api/users.ts` `lookupUsers` | `GET /users/lookup?query=…` |
| Response filter | `src/features/people/peopleSearch.ts` `lookupUsers` | Name → discoverable only; exact handle/public_id regardless |
| Caller excluded | `usePeopleSearch.ts` | `excludeSelf(lookup.data, selfPublicId)` |
| Empty/error states | `DashboardHeader.tsx` + `PeopleSearchResults.tsx` | Loading "Searching people…", empty "No people match…", error + Retry |
| Safe fields only | `UserSummary` (onboarding.ts) | `user_id`, `public_id`, `username`, `name`, `role`, `avatar_url` — no email/phone/token |

## 3. Suggestion rows

| Component | File | Rendered fields |
|---|---|---|
| Suggestion row | `src/features/people/PeopleSearchResults.tsx` + `SuggestionRow.tsx` | Avatar (with initials fallback), name, `@username`, Connect action |
| Connect state logic | `usePersonConnection(person.public_id, selfPublicId)` | Derives state from `/connections` list; offers Connect / Requested / Respond / Connected |
| State labels | `peopleSearch.ts` `personAction()` | none → "Connect"; outgoing_pending → "Requested"; incoming_pending → "Respond"; connected → "Connected" |
| Self-exclusion in results | `peopleSearch.tsx` `excludeSelf()` | Caller dropped before rows reach UI |
| Profile navigation | `SuggestionRow.onPress` | `router.push(`/user/${encodeURIComponent(person.public_id)}`)` |
| Connect → send request | `SuggestionRow` Connect button → `connection.send` → `usePersonConnection.send` → `POST /connections {user_id}` |

## 4. Connection request API

| Function | File | Endpoint |
|---|---|---|
| `sendConnectionRequest` | `src/api/connections.ts` | `POST /connections {user_id}` |
| `acceptConnection` | `src/api/connections.ts` | `POST /connections/{id}/accept` |
| `declineConnection` | `src/api/connections.ts` | `POST /connections/{id}/decline` |
| `cancelConnection` | `src/api/connections.ts` | `POST /connections/{id}/cancel` |
| `listConnections` | `src/api/connections.ts` | `GET /connections?status=…` |

## 5. Notification API (recipient side)

| Endpoint | File | Purpose |
|---|---|---|
| `GET /notifications` | `src/api/notifications.ts` | List caller's own notifications |
| `GET /notifications/unread-count` | `src/api/notifications.ts` | Server's unread count (bell badge) |
| `POST /connections/{id}/accept` | `backend/app/api/v1/endpoints/connections.py` | Accept request; transactional notification creation |
| `POST /connections/{id}/decline` | `src/api/connections.ts` + backend | Decline request |
| Notification inbox | `src/app/(candidate)/notifications.tsx` | Full inbox with Accept/Decline per `connection_request` |

## 6. Messages integration

| Component | File | Behavior |
|---|---|---|
| `openConversation` | `src/api/messages.ts` | `POST /conversations {user_id}` → 403 if not connected |
| `fetchConversation` | `src/api/messages.ts` | `GET /conversations/{id}` → participant-only 404 |
| `listMessages` | `src/api/messages.ts` | Keyset pagination `cursor`/`since` |
| Conversation screen | `src/app/(candidate)/conversation/[id].tsx` | Display, send/receive messages |
| Participant enforcement | Backend `/conversations` | 404 for non-members |

## 7. Existing Accept/Decline UX

| Screen | File | What's rendered |
|---|---|---|
| Profile screen connection pill | `PersonConnectionAction.tsx` | Accept / Decline buttons for `incoming_pending` |
| Notifications bell inbox | `src/app/(candidate)/notifications.tsx` | Accept / Decline per `connection_request` |
| Search results | `PeopleSearchResults.tsx` | Shows pill: "Respond" for incoming_pending; no Accept/Decline in search |

## 8. Honest status (pre-change)

- All functional requirements already implemented end-to-end
- No backend changes needed (PHASE 17 lookup fix already deployed)
- No new API endpoints
- UX refinements only: role headline, person-plus icon, Accept/Decline parity in search results