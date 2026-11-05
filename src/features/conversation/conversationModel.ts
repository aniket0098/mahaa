/**
 * The one-to-one conversation model — pure data in, decisions out.
 *
 * No React, no network, so every rule below is testable in plain Node
 * (`conversationModel.test.ts`). Three ideas live here:
 *
 *  1. **Whose bubble.** A message is outgoing when its sender is the signed-in
 *     caller, identified by the user id the lookup and `GET /users/me` agree on.
 *     The sender of a tombstone is still a person, so deleted rows keep their
 *     side — the *text* says the message was deleted, which is the honest change.
 *  2. **Day separators.** The server pages oldest-to-newest; a separator is
 *     inserted where the calendar day changes. The date is derived from
 *     `created_at` in the device's own locale, because a "Today" label is a
 *     reading aid, not a server fact.
 *  3. **The composer's rules.** Empty or whitespace-only text is not sendable
 *     and neither is nothing at all; an uploaded attachment satisfies the gate
 *     on its own. The message is sent only after the server confirms; a draft
 *     is preserved across a failure. Those rules are stated here as pure
 *     predicates so the screen and the test agree on them.
 *  4. **Attachments.** A live message carries text, an attachment, or both. The
 *     tombstone rule follows: only a row with neither body nor attachment is
 *     "deleted" without a `deleted_at` stamp, so a photo-only message is live
 *     content, not a deletion.
 */

import type { ThreadMessage } from '@/api/messages';
import type { UserSummary } from '@/types/onboarding';

/** The two sides of a thread. There is no third side: this build is 1:1. */
export type MessageSide = 'outgoing' | 'incoming';

export interface DisplayMessage {
  message: ThreadMessage;
  side: MessageSide;
  /** True when this row starts a new visual cluster (new sender, new day). */
  startsCluster: boolean;
}

/** A day separator as the list renders it: one line per date. */
export interface DaySeparator {
  kind: 'separator';
  /** `YYYY-MM-DD` in the device's local timezone. */
  day: string;
  /** How the separator reads, e.g. "Today", "Yesterday", "Jan 3, 2026". */
  label: string;
}

/** One row of the rendered list: a message, or the day that introduced it. */
export type ConversationRow = { kind: 'message'; entry: DisplayMessage } | DaySeparator;

/**
 * The conversation's other person.
 *
 * The caller is excluded by user id. A conversation is always 1:1, so exactly
 * one member should survive; if the list is older or stranger than that (just
 * created, or the caller missing entirely), the first member is the honest
 * fallback rather than nobody.
 */
export function otherParticipant(
  members: readonly UserSummary[],
  selfUserId: string | null,
): UserSummary | null {
  if (members.length === 0) return null;
  if (!selfUserId) return members[0] ?? null;
  return members.find((member) => member.user_id !== selfUserId) ?? members[0] ?? null;
}

/** True when the sender is the signed-in caller. Compared by user id. */
export function isOutgoing(message: ThreadMessage, selfUserId: string | null): boolean {
  if (!selfUserId) return false;
  return message.sender?.user_id === selfUserId;
}

/** The text a bubble shows. A soft-deleted row reads as its own tombstone. */
export function bubbleText(message: ThreadMessage): string {
  if (isDeleted(message)) return 'This message was deleted.';
  // A live media-only message (photo or video, no caption) has no text of its
  // own — the attachment is the content, and an empty string keeps the caption
  // line from rendering at all rather than pretending a deletion.
  return message.body ?? '';
}

/**
 * True when the bubble is a tombstone rather than a message.
 *
 * A live message needs *some* content: text, an attachment, or both. So a null
 * body is only a tombstone when nothing else survived with it — a photo-only
 * message (body null, media set, no delete stamp) is live content, not a
 * deletion. The server also nulls the attachment of a soft-deleted row, so a
 * row with neither body nor media can only be a tombstone (or a shape the
 * server would never produce, which reads the same honest way).
 */
export function isDeleted(message: ThreadMessage): boolean {
  if (message.deleted_at !== null) return true;
  return message.body === null && message.media === null;
}

/** True when the live message carries a photo or video attachment. */
export function hasMedia(message: ThreadMessage): boolean {
  return !isDeleted(message) && message.media !== null;
}

/** True when the live message's attachment is a photo. */
export function isImage(message: ThreadMessage): boolean {
  return hasMedia(message) && message.media?.kind === 'image';
}

/** True when the live message's attachment is a video. */
export function isVideo(message: ThreadMessage): boolean {
  return hasMedia(message) && message.media?.kind === 'video';
}

