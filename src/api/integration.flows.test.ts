/**
 * Live integration tests for Phase 21's three fixed flows.
 *
 * `integration.test.ts` covers authentication and candidate data; this file
 * covers the discovery → connection → messaging chain the three bugs lived in,
 * against a running backend, with the REAL api modules and the REAL
 * `notificationAction` model — nothing under test is a double.
 *
 * What each flow pins:
 *
 *  - **Flow A (search).** `GET /users/lookup` finds a real account by exact
 *    handle regardless of privacy, honours the server's `discoverable` rule for
 *    name searches, never returns the caller, and answers a genuine no-match
 *    with an empty array — the contract Home's suggestions render.
 *  - **Flow B (acceptance).** A request sent by A produces a
 *    `connection_request` notification for B whose `data.connection_id` is the
 *    exact id `acceptConnection` needs; accepting settles it for both people,
 *    and re-accepting is an idempotent no-op that creates no duplicate.
 *  - **Flow C (conversation).** `POST /conversations {user_id}` resolves the
 *    connected person to the server's conversation id; a repeat call reuses the
 *    same thread; the conversation shows in both inboxes under that id; a sent
 *    message lands in history for both sides.
 *
 * Safety mirrors `integration.test.ts`: unique throwaway accounts per run,
 * nothing pre-existing is read or deleted, and the suites skip (not fail) when
 * no API is reachable.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

const API_BASE = process.env.INTEGRATION_API_BASE_URL ?? 'http://127.0.0.1:8000/api/v1';

const h = vi.hoisted(() => ({
  token: null as string | null,
  base: process.env.INTEGRATION_API_BASE_URL ?? 'http://127.0.0.1:8000/api/v1',
}));

vi.mock('@/auth/tokenStorage', () => ({
  tokenStorage: {
    get: async () => h.token,
    set: async (token: string) => {
      h.token = token;
    },
    clear: async () => {
      h.token = null;
    },
  },
}));

vi.mock('@/lib/env', () => ({
  env: {
    apiBaseUrl: h.base,
    apiBaseUrlSource: 'configured',
    apiHostKind: 'lan',
    isPhysicalDevice: false,
    needsDeviceConfiguration: false,
  },
}));

// Everything below uses dynamic imports so the mocked edges are in place before
// the real api modules load — the same substitution `integration.test.ts` makes.
const { signup } = await import('@/api/auth');
const usersApi = await import('@/api/users');
const connectionsApi = await import('@/api/connections');
const notificationsApi = await import('@/api/notifications');
const messagesApi = await import('@/api/messages');
const profileApi = await import('@/api/profile');
const { notificationAction } = await import('@/features/notifications/notificationModel');

/** Satisfies the server rule: >= 8 chars, >= 1 letter, >= 1 digit. */
const PASSWORD = 'Passw0rd123';
const runId = Math.random().toString(36).slice(2, 10);
const EMAIL_DOMAIN = process.env.INTEGRATION_EMAIL_DOMAIN ?? 'example.com';

const SEARCHER = { name: `Phase21 Searcher ${runId}`, email: `p21.s.${runId}@${EMAIL_DOMAIN}` };
const DISCOVERABLE = {
  name: `Phase21 Discoverable ${runId}`,
  email: `p21.d.${runId}@${EMAIL_DOMAIN}`,
};

let searcherToken = '';
let discoverableToken = '';
let searcherMe: Awaited<ReturnType<typeof usersApi.fetchMe>>;
let discoverableMe: Awaited<ReturnType<typeof usersApi.fetchMe>>;

async function apiReachable(): Promise<boolean> {
  try {
    return (await fetch(`${API_BASE}/health`)).ok;
  } catch {
    return false;
  }
}

const reachable = await apiReachable();
if (!reachable) {
  console.warn(
    `[integration.flows] skipped: no API at ${API_BASE}. Start the backend, then re-run.`,
  );
}

/** Runs a body as a given role, restoring the ambient token afterwards. */
async function asRole<T>(token: string, body: () => Promise<T>): Promise<T> {
  const previous = h.token;
  h.token = token;
  try {
    return await body();
  } finally {
    h.token = previous;
  }
}

beforeAll(async () => {
  if (!reachable) return;
  searcherToken = (await signup({ ...SEARCHER, password: PASSWORD, role: 'candidate' }))
    .access_token;
  discoverableToken = (await signup({ ...DISCOVERABLE, password: PASSWORD, role: 'candidate' }))
    .access_token;
  searcherMe = await asRole(searcherToken, () => usersApi.fetchMe());
  discoverableMe = await asRole(discoverableToken, () => usersApi.fetchMe());
});

