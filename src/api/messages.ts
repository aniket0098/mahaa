/**
 * Conversations API — the "All" tab's inbox, served by the **main** backend.
 *
 * Binds to the `/conversations` router in
 * `backend/app/api/v1/endpoints/messaging.py`. Those seven routes exist, are
 * tested in `backend/tests/test_p5_messaging.py`, and have had no mobile
 * caller until now — this module is the caller §7.3's docstring anticipated
 * ("the thing a Phase 10 mobile module will bind to").
 *
 * Message *requests* live on the other service (`messageRequests.ts`); a
 * conversation is only openable between two connected people, which is the
 * main backend's relationship rule and is not re-implemented here.
 *
 * Two transport rules taken from the server's contract rather than guessed:
 *
 * - **Keyset pagination.** `{items, next_cursor, has_more}` — pass the cursor
 *   back verbatim, and never read a `total`: keyset deliberately does not
 *   compute one.
 * - **Unread counts are the server's.** `unread_count` excludes the caller's
 *   own messages; adding up anything on the client would drift from it.
 */

import { apiClient } from '@/api/client';
import type { UserSummary } from '@/types/onboarding';

/** One photo or video attached to a message — the member-visible metadata. */
export interface MessageAttachment {
  id: string;
  /** A message carries an image or a video; the server enforces both. */
  kind: 'image' | 'video';
  mime_type: string;
  /** Server-derived for images; `null` for video, which is not decoded. */
  width: number | null;
  height: number | null;
  size_bytes: number;
  /** Relative served path — join onto the API base (see `absoluteMediaUri`). */
  served_at: string;
}

/** One message inside a thread, as the member sees it. */
export interface ThreadMessage {
  id: string;
  conversation_id: string;
  sender: UserSummary;
  /**
   * Null for a text-only message, for a photo with no caption, and for a
   * tombstone — distinguish those by `media` and `deleted_at`.
   */
  body: string | null;
  client_message_id: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  /**
   * The attached photo or video, or null for a text-only message. A tombstone
   * reveals neither its text nor its attachment, so `deleted_at` set means
   * this is null too.
   */
  media: MessageAttachment | null;
}

export interface Conversation {
  id: string;
  created_by: string;
  created_at: string;
  last_message_at: string | null;
  last_message: ThreadMessage | null;
  members: UserSummary[];
  unread_count: number;
  muted: boolean;
  archived: boolean;
}

export interface ConversationPage {
  items: Conversation[];
  /** Opaque; pass it back as `cursor`. Null when there is nothing older. */
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * A page of a thread, oldest to newest within the page.
 *
 * Two paging directions, because the client needs both: `cursor` walks backwards
 * through history (loading older messages), and `since` is the polling direction
 * §7.2 describes (new messages after a known one). With neither, the most recent
 * page — what a thread shows when it is opened.
 */
export interface MessagePage {
  items: ThreadMessage[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * One page of the caller's conversations, newest activity first.
 *
 * The page size matches the server's default (50) rather than asking for
 * more: an inbox list is read top-down, and a second page is requested only
 * when the caller scrolls to it.
 */
export function listConversations(
  options: { cursor?: string | null; limit?: number } = {},
): Promise<ConversationPage> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  const query = params.toString();
  return apiClient.get<ConversationPage>(`/conversations${query ? `?${query}` : ''}`);
}

/**
 * Open a thread with `userId`, or hand back the one that already exists.
 *
 * The server refuses with **403** when the two are not connected — or when the
 * other person has turned messages off, indistinguishable on purpose, so a
 * sender cannot discover a private setting by trying. A repeat of an existing
 * thread answers 200 with the same record rather than 201, because the thread
 * was not "created". `userId` is the **internal** user id from a lookup result.
 */
export function openConversation(userId: string): Promise<Conversation> {
  return apiClient.post<Conversation>('/conversations', { body: { user_id: userId } });
}

/** Conversation detail — members and the last message. A non-member gets 404. */
export function fetchConversation(conversationId: string): Promise<Conversation> {
  return apiClient.get<Conversation>(`/conversations/${conversationId}`);
}

export function listMessages(
  conversationId: string,
  options: { cursor?: string | null; since?: string | null; limit?: number } = {},
): Promise<MessagePage> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.since) params.set('since', options.since);
  const query = params.toString();
  return apiClient.get<MessagePage>(
    `/conversations/${conversationId}/messages${query ? `?${query}` : ''}`,
  );
}

/**
 * Store a message with the **authenticated caller** as its sender.
 *
 * The body carries no sender field; `client_message_id` is the idempotency key —
 * re-sending a message with the same one answers 200 with the same record
 * instead of appending a duplicate, which is what makes a tapped-twice send safe.
 *
 * A message carries **text, an attachment, or both**: `body` may be null (a
 * photo with no caption) and `media_id` names an already-uploaded
 * `POST /media` asset owned by the caller. At least one must be present — the
 * server refuses a blank bubble with 422, so `canSend` in the conversation
 * model gates on the same rule before this is ever called.
 */
export function sendMessage(
  conversationId: string,
  body: {
    body?: string | null;
    media_id?: string | null;
    client_message_id?: string | null;
  },
): Promise<ThreadMessage> {
  return apiClient.post<ThreadMessage>(`/conversations/${conversationId}/messages`, { body });
}

/** Move the caller's own read pointer forward — 204, no body. */
export function markConversationRead(conversationId: string, messageId: string): Promise<void> {
  return apiClient.post<void>(`/conversations/${conversationId}/read`, {
    body: { message_id: messageId },
  });
}

/**
 * Soft delete one of the caller's own messages — `DELETE /messages/{id}`, 204.
 *
 * The server's contract is *delete for everyone as a tombstone*: the row keeps
 * its slot and stamps `deleted_at`, so the other participant reads
 * "This message was deleted" in the same position rather than watching the
 * message vanish mid-thread. Only the sender may call this; anybody else gets a
 * 404, which is why the client offers the action on outgoing rows only.
 *
 * There is deliberately no `deleteMessageForMe`: no such endpoint exists, and a
 * control that pretended otherwise would hide a message locally while the other
 * side still had it.
 */
export function deleteMessage(messageId: string): Promise<void> {
  return apiClient.delete<void>(`/messages/${messageId}`);
}

/**
 * Edit the text of one of the caller's own messages — `PATCH /messages/{id}`.
 *
 * The server re-derives author, conversation and `edited_at` from the stored row
 * and the authenticated caller; the request body is exactly `{ body }` and the
 * schema is `extra="forbid"`, so nothing on the client can move the edit stamp
 * or name a different sender. Returns the canonical updated row.
 *
 * A non-author, a non-member, an unknown id and an already-deleted message all
 * answer the same **404** (anti-enumeration, matching `deleteMessage`), so the
 * client cannot tell "not mine" from "not there" — which is the point. Sending
 * identical text is a no-op that returns the row unchanged without moving
 * `edited_at`, so a tapped-twice save is safe.
 */
export function editMessage(
  messageId: string,
  body: { body: string },
): Promise<ThreadMessage> {
  return apiClient.patch<ThreadMessage>(`/messages/${messageId}`, { body });
}