/**
 * A short human label for the attachment ("Photo" / "Video"), or null when the
 * message has none (or is a tombstone — a deleted message reveals neither its
 * text nor its attachment, so there is nothing to name).
 */
export function attachmentLabel(message: ThreadMessage): string | null {
  if (!hasMedia(message)) return null;
  return message.media?.kind === 'video' ? 'Video' : 'Photo';
}

/** `YYYY-MM-DD` in the device's local timezone, or null when unparseable. */
export function messageDay(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * A day's label in the reader's language: "Today"/"Yesterday"/"Jan 3, 2026".
 *
 * Computed from the same `Date` primitives as `messageDay`, so a separator and
 * its label can never disagree about which day they mean.
 */
export function dayLabel(day: string, now: number = Date.now()): string {
  const today = new Date(now);
  const todayKey = messageDay(today.toISOString());
  const yesterdayKey = messageDay(new Date(now - 86_400_000).toISOString());
  if (day === todayKey) return 'Today';
  if (day === yesterdayKey) return 'Yesterday';
  const [year, month, monthDay] = day.split('-').map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, monthDay ?? 1);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Server messages (oldest to newest) into rendered rows with day separators.
 *
 * Rows are annotated with their side and whether they start a visual cluster, so
 * the screen never re-derives identity mid-render. An unparseable timestamp
 * drops its separator but keeps the message — the words are the server's; the
 * date line is the client's reading aid.
 */
export function buildConversationRows(
  messages: readonly ThreadMessage[],
  selfUserId: string | null,
): ConversationRow[] {
  const rows: ConversationRow[] = [];
  let lastDay: string | null = null;
  let lastSenderId: string | null = null;

  for (const message of messages) {
    const day = messageDay(message.created_at);
    if (day !== null && day !== lastDay) {
      rows.push({ kind: 'separator', day, label: dayLabel(day) });
      lastDay = day;
      // A day boundary always starts a new cluster, whatever the sender did.
      lastSenderId = null;
    }
    const side: MessageSide = isOutgoing(message, selfUserId) ? 'outgoing' : 'incoming';
    const senderId = message.sender?.user_id ?? null;
    const startsCluster = senderId !== lastSenderId;
    rows.push({ kind: 'message', entry: { message, side, startsCluster } });
    lastSenderId = senderId;
  }

  return rows;
}

/**
 * Whether the caller may delete this message.
 *
 * The server enforces this too — `DELETE /messages/{id}` is sender-only and
 * answers 404 to anybody else — but a control the caller cannot possibly use
 * should never be offered, so the screen hides it on incoming rows and on
 * tombstones rather than inviting a doomed tap.
 */
export function canDelete(message: ThreadMessage, selfUserId: string | null): boolean {
  if (isDeleted(message)) return false;
  return isOutgoing(message, selfUserId);
}

/**
 * Whether the caller may edit this message.
 *
 * Editing shares delete's rule exactly — `PATCH /messages/{id}` is sender-only
 * and answers 404 to anybody else or to a tombstoned row — so `canEdit` is
 * `canDelete`. They are separate names so the call site reads as intent
 * ("is this editable?") rather than as a borrowed predicate, and so the two can
 * diverge later (a product that allowed editing but not deleting) without a
 * silent semantic change at every call site.
 */
export function canEdit(message: ThreadMessage, selfUserId: string | null): boolean {
  return canDelete(message, selfUserId);
}

/**
 * Whether this message carries an edit the recipient should be told about.
 *
 * The only source is `edited_at`, stamped by the server on a successful
 * `PATCH /messages/{id}` — so the "Edited" marker is a server fact, never a
 * local guess that a tap looked like it worked. A tombstone reports false: the
 * server nulls the body on delete, and re-labelling a deleted message "Edited"
 * would describe something nobody can read.
 */
export function isEdited(message: ThreadMessage): boolean {
  return !isDeleted(message) && message.edited_at !== null;
}

/**
 * Whether the composer may send.
 *
 * Whitespace-only text is not sendable — but the draft is kept, not cleared, so
 * a reader who fat-fingered the spacebar loses nothing. An uploaded attachment
 * is content in its own right (a photo with no caption is a real message), so
 * `hasAttachment` satisfies the gate on its own; the server enforces the same
 * "text, attachment, or both" rule with a 422 on a blank bubble.
 */
export function canSend(draft: string, sending: boolean, hasAttachment = false): boolean {
  if (sending) return false;
  return draft.trim().length > 0 || hasAttachment;
}
