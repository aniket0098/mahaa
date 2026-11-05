/**
 * Realtime → TanStack Query bridge.
 *
 * Deliberately narrow. Phase 1 handled the four *foundation* events and nothing
 * else; Phase 2 added the two messaging events; Phase 3 the notification; Phase
 * 12 the four content events. There is no blanket `invalidateQueries()` — a
 * socket that invalidated everything on each frame would be no better than
 * polling, only more expensive.
 *
 * **Content events invalidate; they never populate.** `post.created` carries a
 * post id, not a post. Writing that id into the cache as though it were content
 * would create a second, weaker rendering path — one that could not know the
 * author's current avatar, the real engagement counts, or whether a story has
 * already expired. So each event marks the key stale and REST answers with the
 * server's own record. The socket delivers *that something changed*; PostgreSQL
 * remains the only authority on *what it is*.
 *
 * **The mobile app has no messaging screens yet** (§7.1: both messages screens
 * are `StageScreen` notices, and there is no `src/api/messages.ts`). So there is
 * no conversation query in the cache to write into. Rather than inventing one,
 * the handlers here mark the affected conversation's queries *stale* — which is
 * exactly the "targeted refetch" a mounted screen would pick up on its next
 * render, and a no-op when nothing is mounted.
 *
 * The message is **not** upserted into a cache here. Doing so would mean
 * inventing a cache shape that the future messaging module would then have to
 * match exactly, and a mismatch would show a thread rendered from two different
 * sources. REST stays authoritative until that module exists.
 */

import { queryClient } from '@/api/queryClient';
import { queryKeys } from '@/api/queryKeys';
import {
  type RealtimeEvent,
  type RealtimeStatus,
  realtimeClient,
} from '@/realtime/client';

/**
 * The query keys a messaging module will use.
 *
 * Declared here rather than in `queryKeys.ts` because that file documents one
 * object for queries that *exist*. These are the keys Phase 2 invalidates, and
 * the messaging module must use the same names for the invalidation to bite.
 */
export const messagingQueryKeys = {
  conversations: ['conversations'] as const,
  conversation: (conversationId: string) => ['conversations', conversationId] as const,
  messages: (conversationId: string) =>
    ['conversations', conversationId, 'messages'] as const,
};

/**
 * The notification query keys Phase 3 refreshes.
 *
 * §13 requires the unread count to exist *before* any badge is drawn, so these
 * are the two things a `notification.created` event can change: the list, and the
 * number a badge would show. Both are server-derived — the client never counts
 * its own inbox.
 */
export const notificationQueryKeys = {
  list: ['notifications'] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
};

/**
 * The call keys Phase 14 owns. History lives under the conversation; one live
 * call row has its own top-level key so the active screen can track one
 * lifecycle without refetching a list.
 */
export const callQueryKeys = {
  history: (conversationId: string) => ['conversations', conversationId, 'calls'] as const,
  detail: (callId: string) => ['calls', callId] as const,
};

/**
 * The content keys a `post.*` or `story.*` event refreshes.
 *
 * **Taken from `queryKeys`, not re-declared.** An invalidation typed out here
 * would be a second spelling of a key the app already owns, and the two would
 * drift the first time a key was renamed — the failure being that the event
 * arrives, the invalidation "succeeds", and nothing refetches.
 */
const CONTENT_QUERY_KEYS = {
  posts: queryKeys.postsRoot,
  stories: queryKeys.stories,
} as const;


function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Active-call routing. A call cannot be conveyed by cache invalidation alone:
 * the callee must *navigate* to a ringing screen even when no call query is
 * mounted, and the caller must move on when accept lands. So the bridge
 * exposes pub/sub for the three participant-targeted events, and the screens
 * answer each by re-fetching the authoritative row over REST. No token, room
 * URL or media value ever crosses this boundary — the token is minted on
 * demand from the token endpoint.
 */
export type IncomingCallPayload = {
  callId: string;
  conversationId: string;
  callerUserId: string;
  mode: 'audio' | 'video';
};

export type CallAcceptedPayload = {
  callId: string;
  conversationId: string;
  calleeUserId: string;
};

export type CallEndedPayload = {
  callId: string;
  conversationId: string;
  status: string;
  endedByUserId: string | null;
};

type CallListener<T> = (payload: T) => void;

const incomingListeners = new Set<CallListener<IncomingCallPayload>>();
const acceptedListeners = new Set<CallListener<CallAcceptedPayload>>();
const endedListeners = new Set<CallListener<CallEndedPayload>>();

/** Observe `call.incoming` (callee side). Returns an unsubscribe fn. */
export function onIncomingCall(listener: CallListener<IncomingCallPayload>): () => void {
  incomingListeners.add(listener);
  return () => {
    incomingListeners.delete(listener);
  };
}

