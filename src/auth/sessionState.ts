/**
 * Session state transitions — the pure decision layer behind `AuthProvider`.
 *
 * `AuthProvider` is a React component, so the rules that decide whether a failed
 * session resolve logs the user out cannot be unit-tested in place: this project
 * runs its suite in Node with no React renderer (see `vitest.config.mts`). The
 * decisions are therefore made here, as pure functions — exactly as
 * `roleHome.ts`, `roleGuardLogic.ts` and `callMachine.ts` do for their domains.
 *
 * **The one rule this module exists to enforce:** a session resolve fails for two
 * very different reasons, and they must never be treated the same.
 *
 *   - The backend *rejected the credentials* — a 401 `not_authenticated` from
 *     `GET /auth/me`, which per `backend/app/api/deps.py` is the answer for an
 *     expired, forged, or unknown-subject token. That is proof the session is
 *     dead, so the token is cleared and the state becomes `unauthenticated`.
 *   - The backend could not be *reached or answered* — a network error, a
 *     timeout, or a 5xx. That says nothing about the token, which is very often
 *     still perfectly valid. Clearing it here is what logged a healthy user out
 *     the moment their train entered a tunnel. So the token is preserved, the
 *     state stays `loading`, and a retry is surfaced instead of a sign-out.
 *
 * A 403 `forbidden` is a third, distinct case — a known, authenticated account
 * that is suspended — and keeps the `forbidden` status the app already renders.
 */

import { ApiError } from '@/api/errors';
import type { AuthStatus, Principal } from '@/types/auth';

/** Why a session resolve failed, reduced to the distinction that matters. */
export type SessionFailureKind = 'invalid' | 'forbidden' | 'transient';

/**
 * Classify a thrown session-resolve error.
 *
 * `GET /auth/me` is guarded by `get_current_user`, whose contract is:
 *   - 401 `not_authenticated` for a missing/expired/forged token or a subject
 *     that no longer exists  -> the credentials are genuinely invalid;
 *   - 403 `forbidden` for a suspended account -> authenticated, not permitted;
 *   - everything else the transport raises (network, timeout) or the server
 *     raises (5xx) -> transient, and never evidence about the token.
 *
 * A non-`ApiError` (a bug, a thrown string) is treated as transient: the safe
 * direction, because it preserves the session rather than destroying it on a
 * fault that was never the token's doing.
 */
export function classifySessionError(error: unknown): SessionFailureKind {
  if (error instanceof ApiError) {
    if (error.isUnauthenticated) return 'invalid';
    if (error.isForbidden) return 'forbidden';
  }
  return 'transient';
}

/**
 * The line shown to the user for a transient failure, or `null` when the error
 * is not transient. Reuses the transport's own message when there is one (it
 * already names the unreachable URL and the device-configuration case), and
 * falls back to a generic sentence otherwise.
 */
export function describeSessionError(error: unknown): string | null {
  if (classifySessionError(error) !== 'transient') return null;
  if (error instanceof ApiError) return error.message;
  return "We couldn't verify your session. Check your connection and try again.";
}

export interface SessionTransition {
  status: AuthStatus;
  principal: Principal | null;
  /** A retryable message for a transient failure, else `null`. */
  sessionError: string | null;
  /** True when the stored token must be dropped as a result of this transition. */
  clearToken: boolean;
}

export type ResolutionResult =
  | { ok: true; principal: Principal }
  | { ok: false; error: unknown };

/**
 * The state a session resolve settles into, and whether it costs the token.
 *
 *   - `ok`         -> `authenticated`, token kept;
 *   - `invalid`    -> `unauthenticated`, token dropped (the session is dead);
 *   - `forbidden`  -> `forbidden`, token dropped (matches the app's existing
 *                     suspended-account flow, which already signs the user out);
 *   - `transient`  -> `loading`, token kept, a retryable `sessionError` exposed.
 *
 * The `transient` branch is the regression this fixes: it used to fall through
 * to `unauthenticated` and clear the token, so a network blip at launch logged a
 * valid user out.
 */
export function transitionOnResolution(result: ResolutionResult): SessionTransition {
  if (result.ok) {
    return {
      status: 'authenticated',
      principal: result.principal,
      sessionError: null,
      clearToken: false,
    };
  }

  switch (classifySessionError(result.error)) {
    case 'invalid':
      return { status: 'unauthenticated', principal: null, sessionError: null, clearToken: true };
    case 'forbidden':
      return { status: 'forbidden', principal: null, sessionError: null, clearToken: true };
    case 'transient':
      return {
        status: 'loading',
        principal: null,
        sessionError: describeSessionError(result.error),
        clearToken: false,
      };
  }
}

/**
 * The state an explicit sign-out settles into. Always costs the token, and is
 * kept separate from {@link transitionOnResolution} so an intentional logout can
 * never be confused with a failed resolve.
 */
export function transitionOnLogout(): SessionTransition {
  return { status: 'unauthenticated', principal: null, sessionError: null, clearToken: true };
}
