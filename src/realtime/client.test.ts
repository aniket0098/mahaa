/**
 * Realtime client tests.
 *
 * A fake `WebSocket` stands in for the platform one, so connection lifecycle,
 * reconnect backoff, heartbeat, deduplication and AppState recovery are all
 * verified without a server. `AppState` is mocked because the behaviour under
 * test is "what happens when the app comes back to the foreground", which the
 * real module cannot be asked to do on demand.
 *
 * `tokenStorage` is mocked for the same reason `tokenStorage.test.ts` mocks
 * `Platform`: the credential is an input to this component, not its behaviour.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appState = vi.hoisted(() => ({
  listeners: [] as ((state: string) => void)[],
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, handler: (state: string) => void) => {
      appState.listeners.push(handler);
      return { remove: () => {} };
    },
  },
}));

const tokenStorage = vi.hoisted(() => ({
  get: vi.fn<() => Promise<string | null>>(async () => 'test-token'),
  set: vi.fn<() => Promise<void>>(async () => {}),
  clear: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock('@/auth/tokenStorage', () => ({ tokenStorage }));

vi.mock('@/lib/env', () => ({ env: { apiBaseUrl: 'https://api.example.com/api/v1' } }));

// The `vi.mock` calls above must precede these imports: vitest hoists them, and
// the modules under test read the mocked `react-native` / `tokenStorage` / `env`
// at import time. ESLint's `import/first` cannot see that, so it is disabled for
// this block only rather than left as four warnings nobody will read.
/* eslint-disable import/first -- vi.mock must precede the imports it replaces. */
import type { Mock } from 'vitest';

import { queryClient } from '@/api/queryClient';
import {
  EventDeduplicator,
  RealtimeClient,
  parseRealtimeEvent,
  setRealtimeClient,
  socketUrlFor,
} from '@/realtime/client';
import {
  applyRealtimeEvent,
  bindRealtimeToQueryCache,
  catchUpMessagingAfterReconnect,
} from '@/realtime/queryBridge';
/* eslint-enable import/first */

/** A WebSocket stand-in that lets a test drive every lifecycle event. */
class FakeSocket {
  static instances: FakeSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  /** Present only so the cast to `WebSocket` is honest. */
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.();
  }

  emit(raw: string): void {
    this.onmessage?.({ data: raw });
  }

  serverClose(): void {
    this.onclose?.();
  }
}

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event_id: 'evt-1',
    event_type: 'connection.opened',
    occurred_at: '2026-10-01T00:00:00+00:00',
    recipient_user_id: null,
    topic: null,
    payload: {},
    ...overrides,
  });
}