/** Observe `call.accepted` (caller side). Returns an unsubscribe fn. */
export function onCallAccepted(listener: CallListener<CallAcceptedPayload>): () => void {
  acceptedListeners.add(listener);
  return () => {
    acceptedListeners.delete(listener);
  };
}

/** Observe `call.ended` (both sides). Returns an unsubscribe fn. */
export function onCallEnded(listener: CallListener<CallEndedPayload>): () => void {
  endedListeners.add(listener);
  return () => {
    endedListeners.delete(listener);
  };
}

function notifyCall<T>(listeners: Set<CallListener<T>>, payload: T): void {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // One throwing screen must not stop the others.
    }
  }
}

/**
 * Parse a call event into its routing payload — a bad frame is dropped, never
 * thrown, so one malformed message must not take down the connection.
 */
export function emitCallEvent(event: RealtimeEvent): void {
  const { event_type: type, payload } = event;
  if (type === 'call.incoming') {
    const callId = str(payload.call_id);
    const conversationId = str(payload.conversation_id);
    const callerUserId = str(payload.caller_user_id);
    const mode = str(payload.mode);
    if (!callId || !conversationId || !callerUserId || (mode !== 'audio' && mode !== 'video')) {
      return;
    }
    notifyCall(incomingListeners, { callId, conversationId, callerUserId, mode });
  } else if (type === 'call.accepted') {
    const callId = str(payload.call_id);
    const conversationId = str(payload.conversation_id);
    const calleeUserId = str(payload.callee_user_id);
    if (!callId || !conversationId || !calleeUserId) return;
    notifyCall(acceptedListeners, { callId, conversationId, calleeUserId });
  } else if (type === 'call.ended') {
    const callId = str(payload.call_id);
    const conversationId = str(payload.conversation_id);
    const status = str(payload.status);
    if (!callId || !conversationId || !status) return;
    const endedBy = payload.ended_by_user_id;
    notifyCall(endedListeners, {
      callId,
      conversationId,
      status,
      endedByUserId: typeof endedBy === 'string' && endedBy.length > 0 ? endedBy : null,
    });
  }
}

/**
 * Wire a call event into cache effects and active-call routing. Returns true
 * when the event did something, so the dispatch site can report it.
 */
export function applyCallEvent(event: RealtimeEvent): boolean {
  const { event_type: type, payload } = event;
  if (type !== 'call.incoming' && type !== 'call.accepted' && type !== 'call.ended') {
    return false;
  }
  // Route to the active-call screens first; `emitCallEvent` validates.
  emitCallEvent(event);
  const conversationId = str(payload.conversation_id);
  // Even without a conversation id the routing above still ran, so report
  // handled — but there is no cache key worth touching.
  if (!conversationId) return true;
  void queryClient.invalidateQueries({
    queryKey: callQueryKeys.history(conversationId),
  });
  // The list carries the last-call preview, so it can change too.
  void queryClient.invalidateQueries({
    queryKey: messagingQueryKeys.conversations,
  });
  return true;
}

/**
 * Apply one event to the cache.
 *
 * Returns true when the event actually did something, so a caller (and a test)
 * can assert that a no-op event really was a no-op rather than quietly refetching.
 */
