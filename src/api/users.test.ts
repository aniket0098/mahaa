/**
 * Regression tests for the people-search API binding (`lookupUsers`).
 *
 * These pin the contract Home's live suggestions depend on: a typed term becomes
 * a `GET /users/lookup?query=…` on the real `apiClient` with the caller's bearer
 * token, the bare array the server returns arrives with every field the
 * suggestion row renders, and a server failure surfaces as a rejection — never
 * a silent empty array that the UI would render as "no people match".
 *
 * Same substitution as `client.test.ts` and `integration.test.ts`: the REAL
 * `ApiClient` runs against a mocked `fetch`, `tokenStorage` and `env`; nothing
 * is stubbed at the transport layer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  token: 'searcher-token' as string | null,
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

/** One `UserSummary` exactly as `backend/app/schemas/users.py` serialises it. */
const PERSON = {
  user_id: 'u-internal-42',
  public_id: 'MJ-ABCDEFGH1234',
  username: 'aniket.dev',
  name: 'Aniket Kumar',
  role: 'candidate',
  avatar_url: null,
};

beforeEach(() => {
  h.token = 'searcher-token';
  h.cleared = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lookupUsers — the request behind Home people suggestions', () => {
  it('GETs /users/lookup with the term and the caller’s bearer token', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(200, [PERSON]));
    vi.stubGlobal('fetch', fetchMock);

    const { lookupUsers } = await import('@/api/users');
    const results = await lookupUsers('Aniket');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/users/lookup?query=Aniket');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer searcher-token');
    expect(results).toEqual([PERSON]);
  });

  it('encodes the term so spaces and ampersands cannot rewrite the request', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(200, []));
    vi.stubGlobal('fetch', fetchMock);

    const { lookupUsers } = await import('@/api/users');
    await lookupUsers('Aditi Sharma & Sons');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      'http://api.test/api/v1/users/lookup?query=' + encodeURIComponent('Aditi Sharma & Sons'),
    );
  });

  it('keeps the fields the suggestion row and the profile route navigate by', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(200, [PERSON]));
    vi.stubGlobal('fetch', fetchMock);

    const { lookupUsers } = await import('@/api/users');
    const [row] = await lookupUsers('aniket.dev');

    // `public_id` routes to `/user/[id]`, `user_id` is the internal id the
    // connection request sends, and name/username are what the row renders.
    expect(row.public_id).toBe('MJ-ABCDEFGH1234');
    expect(row.user_id).toBe('u-internal-42');
    expect(row.name).toBe('Aniket Kumar');
    expect(row.username).toBe('aniket.dev');
  });

  it('a server failure rejects with the server’s message — never an empty array', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(500, {
        error: { code: 'internal_error', message: 'Something went wrong on our side.' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { lookupUsers } = await import('@/api/users');
    const { ApiError } = await import('@/api/errors');

    const result = await lookupUsers('Aniket').catch((cause: unknown) => cause);
    // If this ever resolves to [], the empty state would hide a backend outage
    // behind "No people match" — exactly the bug this test exists to prevent.
    expect(result).toBeInstanceOf(ApiError);
    expect((result as InstanceType<typeof ApiError>).message).toBe(
      'Something went wrong on our side.',
    );
    expect((result as InstanceType<typeof ApiError>).status).toBe(500);
  });

  it('a blank term is the server’s 422 validation problem, not a silent empty result', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(422, {
        error: {
          code: 'validation_error',
          message: 'Type a name, handle or public ID to search for.',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { lookupUsers } = await import('@/api/users');
    const { ApiError } = await import('@/api/errors');

    const result = await lookupUsers('').catch((cause: unknown) => cause);
    expect(result).toBeInstanceOf(ApiError);
    expect((result as InstanceType<typeof ApiError>).isValidation).toBe(true);
  });

  it('an unmatched term is a genuine empty array from the server', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(200, []));
    vi.stubGlobal('fetch', fetchMock);

    const { lookupUsers } = await import('@/api/users');
    await expect(lookupUsers('zzz-nobody-matches-this')).resolves.toEqual([]);
  });
});