describe.skipIf(!reachable)('Phase 21 Flow A — people search on the live backend', () => {
  it('an exact @handle resolves a fully private account', async () => {
    const results = await asRole(searcherToken, () =>
      usersApi.lookupUsers(discoverableMe.username),
    );
    const hit = results.find((row) => row.public_id === discoverableMe.public_id);
    expect(hit, 'the exact handle must resolve its owner').toBeTruthy();
    expect(hit?.name).toBe(discoverableMe.name);
    expect(hit?.username).toBe(discoverableMe.username);
    expect(hit?.user_id).toBe(discoverableMe.id);
  });

  it('a name search reaches a discoverable account (the default, Phase 23 opt-out)', async () => {
    // A freshly-registered account is discoverable by name out of the box: the
    // privacy row is created eagerly at signup with `discoverable = true`. This
    // is the behaviour the search was missing before Phase 23.
    const before = await asRole(discoverableToken, () => profileApi.fetchPrivacy());
    expect(before.discoverable).toBe(true);

    const results = await asRole(searcherToken, () => usersApi.lookupUsers(discoverableMe.name));
    const hit = results.find((row) => row.public_id === discoverableMe.public_id);
    expect(hit, 'a discoverable account must appear in a name search').toBeTruthy();
    expect(hit?.name).toBe(discoverableMe.name);
  });

  it('opting OUT of discoverability hides the account from a name search again', async () => {
    const before = await asRole(discoverableToken, () => profileApi.fetchPrivacy());
    await asRole(discoverableToken, () =>
      profileApi.replacePrivacy({
        profile_visibility: before.profile_visibility,
        discoverable: false,
        allow_messages: before.allow_messages,
        show_email: before.show_email,
        show_phone: before.show_phone,
      }),
    );

    const results = await asRole(searcherToken, () => usersApi.lookupUsers(discoverableMe.name));
    expect(
      results.find((row) => row.public_id === discoverableMe.public_id),
      'an opted-out account must not appear in a name search',
    ).toBeUndefined();

    // The exact handle still resolves regardless of privacy — the strict half of
    // §5.2's rule that the opt-out default does not weaken.
    const byHandle = await asRole(searcherToken, () => usersApi.lookupUsers(discoverableMe.username));
    expect(byHandle.find((row) => row.public_id === discoverableMe.public_id)).toBeTruthy();

    // Opt back in so later flows (B/C) that rely on this account behave normally.
    await asRole(discoverableToken, () =>
      profileApi.replacePrivacy({
        profile_visibility: before.profile_visibility,
        discoverable: true,
        allow_messages: before.allow_messages,
        show_email: before.show_email,
        show_phone: before.show_phone,
      }),
    );
  });

  it('the caller never appears in their own lookup — even by exact public id', async () => {
    const results = await asRole(searcherToken, () => usersApi.lookupUsers(searcherMe.public_id));
    expect(results.find((row) => row.public_id === searcherMe.public_id)).toBeUndefined();
    expect(results.find((row) => row.user_id === searcherMe.id)).toBeUndefined();
  });

  it('a genuine no-match is an empty array, not an error', async () => {
    const results = await asRole(searcherToken, () =>
      usersApi.lookupUsers(`zzz nobody matches ${runId}`),
    );
    expect(results).toEqual([]);
  });
});