export function applyRealtimeEvent(event: RealtimeEvent): boolean {
  switch (event.event_type) {
    case 'message.created': {
      const conversationId = str(event.payload.conversation_id);
      // A payload without a conversation is not actionable, and guessing would
      // invalidate a key that may belong to somebody else's thread.
      if (!conversationId) return false;
      void queryClient.invalidateQueries({
        queryKey: messagingQueryKeys.conversation(conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: messagingQueryKeys.conversations,
      });
      return true;
    }
    case 'message.updated': {
      // An edit restamps one bubble in place. Refresh it the same way, because
      // the list preview is the row's own last message and can change too --
      // but the detail (members, unread) cannot, so it is left alone.
      const conversationId = str(event.payload.conversation_id);
      if (!conversationId) return false;
      void queryClient.invalidateQueries({
        queryKey: messagingQueryKeys.messages(conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: messagingQueryKeys.conversations,
      });
      return true;
    }
    case 'call.incoming':
    case 'call.accepted':
    case 'call.ended': {
      // Routing + cache effects both live in applyCallEvent: the active-call
      // screens navigate from it, and history refreshes from the same event.
      return applyCallEvent(event);
    }

    case 'conversation.read': {
      const conversationId = str(event.payload.conversation_id);
      if (!conversationId) return false;
      // Narrow: the conversation's own read state and the unread badge in the
      // list. Nothing outside those two keys is touched.
      void queryClient.invalidateQueries({
        queryKey: messagingQueryKeys.conversation(conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: messagingQueryKeys.conversations,
      });
      return true;
    }

    case 'notification.created': {
      // A notification without an id cannot be placed, deduped against the list,
      // or deep-linked from — so it is dropped rather than half-applied.
      if (!str(event.payload.id)) return false;
      // Two keys, both narrow: the inbox and the badge number. The payload does
      // not carry the unread count, and the server owns that number (§13), so
      // both are marked stale rather than computed here.
      void queryClient.invalidateQueries({
        queryKey: notificationQueryKeys.list,
      });
      void queryClient.invalidateQueries({
        queryKey: notificationQueryKeys.unreadCount,
      });
      return true;
    }

    case 'post.created':
    case 'post.updated':
    case 'post.deleted': {
      // A post id the event does not carry is not actionable, and guessing one
      // would refresh a feed on behalf of a row nobody announced.
      if (!str(event.payload.post_id)) return false;
      // **One key, and it is the bare `['posts']` prefix.** Every post read in
      // the app is nested under it — `['posts']` (the feed), `['posts', 'mine']`,
      // `['posts', id, 'comments']` — and React Query matches a filter against the
      // *leading* segments, so one invalidation covers all of them. That is
      // deliberate: an edited post changes its own comments' meaning and its
      // author's own list, and a narrower invalidation would leave one of them
      // stale.
      //
      // Nothing is written into the cache from the payload. The event carries an
      // id, not a post, so the only honest next step is `GET /posts`.
      void queryClient.invalidateQueries({ queryKey: CONTENT_QUERY_KEYS.posts });
      return true;
    }

    case 'story.created': {
      if (!str(event.payload.story_id)) return false;
      // The tray reads one list. Same rule as above: mark it stale and let REST
      // supply the story, including whether it has expired.
      void queryClient.invalidateQueries({ queryKey: CONTENT_QUERY_KEYS.stories });
      return true;
    }

    case 'system.error':
      // Nothing to refetch: the server told us the transport had a problem, not
      // that our data is stale. Reporting it is a later phase's job.
      return false;
    case 'connection.opened':
    case 'connection.closed':
    case 'system.ping':
      // Transport lifecycle. No cache effect by design.
      return false;
    default:
      return false;
  }
}

/**
 * Catch up after a reconnect.
 *
 * There is no durable event log — Phase 1 deliberately has none — so anything
 * that arrived while the socket was down exists only in PostgreSQL. This marks
 * the messaging, notification **and content** queries stale so a mounted screen
 * refetches exactly those, and nothing else in the application.
 *
 * The unread count is included because a notification missed while offline
 * changes the number a badge would draw, and REST is the only authority for it.
 *
 * **The content keys are here for the same reason, and it is the whole argument
 * for keeping REST as the source of truth.** A user who was offline while
 * somebody posted must still meet that post when the socket comes back. There is
 * no event log to replay, so the only way to recover the missed content is to
 * ask the server — which is exactly this pair of invalidations. The socket makes
 * delivery instant; it is never the only way content reaches a reader.
 *
 * `refetchType` is left at its default so only *active* queries refetch: a
 * backgrounded screen should not be fetched just because a socket reopened.
 */
export function catchUpMessagingAfterReconnect(): void {
  void queryClient.invalidateQueries({
    queryKey: messagingQueryKeys.conversations,
  });
  void queryClient.invalidateQueries({
    queryKey: notificationQueryKeys.list,
  });
  void queryClient.invalidateQueries({
    queryKey: notificationQueryKeys.unreadCount,
  });
  // Content: the feed and the story tray, and nothing else.
  void queryClient.invalidateQueries({ queryKey: CONTENT_QUERY_KEYS.posts });
  void queryClient.invalidateQueries({ queryKey: CONTENT_QUERY_KEYS.stories });
}

/** Subscribe the shared client to the query cache. Returns an unsubscribe fn. */
export function bindRealtimeToQueryCache(): () => void {
  const client = realtimeClient();
  const offEvent = client.onEvent((event) => {
    applyRealtimeEvent(event);
  });
  // A reconnect is the moment the socket may have missed events, and Phase 1 has
  // no durable log to replay them from — so the messaging queries are marked
  // stale exactly once, on the transition back to `open`. No other query key is
  // touched, and nothing is refetched while the socket is down.
  // `seenOpen` is seeded from the client's *current* status, not from `false`.
  // A client that was already open when this bound has had its initial data
  // fetched by the queries themselves, so treating that as a reconnect would
  // refetch everything once for no reason. Only a genuine closed -> open
  // transition — the shape of a dropped socket — triggers catch-up.
  let wasOpen = client.getStatus() === 'open';
  const offStatus = client.onStatus((status: RealtimeStatus) => {
    if (status === 'open' && wasOpen === false) {
      catchUpMessagingAfterReconnect();
    }
    wasOpen = status === 'open';
  });
  return () => {
    offEvent();
    offStatus();
  };
}

/** Observe connection state. Returns an unsubscribe fn. */
export function observeRealtimeStatus(
  listener: (status: RealtimeStatus) => void,
): () => void {
  return realtimeClient().onStatus(listener);
}

/** Exposed so a future phase can write a specific key from an event handler. */
export { queryClient };