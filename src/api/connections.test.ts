/**
 * Regression tests for the connection-request API bindings.
 *
 * The Notifications inbox resolves an incoming request with exactly these
 * functions (`useNotifications` → `acceptConnection`/`declineConnection`), so
 * the endpoint, the method and the identifier they send are pinned here: the
 * connection id from the notification's `data`, posted to
 * `/connections/{id}/accept`. A failure must reject — if it ever resolved, the
 * inbox would clear a pending request the server never settled.
 *
 * Real `ApiClient`, mocked `fetch`/`tokenStorage`/`env` — the same substitution
 * `client.test.ts` uses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  token: 'recipient-token' as string | null,
  cleared: 0,
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

/** A `ConnectionRead` row as the server serialises it after acceptance. */
const ACCEPTED_ROW = {
  id: 'conn-123',
  status: 'accepted',
  is_outgoing: false,
  user: {
    user_id: 'u-requester',
    public_id: 'MJ-REQUESTR1234',
    username: 'requester',
    name: 'Ravi Requester',
    role: 'candidate',
    avatar_url: null,
  },
  created_at: '2026-10-11T10:00:00+00:00',
  responded_at: '2026-10-11T10:05:00+00:00',
};

beforeEach(() => {
  h.token = 'recipient-token';
  h.cleared = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendConnectionRequest — the Connect button', () => {
  it('POSTs /connections with the internal user id of the person', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(201, ACCEPTED_ROW));
    vi.stubGlobal('fetch', fetchMock);

    const { sendConnectionRequest } = await import('@/api/connections');
    await sendConnectionRequest('u-requester');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/connections');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ user_id: 'u-requester' });
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer recipient-token',
    );
  });
});

describe('acceptConnection — the Notifications Accept button', () => {
  it('POSTs the accept route for exactly the notification’s connection id', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(200, ACCEPTED_ROW));
    vi.stubGlobal('fetch', fetchMock);

    const { acceptConnection } = await import('@/api/connections');
    const result = await acceptConnection('conn-123');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/connections/conn-123/accept');
    expect(init.method).toBe('POST');
    // The accept route takes no body — the id in the path is the only identifier.
    expect(init.body).toBeUndefined();
    expect(result.status).toBe('accepted');
    expect(result.id).toBe('conn-123');
  });

  it('a failed acceptance rejects so the UI cannot show false success', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(404, {
        error: { code: 'not_found', message: 'Connection request not found.' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { acceptConnection } = await import('@/api/connections');
    const { ApiError } = await import('@/api/errors');

    const result = await acceptConnection('conn-gone').catch((cause: unknown) => cause);
    expect(result).toBeInstanceOf(ApiError);
    expect((result as InstanceType<typeof ApiError>).status).toBe(404);
    expect((result as InstanceType<typeof ApiError>).message).toBe(
      'Connection request not found.',
    );
  });

  it('an already-settled request surfaces as a conflict the inbox reconciles from', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(409, {
        error: { code: 'conflict', message: 'This request has already been settled.' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { acceptConnection } = await import('@/api/connections');
    const { ApiError } = await import('@/api/errors');

    // `useNotifications` treats `isConflict` as "already handled elsewhere:
    // refetch and let the server's state win" — not as a retryable user error.
    const result = await acceptConnection('conn-123').catch((cause: unknown) => cause);
    expect(result).toBeInstanceOf(ApiError);
    expect((result as InstanceType<typeof ApiError>).isConflict).toBe(true);
  });

  it('a repeat accept hits the same idempotent route — never a different endpoint', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(200, ACCEPTED_ROW));
    vi.stubGlobal('fetch', fetchMock);

    const { acceptConnection } = await import('@/api/connections');
    await acceptConnection('conn-123');
    await acceptConnection('conn-123');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect((call as [string])[0]).toBe('http://api.test/api/v1/connections/conn-123/accept');
    }
  });
});

describe('declineConnection and cancelConnection — the sibling resolutions', () => {
  it('decline posts the decline route for the same id', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(200, ACCEPTED_ROW));
    vi.stubGlobal('fetch', fetchMock);

    const { declineConnection } = await import('@/api/connections');
    await declineConnection('conn-123');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/connections/conn-123/decline');
    expect(init.method).toBe('POST');
  });

  it('cancel posts the cancel route for the same id', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(200, ACCEPTED_ROW));
    vi.stubGlobal('fetch', fetchMock);

    const { cancelConnection } = await import('@/api/connections');
    await cancelConnection('conn-123');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://api.test/api/v1/connections/conn-123/cancel');
  });

  it('listConnections passes the status filter the connected-people lists use', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(200, [ACCEPTED_ROW]));
    vi.stubGlobal('fetch', fetchMock);

    const { listConnections } = await import('@/api/connections');
    await listConnections('accepted');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://api.test/api/v1/connections?status=accepted');
  });
});