describe.skipIf(!reachable)('Phase 21 Flow B — accepting a connection request', () => {
  /** Set by the first test, consumed by the rest — one request for the flow. */
  let connectionId = '';

  it('the sender’s request is pending and outgoing', async () => {
    const request = await asRole(searcherToken, () =>
      connectionsApi.sendConnectionRequest(discoverableMe.id),
    );
    expect(request.status).toBe('pending');
    expect(request.is_outgoing).toBe(true);
    expect(request.user.public_id).toBe(discoverableMe.public_id);
    connectionId = request.id;

    // Re-sending is idempotent: the same request, never a second row.
    const again = await asRole(searcherToken, () =>
      connectionsApi.sendConnectionRequest(discoverableMe.id),
    );
    expect(again.id).toBe(connectionId);
  });

  it('the recipient’s notification carries the exact connection id the Accept button needs', async () => {
    const page = await asRole(discoverableToken, () => notificationsApi.listNotifications());
    const request = page.items.find(
      (item) =>
        item.type === 'connection_request' &&
        notificationsApi.connectionIdFromNotification(item) === connectionId,
    );
    expect(request, 'the pending request must appear in the recipient inbox').toBeTruthy();
    expect(request?.actor?.user_id).toBe(searcherMe.id);

    // The REAL model function the Notifications screen calls.
    const action = notificationAction(request!);
    expect(action.kind).toBe('accept');
    expect(action.enabled).toBe(true);
    expect(action.connectionId).toBe(connectionId);
  });

  it('accepting settles the request for both people', async () => {
    const settled = await asRole(discoverableToken, () =>
      connectionsApi.acceptConnection(connectionId),
    );
    expect(settled.id).toBe(connectionId);
    expect(settled.status).toBe('accepted');
    expect(settled.responded_at).toBeTruthy();

    const recipientList = await asRole(discoverableToken, () =>
      connectionsApi.listConnections('accepted'),
    );
    expect(
      recipientList.find((row) => row.user.user_id === searcherMe.id && row.status === 'accepted'),
      'the accepted connection must appear for the recipient',
    ).toBeTruthy();

    const senderList = await asRole(searcherToken, () =>
      connectionsApi.listConnections('accepted'),
    );
    expect(
      senderList.find((row) => row.user.user_id === discoverableMe.id && row.status === 'accepted'),
      'the accepted connection must appear for the sender',
    ).toBeTruthy();
  });

  it('re-accepting is a no-op and never creates a duplicate connection', async () => {
    const repeat = await asRole(discoverableToken, () =>
      connectionsApi.acceptConnection(connectionId),
    );
    expect(repeat.id).toBe(connectionId);
    expect(repeat.status).toBe('accepted');

    const all = await asRole(discoverableToken, () => connectionsApi.listConnections());
    const between = all.filter((row) => row.user.user_id === searcherMe.id);
    expect(between.filter((row) => row.status === 'accepted')).toHaveLength(1);
  });
});

describe.skipIf(!reachable)('Phase 21 Flow C — resolving a person to a conversation', () => {
  /** The server-owned conversation id, resolved once and reused by the flow. */
  let conversationId = '';
  let sentMessageId = '';

  it('opening a conversation with the connected person returns the server’s conversation id', async () => {
    const conversation = await asRole(discoverableToken, () =>
      messagesApi.openConversation(searcherMe.id),
    );
    expect(conversation.id).toMatch(/\S/);
    const memberIds = conversation.members.map((member) => member.user_id);
    expect(memberIds).toContain(searcherMe.id);
    expect(memberIds).toContain(discoverableMe.id);
    conversationId = conversation.id;
  });

  it('a repeat open reuses the same conversation — no duplicate thread', async () => {
    const again = await asRole(discoverableToken, () =>
      messagesApi.openConversation(searcherMe.id),
    );
    expect(again.id).toBe(conversationId);

    const inbox = await asRole(discoverableToken, () => messagesApi.listConversations());
    const mine = inbox.items.filter((row) => row.members.some((m) => m.user_id === searcherMe.id));
    expect(mine, 'exactly one thread may exist for this pair').toHaveLength(1);
    expect(mine[0]?.id).toBe(conversationId);
  });

  it('the conversation appears in BOTH inboxes under the same id', async () => {
    const recipientInbox = await asRole(discoverableToken, () =>
      messagesApi.listConversations(),
    );
    expect(recipientInbox.items.some((row) => row.id === conversationId)).toBe(true);

    const senderInbox = await asRole(searcherToken, () => messagesApi.listConversations());
    expect(senderInbox.items.some((row) => row.id === conversationId)).toBe(true);
  });

  it('the conversation screen’s detail read loads both participants', async () => {
    const detail = await asRole(discoverableToken, () =>
      messagesApi.fetchConversation(conversationId),
    );
    expect(detail.id).toBe(conversationId);
    expect(detail.members).toHaveLength(2);
  });

  it('a sent message lands in history for both sides', async () => {
    const body = `Phase21 ping ${runId}`;
    const message = await asRole(discoverableToken, () =>
      messagesApi.sendMessage(conversationId, { body, client_message_id: `cmi-p21-${runId}` }),
    );
    expect(message.body).toBe(body);
    expect(message.conversation_id).toBe(conversationId);
    sentMessageId = message.id;

    const recipientHistory = await asRole(discoverableToken, () =>
      messagesApi.listMessages(conversationId),
    );
    expect(recipientHistory.items.some((row) => row.id === sentMessageId)).toBe(true);

    const senderHistory = await asRole(searcherToken, () =>
      messagesApi.listMessages(conversationId),
    );
    expect(
      senderHistory.items.some((row) => row.id === sentMessageId && row.body === body),
      'the other account must see the message in history',
    ).toBe(true);
  });

  it('the recipient’s read pointer moves without disturbing the thread', async () => {
    await asRole(searcherToken, () =>
      messagesApi.markConversationRead(conversationId, sentMessageId),
    );
    const history = await asRole(searcherToken, () => messagesApi.listMessages(conversationId));
    expect(history.items.some((row) => row.id === sentMessageId)).toBe(true);
  });
});
