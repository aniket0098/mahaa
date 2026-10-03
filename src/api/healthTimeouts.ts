/**
 * Timeout budgets for the connection probes (`GET /health`, `GET /ready`).
 *
 * Pure data, kept in its own module so it is unit testable in Node:
 * `health.ts` imports `@/api/client`, which reaches `react-native` through
 * `@/lib/env`, and importing that from a Node test would pull React Native's
 * Flow sources into the runner. This is the same split as
 * `@/features/connection/connectionHints` and `@/lib/apiBaseUrl`.
 *
 * **Why the probe needs a longer budget than an ordinary request.**
 *
 * The API is hosted on Render's Free tier, which spins the service *down* when
 * idle and wakes it on the next request. A cold start on the production host
 * was measured at **33.6 seconds** (`GET /health`, from a browser on this
 * project) before the service returned 200. Every request made during that
 * window is accepted by the socket and then simply held open while the
 * container boots — the connection is alive and slow, not broken.
 *
 * The probe used to allow 8 seconds, so it aborted mid-wake-up and the sign-in
 * screen reported "The request timed out. Please try again." against an API
 * that was about to become healthy. That is a false negative, and a false
 * negative on a diagnostic panel is worse than no panel: it tells somebody the
 * backend is down when it is merely asleep.
 *
 * **Why this does not slow down real failures.** An unreachable host — DNS
 * failure, connection refused, TLS failure — fails `fetch` on its own within
 * milliseconds, and the AbortController timer never gets a chance to matter.
 * Only a slow-but-alive connection (exactly the cold-start case) consumes the
 * budget. Genuine failures therefore still surface fast; they are simply not
 * mistaken for slow ones.
 *
 * Only the probes use this. `DEFAULT_TIMEOUT_MS` in `@/api/client` still governs
 * every ordinary API call, and this budget deliberately does not leak into it —
 * a login or a feed request should keep failing in ~15 seconds rather than
 * hanging for the probe's 45.
 */

/**
 * The lower bound a cold start must fit inside, from the measured production
 * figure. Exported so the test below asserts the *relationship* that matters
 * rather than restating a number.
 */
export const RENDER_FREE_COLD_START_FLOOR_MS = 34_000;

/**
 * Ceiling for the probe budget. Long enough to clear the floor with headroom,
 * short enough that a genuinely stuck service still resolves to a failure
 * state instead of leaving the panel spinning indefinitely.
 */
export const PROBE_TIMEOUT_CEILING_MS = 45_000;

/**
 * Budget for `GET /health` and `GET /ready`.
 *
 * 45s: ~11s of headroom over the measured 33.6s wake-up, which absorbs a
 * slower-than-usual boot without turning a 45-second hang into a 60-second one.
 * The panel renders a live `ActivityIndicator` and skeleton for the duration,
 * so the wait is visible and honest rather than a frozen screen.
 */
export const HEALTH_PROBE_TIMEOUT_MS = 45_000;