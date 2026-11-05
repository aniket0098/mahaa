/**
 * Regression tests for the conversation API bindings.
 *
 * Messages → All and the Connections "Message" button navigate by the
 * **conversation id the server owns**: the All row uses `conversation.id` from
 * `GET /conversations`, and the start-conversation flow posts
 * `POST /conversations {user_id}` and navigates with whatever id comes back.
 * These tests pin that contract — including that a 403 (not connected / messages
 * off) rejects instead of resolving, so no failure can navigate to a fabricated
 * conversation.
 *
 * Real `ApiClient`, mocked `fetch`/`tokenStorage`/`env` — the same substitution
 * `client.test.ts` uses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  token: 'caller-token' as string | null,
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

const MEMBER = {
  user_id: 'u-other',
  public_id: 'MJ-OTHERPERSO123',
  username: 'other.person',
  name: 'Other Person',
  role: 'candidate',
  avatar_url: null,
};

const CONVERSATION = {
  id: 'conv-abc-123',
  created_by: 'u-caller',
  created_at: '2026-10-11T10:00:00+00:00',
  last_message_at: null,
  last_message: null,
  members: [MEMBER],
  unread_count: 0,
  muted: false,
  archived: false,
};

beforeEach(() => {
  h.token = 'caller-token';
  h.cleared = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openConversation — resolve a person to the server’s conversation id', () => {
  it('POSTs /conversations with the internal user id and returns the server’s conversation id', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(201, CONVERSATION));
    vi.stubGlobal('fetch', fetchMock);

    const { openConversation } = await import('@/api/messages');
    const conversation = await openConversation('u-other');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/conversations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ user_id: 'u-other' });
    // Navigation uses THIS id — the server's, never the user id that was sent.
    expect(conversation.id).toBe('conv-abc-123');
  });

  it('a refusal (not connected / messages off) rejects — nothing navigates on failure', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(403, {
        error: { code: 'forbidden', message: 'You cannot message this person.' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { openConversation } = await import('@/api/messages');
    const { ApiError } = await import('@/api/errors');

    const result = await openConversation('u-stranger').catch((cause: unknown) => cause);
    expect(result).toBeInstanceOf(ApiError);
    expect((result as InstanceType<typeof ApiError>).isForbidden).toBe(true);
  });
});

describe('listConversations — the Messages → All inbox', () => {
  it('GETs /conversations and parses the keyset page the rows render from', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(200, { items: [CONVERSATION], next_cursor: null, has_more: false }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { listConversations } = await import('@/api/messages');
    const page = await listConversations();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://api.test/api/v1/conversations');
    expect(page.items).toEqual([CONVERSATION]);
    // The row opens `/conversation/${conversation.id}` — the field must survive.
    expect(page.items[0].id).toBe('conv-abc-123');
    expect(page.items[0].members[0].name).toBe('Other Person');
    expect(page.items[0].unread_count).toBe(0);
  });

  it('passes cursor and limit through verbatim when paging', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(200, { items: [], next_cursor: null, has_more: false }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { listConversations } = await import('@/api/messages');
    await listConversations({ cursor: 'cur-1', limit: 30 });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://api.test/api/v1/conversations?limit=30&cursor=cur-1');
  });
});

describe('fetchConversation — what /conversation/[id] loads on open', () => {
  it('GETs the conversation detail by its server id', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(200, CONVERSATION));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchConversation } = await import('@/api/messages');
    const conversation = await fetchConversation('conv-abc-123');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://api.test/api/v1/conversations/conv-abc-123');
    expect(conversation.members).toEqual([MEMBER]);
  });
});

describe('listMessages — thread history', () => {
  it('GETs the conversation’s messages with the paging parameters the screen uses', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(200, { items: [], next_cursor: null, has_more: false }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { listMessages } = await import('@/api/messages');
    await listMessages('conv-abc-123', { limit: 30 });
    await listMessages('conv-abc-123', { cursor: 'c1', since: '2026-10-11T10:00:00+00:00' });

    const [first] = fetchMock.mock.calls[0] as [string];
    expect(first).toBe('http://api.test/api/v1/conversations/conv-abc-123/messages?limit=30');
    const [second] = fetchMock.mock.calls[1] as [string];
    expect(second).toBe(
      'http://api.test/api/v1/conversations/conv-abc-123/messages' +
        '?cursor=c1&since=2026-10-11T10%3A00%3A00%2B00%3A00',
    );
  });
});

describe('sendMessage — the composer', () => {
  it('POSTs the body and the idempotency key to the conversation’s messages route', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(201, {
        id: 'msg-1',
        conversation_id: 'conv-abc-123',
        sender: { ...MEMBER, user_id: 'u-caller' },
        body: 'hello there',
        client_message_id: 'cmi-1',
        created_at: '2026-10-11T10:10:00+00:00',
        edited_at: null,
        deleted_at: null,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { sendMessage } = await import('@/api/messages');
    const message = await sendMessage('conv-abc-123', {
      body: 'hello there',
      client_message_id: 'cmi-1',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/conversations/conv-abc-123/messages');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ body: 'hello there', client_message_id: 'cmi-1' });
    expect(message.id).toBe('msg-1');
    expect(message.body).toBe('hello there');
  });

  it('a media-only send carries media_id and a null body — the server allows text, attachment, or both', async () => {
    const attachment = {
      id: 'att-1',
      kind: 'image',
      mime_type: 'image/jpeg',
      width: 800,
      height: 600,
      size_bytes: 1024,
      served_at: '/api/v1/media/att-1',
    };
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(201, {
        id: 'msg-2',
        conversation_id: 'conv-abc-123',
        sender: { ...MEMBER, user_id: 'u-caller' },
        // The canonical server shape of a caption-less photo: body null,
        // media populated, no delete stamp.
        body: null,
        client_message_id: 'cmi-2',
        created_at: '2026-10-11T10:10:00+00:00',
        edited_at: null,
        deleted_at: null,
        media: attachment,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { sendMessage } = await import('@/api/messages');
    const message = await sendMessage('conv-abc-123', {
      body: null,
      media_id: 'att-1',
      client_message_id: 'cmi-2',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // Explicit null body, never an empty string: the server refuses a
    // present-but-blank body with 422.
    expect(JSON.parse(init.body as string)).toEqual({
      body: null,
      media_id: 'att-1',
      client_message_id: 'cmi-2',
    });
    // The response's attachment round-trips into the typed message.
    expect(message.body).toBeNull();
    expect(message.media).toEqual(attachment);
  });

  it('a text send omits media_id entirely — the field is optional on the wire', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(201, {
        id: 'msg-3',
        conversation_id: 'conv-abc-123',
        sender: { ...MEMBER, user_id: 'u-caller' },
        body: 'just text',
        client_message_id: 'cmi-3',
        created_at: '2026-10-11T10:10:00+00:00',
        edited_at: null,
        deleted_at: null,
        media: null,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { sendMessage } = await import('@/api/messages');
    await sendMessage('conv-abc-123', { body: 'just text', client_message_id: 'cmi-3' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(payload.body).toBe('just text');
    expect(payload).not.toHaveProperty('media_id');
  });
});

describe('markConversationRead — the read pointer', () => {
  it('POSTs the message id to the conversation’s read route', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(204, undefined),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { markConversationRead } = await import('@/api/messages');
    await markConversationRead('conv-abc-123', 'msg-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/conversations/conv-abc-123/read');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ message_id: 'msg-1' });
  });
});
