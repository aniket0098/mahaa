/**
 * Realtime transport — the mobile half of the WebSocket foundation.
 *
 * Uses React Native's built-in `WebSocket`. No third-party socket library: RN
 * ships one, and adding a dependency to wrap it would be a second place where
 * reconnect behaviour could differ from what this file asserts in its tests.
 *
 * Four responsibilities, and nothing else:
 *
 *  1. **Connect / disconnect / reconnect.** Exponential backoff with a ceiling,
 *     because a phone that wakes into a dead cell connection must not hammer
 *     the server, and one that has been backgrounded must recover on its own.
 *  2. **Heartbeat.** The server pings and expects a reply; the reply is sent
 *     here and is deliberately *not* treated as an event, so listeners do not
 *     special-case it.
 *  3. **Event parsing.** A frame that is not a valid envelope is dropped, never
 *     thrown: one malformed message must not tear down the connection.
 *  4. **Deduplication by `event_id`.** A server that re-delivers after a
 *     failover is harmless once ids are remembered.
 *
 * What it deliberately does **not** do: interpret any business event. The
 * server sends only the four foundation types today; a phase that adds
 * `message.created` adds its handler here rather than teaching this module
 * about messaging.
 */

import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { tokenStorage } from '@/auth/tokenStorage';
import { env } from '@/lib/env';

export type RealtimeEventType =
  | 'connection.opened'
  | 'connection.closed'
  | 'system.ping'
  | 'system.error'
  // Phase 2 — messaging. Payload shapes are the backend's `message_events`
  // module; `queryBridge` is what turns them into cache effects.
  | 'message.created'
  | 'conversation.read'
  // Phase 3 — notifications. Payload mirrors the backend's `NotificationRead`,
  // so one object renders from either REST or the socket.
  | 'notification.created';

export interface RealtimeEvent {
  event_id: string;
  event_type: RealtimeEventType;
  occurred_at: string;
  recipient_user_id: string | null;
  topic: string | null;
  payload: Record<string, unknown>;
}

export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface RealtimeClientOptions {
  /** Overridable so tests can inject a fake socket factory. */
  createSocket?: (url: string) => WebSocket;
  baseUrl?: string;
  /** First reconnect delay; doubles each attempt up to `maxBackoffMs`. */
  backoffMs?: number;
  maxBackoffMs?: number;
  /** How many recent ids to remember for deduplication. */
  dedupeWindow?: number;
}

const EVENT_TYPES: ReadonlySet<string> = new Set<RealtimeEventType>([
  'connection.opened',
  'connection.closed',
  'system.ping',
  'system.error',
  'message.created',
  'conversation.read',
  'notification.created',
]);

/** Rebuild `/api/v1` into `wss://host/api/v1/ws`. */
export function socketUrlFor(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.startsWith('https://')) {
    return `${trimmed.replace('https://', 'wss://')}/ws`;
  }
  if (trimmed.startsWith('http://')) {
    return `${trimmed.replace('http://', 'ws://')}/ws`;
  }
  return `${trimmed}/ws`;
}

/** Validate one frame. Returns null for anything that is not an envelope. */
export function parseRealtimeEvent(raw: string): RealtimeEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Partial<RealtimeEvent>;
  if (typeof candidate.event_id !== 'string' || candidate.event_id.length === 0) {
    return null;
  }
  if (
    typeof candidate.event_type !== 'string' ||
    !EVENT_TYPES.has(candidate.event_type)
  ) {
    return null;
  }
  return {
    event_id: candidate.event_id,
    event_type: candidate.event_type as RealtimeEventType,
    occurred_at: typeof candidate.occurred_at === 'string' ? candidate.occurred_at : '',
    recipient_user_id:
      typeof candidate.recipient_user_id === 'string' ? candidate.recipient_user_id : null,
    topic: typeof candidate.topic === 'string' ? candidate.topic : null,
    payload:
      typeof candidate.payload === 'object' && candidate.payload !== null
        ? (candidate.payload as Record<string, unknown>)
        : {},
  };
}

/**
 * A bounded set of recently-seen event ids.
 *
 * Bounded on purpose: an unbounded set would grow for the life of the session
 * and turn deduplication into a slow leak. A window is enough — a replay only
 * ever covers the recent past.
 */
export class EventDeduplicator {
  private readonly seen = new Set<string>();

  constructor(private readonly limit: number) {}

  /** True when this id is new; false when it has already been handled. */
  accept(eventId: string): boolean {
    if (this.seen.has(eventId)) return false;
    this.seen.add(eventId);
    if (this.seen.size > this.limit) {
      const oldest = this.seen.values().next();
      if (!oldest.done) this.seen.delete(oldest.value);
    }
    return true;
  }

  clear(): void {
    this.seen.clear();
  }

  get size(): number {
    return this.seen.size;
  }
}

