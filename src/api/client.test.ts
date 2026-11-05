/**
 * Regression tests for per-service 401 isolation in the API client.
 *
 * The bug: `ApiClient.request` cleared the shared token and fired the auth
 * provider's unauthorized listener on *any* 401, from *any* instance. The
 * message service (`createApiClient`) presents the same bearer to a different
 * backend, so its 401 cleared the main app's session and bounced a healthy user
 * to login — even though the main API had said nothing about the token.
 *
 * The fix: an instance opts into session ownership (`ownsSession`). Only the main
 * `apiClient` has it. A non-owning client still surfaces the 401 to its caller as
 * a normal `ApiError` (so the feature can act on it), but never touches the
 * shared token or notifies the auth provider.
 *
 * These run the REAL `ApiClient` against a mocked `fetch`, `tokenStorage` and
 * `env` — the same substitution `integration.test.ts` uses. Nothing is stubbed at
 * the transport layer, so the 401 branch under test is the real code.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  token: 'main-token' as string | null,
  cleared: 0,
  needsDeviceConfiguration: false,
}));

vi.mock('@/auth/tokenStorage', () => ({
  tokenStorage: {
    get: async () => h.token,
    set: async (token: string) => {
      h.token = token;
    },
    clear: async () => {
      h.token = null;
      h.cleared += 1;
    },
  },
}));

vi.mock('@/lib/env', () => ({
  env: {
    apiBaseUrl: 'http://api.test/api/v1',
    needsDeviceConfiguration: false,
  },
}));

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const AUTH_ENVELOPE = { error: { code: 'not_authenticated', message: 'Your session has expired.' } };

beforeEach(() => {
  h.token = 'main-token';
  h.cleared = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('main API client — a genuine 401 signs the session out', () => {
  it('clears the shared token and notifies the auth provider exactly once', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(401, AUTH_ENVELOPE));
    vi.stubGlobal('fetch', fetchMock);

    const { ApiClient } = await import('@/api/client');
    const client = new ApiClient('http://api.test/api/v1', { ownsSession: true });

    const notified = vi.fn();
    client.onUnauthorized(notified);

    const error = await client.get('/auth/me').catch((cause: unknown) => cause);
    const { ApiError } = await import('@/api/errors');

    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).isUnauthenticated).toBe(true);
    // The token is gone and the provider was told — the genuine path.
    expect(h.token).toBeNull();
    expect(h.cleared).toBe(1);
    expect(notified).toHaveBeenCalledTimes(1);
  });
});

describe('message-service client — a 401 does NOT sign the main app out', () => {
  it('raises the 401 to the caller but leaves the shared token untouched', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(401, AUTH_ENVELOPE));
    vi.stubGlobal('fetch', fetchMock);

    const { createApiClient } = await import('@/api/client');
    const messageClient = createApiClient('http://message.test/api/v1');

    // A listener registered the way AuthProvider does it — but on the *main*
    // client. The message-service client has no such listener and ownsSession is
    // false, so a 401 here must reach neither the token nor any notification.
    const { ApiClient } = await import('@/api/client');
    const mainClient = new ApiClient('http://api.test/api/v1', { ownsSession: true });
    const mainNotified = vi.fn();
    mainClient.onUnauthorized(mainNotified);

    const error = await messageClient.get('/message-requests').catch((cause: unknown) => cause);
    const { ApiError } = await import('@/api/errors');

    // The caller still gets a proper, actionable error — not silence.
    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).isUnauthenticated).toBe(true);
    // The regression: the shared token and the main session are untouched.
    expect(h.token).toBe('main-token');
    expect(h.cleared).toBe(0);
    expect(mainNotified).not.toHaveBeenCalled();
  });

  it('still attaches the bearer token (authorization is not weakened)', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(200, { items: [], pending_count: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    const { createApiClient } = await import('@/api/client');
    const messageClient = createApiClient('http://message.test/api/v1');

    await messageClient.get('/message-requests');

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe('Bearer main-token');
  });
});

describe('transient failures never clear the token, on any client', () => {
  const cases: { name: string; make: () => Promise<Response> }[] = [
    { name: 'timeout (AbortError)', make: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } },
    { name: 'network error', make: async () => { throw new TypeError('Network request failed'); } },
    { name: '5xx', make: async () => jsonResponse(500, { error: { code: 'internal_error', message: 'boom' } }) },
  ];

  for (const { name, make } of cases) {
    it(`a ${name} on the main API preserves the stored token`, async () => {
      const fetchMock: FetchMock = vi.fn(make);
      vi.stubGlobal('fetch', fetchMock);

      const { ApiClient } = await import('@/api/client');
      const client = new ApiClient('http://api.test/api/v1', { ownsSession: true });
      const notified = vi.fn();
      client.onUnauthorized(notified);

      const error = await client.get('/auth/me').catch((cause: unknown) => cause);
      const { ApiError } = await import('@/api/errors');

      expect(error).toBeInstanceOf(ApiError);
      // A transient failure is never an authentication failure.
      expect((error as InstanceType<typeof ApiError>).isUnauthenticated).toBe(false);
      expect(h.token).toBe('main-token');
      expect(h.cleared).toBe(0);
      expect(notified).not.toHaveBeenCalled();
    });
  }
});

describe('concurrent failures stay consistent', () => {
  it('many simultaneous 401s on the main client clear the token once-effectively and notify per failure', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(401, AUTH_ENVELOPE));
    vi.stubGlobal('fetch', fetchMock);

    const { ApiClient } = await import('@/api/client');
    const client = new ApiClient('http://api.test/api/v1', { ownsSession: true });

    let notifications = 0;
    client.onUnauthorized(() => {
      notifications += 1;
    });

    // Fire several at once, as a cold start with several in-flight queries would.
    const results = await Promise.allSettled([
      client.get('/a'),
      client.get('/b'),
      client.get('/c'),
    ]);

    // Every call failed as unauthenticated — no inconsistent success slipped in.
    const { ApiError } = await import('@/api/errors');
    for (const r of results) {
      expect(r.status).toBe('rejected');
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
    }
    // The token is gone (the end state is a single, consistent signed-out app),
    // and the provider was notified for each failure it must react to.
    expect(h.token).toBeNull();
    expect(notifications).toBe(3);
  });

  it('a message-service 401 racing a main-API success never logs the main app out', async () => {
    const { createApiClient, ApiClient } = await import('@/api/client');
    const mainClient = new ApiClient('http://api.test/api/v1', { ownsSession: true });
    const mainNotified = vi.fn();
    mainClient.onUnauthorized(mainNotified);

    const fetchMock: FetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('message')) return jsonResponse(401, AUTH_ENVELOPE);
      return jsonResponse(200, { id: 'u-1' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const messageClient = createApiClient('http://message.test/api/v1');
    const [messageResult, mainResult] = await Promise.allSettled([
      messageClient.get('/message-requests'),
      mainClient.get('/auth/me'),
    ]);

    // The message call failed with a 401; the main call succeeded.
    expect(messageResult.status).toBe('rejected');
    expect(mainResult.status).toBe('fulfilled');
    // And the main session is completely intact.
    expect(h.token).toBe('main-token');
    expect(h.cleared).toBe(0);
    expect(mainNotified).not.toHaveBeenCalled();
  });
});