beforeEach(() => {
  FakeSocket.instances = [];
  appState.listeners = [];
  tokenStorage.get.mockResolvedValue('test-token');
  // `vi.spyOn` on the shared `queryClient` accumulates call history across tests
  // unless it is cleared here, so a bridge test would otherwise see calls made by
  // an earlier one and fail for the wrong reason.
  vi.restoreAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// --- url ------------------------------------------------------------------

describe('socketUrlFor', () => {
  it('derives a secure socket url from an https base', () => {
    expect(socketUrlFor('https://api.example.com/api/v1')).toBe(
      'wss://api.example.com/api/v1/ws',
    );
  });

  it('derives a plain socket url from a local http base', () => {
    expect(socketUrlFor('http://10.0.2.2:8000/api/v1')).toBe(
      'ws://10.0.2.2:8000/api/v1/ws',
    );
  });

  it('tolerates a trailing slash', () => {
    expect(socketUrlFor('https://api.example.com/api/v1/')).toBe(
      'wss://api.example.com/api/v1/ws',
    );
  });
});

// --- parsing --------------------------------------------------------------

describe('parseRealtimeEvent', () => {
  it('reads a well-formed envelope', () => {
    const event = parseRealtimeEvent(envelope());
    expect(event?.event_type).toBe('connection.opened');
    expect(event?.event_id).toBe('evt-1');
  });

  it.each([
    ['not json at all', 'nonsense'],
    ['a bare array', '[]'],
    // A Phase 4 type the backend does not publish yet. Rejecting it is what
    // stops the client handling something the server has never promised.
    ['an unpublished event type', envelope({ event_type: 'post.liked' })],
    ['a missing event id', envelope({ event_id: '' })],
    ['a null body', 'null'],
  ])('rejects %s', (_label, raw) => {
    expect(parseRealtimeEvent(raw)).toBeNull();
  });
});

// --- dedupe ---------------------------------------------------------------

describe('EventDeduplicator', () => {
  it('accepts an id once and rejects a repeat', () => {
    const dedupe = new EventDeduplicator(4);
    expect(dedupe.accept('a')).toBe(true);
    expect(dedupe.accept('a')).toBe(false);
    expect(dedupe.accept('b')).toBe(true);
  });

  it('is bounded so it cannot grow for the life of the session', () => {
    const dedupe = new EventDeduplicator(3);
    for (const id of ['a', 'b', 'c', 'd', 'e']) dedupe.accept(id);
    expect(dedupe.size).toBeLessThanOrEqual(3);
  });

  it('forgets everything when cleared', () => {
    const dedupe = new EventDeduplicator(4);
    dedupe.accept('a');
    dedupe.clear();
    expect(dedupe.accept('a')).toBe(true);
  });
});

// --- connection lifecycle -------------------------------------------------

describe('RealtimeClient', () => {
  function build(overrides = {}) {
    return new RealtimeClient({
      createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
      backoffMs: 1_000,
      maxBackoffMs: 8_000,
      ...overrides,
    });
  }

  it('connects using the stored token and reports opening', async () => {
    const client = build();
    await client.connect();
    expect(client.getStatus()).toBe('connecting');
    const socket = FakeSocket.instances[0];
    expect(socket.url).toContain('token=test-token');
    socket.open();
    expect(client.getStatus()).toBe('open');
  });

  it('stays closed and opens nothing when there is no session', async () => {
    tokenStorage.get.mockResolvedValue(null);
    const client = build();
    await client.connect();
    expect(client.getStatus()).toBe('closed');
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('delivers a parsed event to a listener', async () => {
    const client = build();
    const seen: string[] = [];
    client.onEvent((event) => seen.push(event.event_type));
    await client.connect();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.emit(envelope());
    expect(seen).toEqual(['connection.opened']);
  });

  it('answers a heartbeat without dispatching it as an event', async () => {
    const client = build();
    const seen: string[] = [];
    client.onEvent((event) => seen.push(event.event_type));
    await client.connect();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.emit(envelope({ event_id: 'ping-1', event_type: 'system.ping' }));
    expect(socket.sent).toHaveLength(1);
    expect(seen).toEqual([]); // transport-level, not a domain event
  });

  it('ignores a duplicate event id', async () => {
    const client = build();
    const seen: string[] = [];
    client.onEvent((event) => seen.push(event.event_id));
    await client.connect();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.emit(envelope());
    socket.emit(envelope());
    expect(seen).toEqual(['evt-1']);
  });

  it('ignores a malformed frame without dropping the connection', async () => {
    const client = build();
    const seen: string[] = [];
    client.onEvent((event) => seen.push(event.event_id));
    await client.connect();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.emit('}{ not json');
    expect(client.getStatus()).toBe('open');
    socket.emit(envelope());
    expect(seen).toEqual(['evt-1']);
  });

  it('reconnects with exponential backoff after the server closes', async () => {
    const client = build();
    await client.connect();
    FakeSocket.instances[0].open();

    FakeSocket.instances[0].serverClose();
    expect(client.getStatus()).toBe('closed');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(2);

    // Second failure waits twice as long, rather than hammering the server.
    FakeSocket.instances[1].serverClose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(3);
  });

  it('stops reconnecting once disconnected deliberately', async () => {
    const client = build();
    await client.connect();
    FakeSocket.instances[0].open();
    client.disconnect();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.getStatus()).toBe('closed');
  });

  it('does not reconnect after a sign-out', async () => {
    const client = build();
    await client.connect();
    FakeSocket.instances[0].open();
    await client.disconnectForLogout();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.getStatus()).toBe('closed');
  });

  it('reconnects when the app returns to the foreground', async () => {
    const client = build();
    await client.connect();
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].serverClose();

    const handler = appState.listeners[appState.listeners.length - 1];
    handler('active');
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('does not open a second socket when already open in the foreground', async () => {
    const client = build();
    await client.connect();
    FakeSocket.instances[0].open();
    const handler = appState.listeners[appState.listeners.length - 1];
    handler('active');
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('reports status changes to an observer', async () => {
    const client = build();
    const seen: string[] = [];
    client.onStatus((status) => seen.push(status));
    await client.connect();
    FakeSocket.instances[0].open();
    expect(seen).toEqual(['connecting', 'open']);
  });

  it('keeps going when one listener throws', async () => {
    const client = build();
    const seen: string[] = [];
    client.onEvent(() => {
      throw new Error('handler blew up');
    });
    client.onEvent((event) => seen.push(event.event_id));
    await client.connect();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.emit(envelope());
    expect(seen).toEqual(['evt-1']);
  });
});

// --- Phase 2: messaging events ---------------------------------------------


function messageEvent(overrides: Record<string, unknown> = {}) {
  return parseRealtimeEvent(
    envelope({
      event_id: 'evt-msg-1',
      event_type: 'message.created',
      payload: {
        message_id: 'm-1',
        conversation_id: 'c-1',
        sender_user_id: 'u-1',
        created_at: '2026-10-01T00:00:00+00:00',
        body: 'hello',
        client_message_id: null,
        ...overrides,
      },
    }),
  )!;
}

function readEvent(overrides: Record<string, unknown> = {}) {
  return parseRealtimeEvent(
    envelope({
      event_id: 'evt-read-1',
      event_type: 'conversation.read',
      payload: {
        conversation_id: 'c-1',
        reader_user_id: 'u-1',
        last_read_message_id: 'm-1',
        read_at: '2026-10-01T00:00:00+00:00',
        ...overrides,
      },
    }),
  )!;
}

function invalidatedKeys(): readonly unknown[][] {
  return (queryClient.invalidateQueries as unknown as Mock).mock.calls.map(
    (call) => (call[0] as { queryKey: readonly unknown[] }).queryKey as unknown[],
  );
}

describe('applyRealtimeEvent — message.created', () => {
  beforeEach(() => {
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined as never);
  });

  it('invalidates that conversation and the conversation list', () => {
    expect(applyRealtimeEvent(messageEvent())).toBe(true);
    const keys = invalidatedKeys();
    expect(keys).toContainEqual(['conversations', 'c-1']);
    expect(keys).toContainEqual(['conversations']);
  });

  it('never invalidates without a query key', () => {
    applyRealtimeEvent(messageEvent());
    for (const call of (queryClient.invalidateQueries as unknown as Mock).mock.calls) {
      expect((call[0] as { queryKey?: unknown }).queryKey).toBeDefined();
    }
  });

  it('never invalidates the whole cache', () => {
    applyRealtimeEvent(messageEvent());
    for (const key of invalidatedKeys()) {
      expect(key.length).toBeGreaterThan(0);
      expect(key[0]).toBe('conversations');
    }
  });

  it('invalidates the conversation the event actually names', () => {
    applyRealtimeEvent(messageEvent({ conversation_id: 'c-2' }));
    const keys = invalidatedKeys();
    expect(keys).toContainEqual(['conversations', 'c-2']);
    expect(keys).not.toContainEqual(['conversations', 'c-1']);
  });

  it('does nothing at all when the payload names no conversation', () => {
    // Guessing a conversation would invalidate a key that may be someone else's.
    expect(applyRealtimeEvent(messageEvent({ conversation_id: '' }))).toBe(false);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });
});

describe('applyRealtimeEvent — conversation.read', () => {
  beforeEach(() => {
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined as never);
  });

  it('invalidates that conversation and the list, and nothing else', () => {
    expect(applyRealtimeEvent(readEvent())).toBe(true);
    expect(invalidatedKeys()).toEqual([['conversations', 'c-1'], ['conversations']]);
  });

  it('does nothing when the conversation id is missing', () => {
    expect(applyRealtimeEvent(readEvent({ conversation_id: undefined }))).toBe(false);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it('is harmless when delivered twice', () => {
    // The socket deduplicates by event_id first; asserting the handler is also
    // harmless twice documents that neither layer is the other's safety net.
    applyRealtimeEvent(readEvent());
    applyRealtimeEvent(readEvent());
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4);
  });
});

describe('applyRealtimeEvent', () => {
  it('is a deliberate no-op for every foundation event', () => {
    // Nothing in the foundation changes cached data, and asserting that here
    // is what stops a later phase from silently invalidating everything.
    for (const type of [
      'connection.opened',
      'connection.closed',
      'system.ping',
      'system.error',
    ]) {
      const event = parseRealtimeEvent(envelope({ event_type: type }));
      expect(event).not.toBeNull();
      expect(applyRealtimeEvent(event!)).toBe(false);
    }
  });
});

// --- Phase 3: notification events -------------------------------------------


function notificationEvent(overrides: Record<string, unknown> = {}) {
  return parseRealtimeEvent(
    envelope({
      event_id: 'evt-n-1',
      event_type: 'notification.created',
      payload: {
        id: 'n-1',
        type: 'connection_request',
        actor_user_id: 'u-1',
        target_type: 'connection',
        target_id: 'c-1',
        title: 'New connection request',
        body: null,
        data: { connection_id: 'c-1' },
        is_read: false,
        created_at: '2026-10-01T00:00:00+00:00',
        ...overrides,
      },
    }),
  )!;
}

describe('applyRealtimeEvent — notification.created', () => {
  beforeEach(() => {
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined as never);
    vi.spyOn(queryClient, 'getQueryData');
  });

  it('refreshes the inbox and the unread count, and nothing else', () => {
    expect(applyRealtimeEvent(notificationEvent())).toBe(true);
    expect(invalidatedKeys()).toEqual([
      ['notifications'],
      ['notifications', 'unread-count'],
    ]);
  });

  it('never invalidates without a query key', () => {
    applyRealtimeEvent(notificationEvent());
    for (const call of (queryClient.invalidateQueries as unknown as Mock).mock.calls) {
      expect((call[0] as { queryKey?: unknown }).queryKey).toBeDefined();
    }
  });

  it('touches no messaging key, so message and notification stay separate', () => {
    applyRealtimeEvent(notificationEvent());
    for (const key of invalidatedKeys()) {
      expect(key[0]).toBe('notifications');
    }
  });

  it('does nothing when the payload has no notification id', () => {
    // An id-less notification cannot be placed in the list, deduped against it,
    // or deep-linked from, so it is dropped rather than half-applied.
    expect(applyRealtimeEvent(notificationEvent({ id: '' }))).toBe(false);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it('does not compute the unread count on the client', () => {
    // §13 makes the count the server's number. A client-side increment would
    // drift the first time an event was missed.
    applyRealtimeEvent(notificationEvent());
    expect(queryClient.getQueryData).not.toHaveBeenCalled();
  });

  it('is harmless when delivered twice', () => {
    applyRealtimeEvent(notificationEvent());
    applyRealtimeEvent(notificationEvent());
    // Invalidation is idempotent and the socket already deduplicated by
    // event_id; neither layer is the other's safety net.
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4);
  });
});

describe('phases 1 and 2 are unchanged by phase 3', () => {
  beforeEach(() => {
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined as never);
  });

  it('message.created still refreshes only the conversation keys', () => {
    expect(applyRealtimeEvent(messageEvent())).toBe(true);
    for (const key of invalidatedKeys()) {
      expect(key[0]).toBe('conversations');
    }
  });

  it('conversation.read still refreshes only the conversation keys', () => {
    expect(applyRealtimeEvent(readEvent())).toBe(true);
    expect(invalidatedKeys()).toEqual([
      ['conversations', 'c-1'],
      ['conversations'],
    ]);
  });
});

// --- catch-up after a reconnect ---------------------------------------------


describe('catchUpMessagingAfterReconnect', () => {
  beforeEach(() => {
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined as never);
  });

  it('marks only messaging and notification keys stale', () => {
    catchUpMessagingAfterReconnect();
    expect(invalidatedKeys()).toEqual([
      ['conversations'],
      ['notifications'],
      ['notifications', 'unread-count'],
    ]);
  });

  it('runs once on the closed -> open transition, not while staying open', () => {
    const client = new RealtimeClient({
      createSocket: () => ({}) as unknown as WebSocket,
      baseUrl: 'https://api.example.com/api/v1',
    });
    // Start already-open so `wasOpen` seeds true: this test is about the
    // reconnect path, not the initial connection (see the test below).
    client.__test_setStatus('open');
    setRealtimeClient(client);
    const unbind = bindRealtimeToQueryCache();
    (queryClient.invalidateQueries as unknown as Mock).mockClear();

    client.__test_setStatus('closed');
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    client.__test_setStatus('open');
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3);

    // Staying open must not keep invalidating.
    client.__test_setStatus('open');
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3);

    unbind();
    setRealtimeClient(null);
  });

  it('stops catching up once unbound', () => {
    const client = new RealtimeClient({
      createSocket: () => ({}) as unknown as WebSocket,
      baseUrl: 'https://api.example.com/api/v1',
    });
    setRealtimeClient(client);
    const unbind = bindRealtimeToQueryCache();
    unbind();

    client.__test_setStatus('open');
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    setRealtimeClient(null);
  });
});