type EventListener = (event: RealtimeEvent) => void;
type StatusListener = (status: RealtimeStatus) => void;

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private status: RealtimeStatus = 'idle';
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private appStateSub: NativeEventSubscription | null = null;
  private shouldBeConnected = false;

  private readonly eventListeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly dedupe: EventDeduplicator;

  private readonly createSocket: (url: string) => WebSocket;
  private readonly baseUrl: string;
  private readonly backoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(options: RealtimeClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? env.apiBaseUrl;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.backoffMs = options.backoffMs ?? 1_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.dedupe = new EventDeduplicator(options.dedupeWindow ?? 256);
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  /**
   * Drive a status transition without a socket.
   *
   * Test seam only. The reconnect path is "the socket reopens", which a unit
   * test cannot stage against a fake that never opens — and the catch-up it
   * triggers is exactly the behaviour worth asserting.
   */
  __test_setStatus(status: RealtimeStatus): void {
    this.setStatus(status);
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Open the socket using the stored access token.
   *
   * The token is read at connect time rather than held, so a sign-out that
   * clears storage cannot leave this object holding a live credential.
   */
  async connect(): Promise<void> {
    this.shouldBeConnected = true;
    this.token = await tokenStorage.get();
    if (!this.token) {
      // No session means nothing to authenticate with. Staying closed is the
      // honest state; a socket with no token would only earn a 1008.
      this.setStatus('closed');
      return;
    }
    this.openSocket();
    this.watchAppState();
  }

  /** Close deliberately. No reconnect follows. */
  disconnect(): void {
    this.shouldBeConnected = false;
    this.clearReconnect();
    this.unwatchAppState();
    this.closeSocket();
    this.setStatus('closed');
    this.dedupe.clear();
  }

  /**
   * Close because the session ended.
   *
   * Distinct from {@link disconnect} in intent, identical in effect — kept
   * separate so a sign-out reads correctly at the call site and so a later
   * phase can give it different behaviour without changing every caller.
   */
  async disconnectForLogout(): Promise<void> {
    this.disconnect();
    this.token = null;
  }

  private openSocket(): void {
    if (!this.shouldBeConnected || !this.token) return;
    this.setStatus('connecting');
    const url = `${socketUrlFor(this.baseUrl)}?token=${encodeURIComponent(this.token)}`;
    let socket: WebSocket;
    try {
      socket = this.createSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
    };
    socket.onmessage = (event: { data: unknown }) => {
      if (typeof event.data !== 'string') return;
      this.handleFrame(event.data);
    };
    socket.onerror = () => {
      // `onclose` always follows, so reconnection is scheduled there. Handling
      // it here too would double-schedule.
    };
    socket.onclose = () => {
      this.socket = null;
      this.setStatus('closed');
      if (this.shouldBeConnected) this.scheduleReconnect();
    };
  }

  private handleFrame(raw: string): void {
    const event = parseRealtimeEvent(raw);
    // A malformed frame is dropped, not fatal: one bad message must not take
    // down a connection that is otherwise healthy.
    if (!event) return;
    if (!this.dedupe.accept(event.event_id)) return;
    if (event.event_type === 'system.ping') {
      this.sendPong();
      return;
    }
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // One throwing handler must not stop the others.
      }
    }
  }

  private sendPong(): void {
    try {
      this.socket?.send(JSON.stringify({ type: 'pong' }));
    } catch {
      // Best effort. If the socket is gone, the close handler will reconnect.
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldBeConnected || this.reconnectTimer !== null) return;
    const delay = Math.min(this.backoffMs * 2 ** this.attempt, this.maxBackoffMs);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    // Drop the handlers first: closing fires `onclose`, and a reconnect would
    // otherwise be scheduled by a deliberate disconnect.
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // A throwing observer must not break the state change.
      }
    }
  }

  /**
   * Follow the app's foreground state.
   *
   * Android suspends sockets when the app is backgrounded, so a connection that
   * looks open may be dead on return. Reconnecting on foreground is the only
   * way to recover without waiting for a TCP timeout that may never come.
   */
  private watchAppState(): void {
    if (this.appStateSub !== null) return;
    this.appStateSub = AppState.addEventListener('change', this.handleAppStateChange);
  }

  private unwatchAppState(): void {
    this.appStateSub?.remove();
    this.appStateSub = null;
  }

  private handleAppStateChange = (state: AppStateStatus): void => {
    if (!this.shouldBeConnected) return;
    if (state === 'active' && this.status !== 'open') {
      this.attempt = 0;
      this.clearReconnect();
      this.openSocket();
    }
  };
}

/** The app-wide client. Built lazily so importing does not open a socket. */
let sharedClient: RealtimeClient | null = null;

export function realtimeClient(): RealtimeClient {
  if (sharedClient === null) {
    sharedClient = new RealtimeClient();
  }
  return sharedClient;
}

/** Replace the shared client. Test seam. */
export function setRealtimeClient(client: RealtimeClient | null): void {
  sharedClient?.disconnect();
  sharedClient = client;
}