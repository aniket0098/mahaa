/**
 * Regression tests for session-state decisions.
 *
 * The bug: `AuthProvider.resolveSession` cleared the stored token on *any*
 * failure of `GET /auth/me` — a network error, a timeout, a 5xx — so a valid user
 * was logged out the moment their connection blipped. The decision now lives in
 * the pure `@/auth/sessionState` module (this project runs its suite in Node with
 * no React renderer, exactly as `roleGuardLogic.ts` and `callMachine.ts` do), so
 * the rule is pinned here rather than left to a device walkthrough.
 *
 * The rule, from `backend/app/api/deps.py`:
 *   - 401 `not_authenticated` = the token is genuinely invalid/expired  -> sign out;
 *   - 403 `forbidden`         = a known, suspended account              -> forbidden;
 *   - network / timeout / 5xx = the backend could not be reached       -> transient,
 *     keep the token, hold `loading`, expose a retry.
 */

import { describe, expect, it } from 'vitest';

import { ApiError, API_ERROR_CODES } from '@/api/errors';
import type { Principal } from '@/types/auth';
import {
  classifySessionError,
  describeSessionError,
  transitionOnLogout,
  transitionOnResolution,
} from '@/auth/sessionState';

function principal(): Principal {
  return {
    id: 'u-1',
    public_id: 'MJ-ABCD1234',
    username: 'ada',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'candidate',
    memberships: [],
  };
}

const unauthenticated = () =>
  new ApiError({ status: 401, code: API_ERROR_CODES.notAuthenticated, message: 'Your session has expired.' });
const forbidden = () =>
  new ApiError({ status: 403, code: API_ERROR_CODES.forbidden, message: 'This account is not available.' });
const networkError = () =>
  new ApiError({ status: 0, code: API_ERROR_CODES.network, message: 'Network request failed.' });
const timeout = () =>
  new ApiError({ status: 0, code: API_ERROR_CODES.timeout, message: 'The request timed out.' });
const serverError = () =>
  new ApiError({ status: 500, code: API_ERROR_CODES.internalError, message: 'Something went wrong.' });

describe('classifySessionError — the distinction that matters', () => {
  it('treats a 401 as a genuinely invalid session', () => {
    expect(classifySessionError(unauthenticated())).toBe('invalid');
  });

  it('treats a 403 as a forbidden (suspended) account, not an invalid session', () => {
    expect(classifySessionError(forbidden())).toBe('forbidden');
  });

  it('treats a network error as transient', () => {
    expect(classifySessionError(networkError())).toBe('transient');
  });

  it('treats a timeout as transient', () => {
    expect(classifySessionError(timeout())).toBe('transient');
  });

  it('treats a 5xx as transient', () => {
    expect(classifySessionError(serverError())).toBe('transient');
  });

  it('treats a non-auth 4xx (404/409/422) as transient, never as a dead session', () => {
    // A 404/409/422 from /auth/me is not the token being invalid; it must not be
    // read as "sign in again". The safe direction is to preserve the session.
    expect(classifySessionError(new ApiError({ status: 404, code: API_ERROR_CODES.notFound, message: 'Not found.' }))).toBe('transient');
    expect(classifySessionError(new ApiError({ status: 409, code: API_ERROR_CODES.conflict, message: 'Conflict.' }))).toBe('transient');
    expect(
      classifySessionError(new ApiError({ status: 422, code: API_ERROR_CODES.validationError, message: 'Invalid.' })),
    ).toBe('transient');
  });

  it('treats a thrown non-ApiError as transient (preserve, never destroy on a fault)', () => {
    expect(classifySessionError(new Error('boom'))).toBe('transient');
    expect(classifySessionError('a string')).toBe('transient');
    expect(classifySessionError(undefined)).toBe('transient');
  });
});

describe('transitionOnResolution — a successful resolve authenticates', () => {
  it('authenticates, keeps the principal, and never clears the token', () => {
    const me = principal();
    const t = transitionOnResolution({ ok: true, principal: me });
    expect(t.status).toBe('authenticated');
    expect(t.principal).toBe(me);
    expect(t.clearToken).toBe(false);
    expect(t.sessionError).toBeNull();
  });
});

describe('transitionOnResolution — a confirmed invalid/expired session signs out', () => {
  it('a 401 becomes unauthenticated and drops the token', () => {
    const t = transitionOnResolution({ ok: false, error: unauthenticated() });
    expect(t.status).toBe('unauthenticated');
    expect(t.principal).toBeNull();
    expect(t.clearToken).toBe(true);
    expect(t.sessionError).toBeNull();
  });

  it('a 403 becomes forbidden and drops the token (suspended account flow)', () => {
    const t = transitionOnResolution({ ok: false, error: forbidden() });
    expect(t.status).toBe('forbidden');
    expect(t.clearToken).toBe(true);
  });
});

describe('transitionOnResolution — transient failures preserve the session', () => {
  // The regression. Each of these used to clear the token and land on
  // `unauthenticated`, logging a valid user out on a momentary blip.
  const transientErrors: Record<string, unknown> = {
    network: networkError(),
    timeout: timeout(),
    server500: serverError(),
    server503: new ApiError({ status: 503, code: API_ERROR_CODES.serviceUnavailable, message: 'Unavailable.' }),
    nonApiError: new Error('unexpected'),
  };

  for (const [name, error] of Object.entries(transientErrors)) {
    it(`a ${name} failure keeps the token, holds loading, and exposes a retry`, () => {
      const t = transitionOnResolution({ ok: false, error });
      expect(t.status).toBe('loading');
      expect(t.principal).toBeNull();
      expect(t.clearToken).toBe(false);
      expect(typeof t.sessionError).toBe('string');
      expect((t.sessionError ?? '').length).toBeGreaterThan(0);
    });
  }

  it('reuses the transport message for a transient ApiError', () => {
    const t = transitionOnResolution({ ok: false, error: networkError() });
    expect(t.sessionError).toBe('Network request failed.');
  });

  it('falls back to a generic sentence for a non-ApiError', () => {
    const t = transitionOnResolution({ ok: false, error: new Error('boom') });
    expect(t.sessionError).toMatch(/couldn't verify your session/i);
  });
});

describe('transitionOnResolution — a retry restores authenticated navigation', () => {
  it('after a transient failure, a later success authenticates with no residue', () => {
    // First attempt: connectivity is down.
    const failed = transitionOnResolution({ ok: false, error: networkError() });
    expect(failed.status).toBe('loading');
    expect(failed.clearToken).toBe(false);

    // Retry once connectivity returns.
    const me = principal();
    const retried = transitionOnResolution({ ok: true, principal: me });
    expect(retried.status).toBe('authenticated');
    expect(retried.principal).toBe(me);
    expect(retried.sessionError).toBeNull();
    expect(retried.clearToken).toBe(false);
  });
});

describe('describeSessionError', () => {
  it('returns a message for a transient error', () => {
    expect(describeSessionError(timeout())).toBe('The request timed out.');
  });

  it('returns null for a genuine auth failure (there is nothing to retry)', () => {
    expect(describeSessionError(unauthenticated())).toBeNull();
    expect(describeSessionError(forbidden())).toBeNull();
  });
});

describe('transitionOnLogout — an explicit sign-out always clears the session', () => {
  it('settles unauthenticated and drops the token', () => {
    const t = transitionOnLogout();
    expect(t.status).toBe('unauthenticated');
    expect(t.principal).toBeNull();
    expect(t.clearToken).toBe(true);
    expect(t.sessionError).toBeNull();
  });
});

