/**
 * The Message section's tab model — pure data and pure functions, so the tab
 * bar, the counts and the local search are unit-testable in Node.
 *
 * Three tabs are **panes** of the Messages screen:
 *
 *  - **`all`** — every conversation the caller is a member of, newest activity
 *    first, straight from `GET /conversations`.
 *  - **`unread`** — the same list narrowed to threads with a server-reported
 *    `unread_count` above zero. The count is the server's, never a client
 *    tally: a thread is unread when the server says it is.
 *  - **`requests`** — the *message requests* from the independent message
 *    service (permission to message), with the server's pending count. A
 *    message request is not a connection request and is kept strictly apart
 *    from one: accepting it grants permission to message, never a connection.
 *
 * What is deliberately **not** here, and why:
 *
 *  - **No connection-request surface.** Incoming connection requests are
 *    handled through Home → the notification bell → `/notifications`. The old
 *    Connections/Companies destination tabs are gone from this screen, and the
 *    full request surface lives in `/connections` (reachable from
 *    Notifications) — so this screen is about conversations and nothing else.
 *  - **No Mentors tab.** No role or category field on a user marks somebody a
 *    mentor, so a Mentors filter would be a button with no honest rule behind
 *    it.
 *  - **No Groups tab.** The `/conversations` contract is 1:1 — there is no
 *    group conversation to list, so a Groups filter would be decoration that
 *    implies a feature that does not exist.
 *
 * The Requests label carries the server's pending count. It is never a
 * hardcoded number and never a client-side tally of loaded pages: the count
 * comes from `pending_count` on the list response (the same number
 * `GET /message-requests/count` returns), and it is recomputed after every
 * confirmed Accept/Reject through a cache invalidation.
 */

import type { Conversation } from '@/api/messages';
import type { MessageRequest } from '@/api/messageRequests';
import type { Connection, UserSummary } from '@/types/onboarding';

export type MessageSectionId = 'all' | 'unread' | 'requests';

export interface MessageSection {
  id: MessageSectionId;
  label: string;
}

export const MESSAGE_SECTIONS: readonly MessageSection[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'requests', label: 'Requests' },
];

/** The pane to show for a section — every section is a pane now. */
export function paneFor(section: MessageSectionId): 'all' | 'unread' | 'requests' {
  return section;
}

/**
 * True when the thread is unread — the server's `unread_count` above zero.
 *
 * Excludes the caller's own messages by definition, because the server already
 * does: adding up anything else on the client would drift from its number.
 */
export function isConversationUnread(conversation: Conversation): boolean {
  return conversation.unread_count > 0;
}

/**
 * The Requests label with its count: `Requests (3)` — or plain `Requests`
 * when there is nothing pending. Zero is shown as no count rather than
 * "(0)"; a badge that says zero is noise, and the empty state below the tabs
 * already says it in words.
 */
export function sectionLabel(
  section: MessageSection,
  pendingCount: number | undefined,
): string {
  if (section.id !== 'requests' || !pendingCount || pendingCount <= 0) {
    return section.label;
  }
  return `${section.label} (${pendingCount})`;
}

/**
 * The professional subtitle shown under a sender's name, e.g.
 * "Product Designer at Acme". The message-request sender summary carries only
 * `designation`, so that field alone is rendered when present and nothing is
 * shown when it is absent — no company, college, or mutual count is invented.
 */
export function requestContextLine(designation: string | null | undefined): string {
  if (typeof designation !== 'string') return '';
  const trimmed = designation.trim();
  return trimmed.length > 0 ? trimmed : '';
}

/** Normalised substring match over the fields a row actually shows. */
function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => (field ?? '').toLowerCase().includes(needle));
}

/**
 * Local search over the requests already loaded.
 *
 * This filters *this page of this screen* — it does not claim to search
 * every request the server holds, and the placeholder text says
 * "Search messages or companies" while this tab narrows what is on it.
 */
export function filterRequests(
  requests: readonly MessageRequest[],
  query: string,
): MessageRequest[] {
  if (!query.trim()) return [...requests];
  return requests.filter((request) =>
    matches(query, request.sender.name, request.sender.designation, request.note),
  );
}

/** Local search over the loaded inbox: member names and the last message. */
export function filterConversations(
  conversations: readonly Conversation[],
  query: string,
): Conversation[] {
  if (!query.trim()) return [...conversations];
  return conversations.filter((conversation) =>
    matches(
      query,
      conversation.last_message?.body,
      ...conversation.members.map((member) => member.name),
    ),
  );
}

/**
 * Relative time for a request card: `just now`, `15m`, `3h`, `2d`.
 *
 * Same vocabulary as `formatStoryRelativeTime`, so two lists in one app never
 * disagree about what "recent" looks like. An unparseable value renders as an
 * empty string rather than "Invalid Date". A timestamp in the future (clock
 * skew) collapses to "just now" rather than showing a negative age.
 */
export function formatRequestTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** The one-line preview of a thread: the last message, or an honest blank. */
export function conversationPreview(conversation: Conversation): string {
  const last = conversation.last_message;
  if (!last) return '';
  if (last.deleted_at !== null) return 'Message deleted';
  if (last.body !== null) return last.body;
  // A live message with no caption: name the attachment rather than claiming a
  // deletion — a photo-only row is real content, and its attachment is still
  // visible in the thread.
  if (last.media !== null) return last.media.kind === 'video' ? 'Video' : 'Photo';
  // No stamp, no text, no attachment: the shape the server never produces,
  // which reads the same honest way it always has.
  return 'Message deleted';
}
/** One row of the Messages list: a real conversation, or a connected person
 *  who has no thread yet. No thread is invented on the client — a row of this
 *  shape always points at a server-owned conversation, or at a live
 *  connection that has to be opened once before any message can exist.
 */
export type MessageRow =
  | { kind: 'conversation'; conversation: Conversation }
  | { kind: 'seed'; person: UserSummary; connectionId: string; createdAt: string };

/** Connected people with no thread yet, placed after the server's conversation
 *  order. `created_at` is ISO-8601, so string comparison keeps the most recent
 *  relationship on top of the idle group. */
export function connectionSeeds(
  conversations: readonly Conversation[],
  connections: readonly Connection[] | null | undefined,
  selfPublicId: string | null | undefined,
): MessageRow[] {
  // Every connection row the caller participates in, keyed by the other person.
  // Rows are newest first in the response, so the most recent row per person
  // wins — a revoked request can never shadow a live accepted one.
  const people = new Map<string, Connection>();
  for (const row of connections ?? []) {
    const other = row.user?.public_id;
    if (!other || other === selfPublicId) continue;
    const existing = people.get(other);
    if (!existing || row.created_at > existing.created_at || (row.created_at === existing.created_at && row.id > existing.id)) {
      people.set(other, row);
    }
  }

  // Accepted relationships only travel into the Threads list (pending rows are
  // requests, not conversations — see `notificationAction` in
  // `notificationModel.ts`). A connection with no thread still needs a place:
  const accepted = new Map<string, Connection>();
  for (const row of people.values()) {
    if (row.status === 'accepted') accepted.set(row.user.public_id, row);
  }

  const active = new Map<string, Conversation>();
  for (const conversation of conversations) {
    for (const member of conversation.members) {
      if (member.public_id && !active.has(member.public_id)) {
        active.set(member.public_id, conversation);
      }
    }
  }

  const seeds: MessageRow[] = [];
  for (const [publicId, connection] of accepted) {
    const conversation = active.get(publicId);
    if (conversation) {
      seeds.push({ kind: 'conversation', conversation });
    } else {
      seeds.push({
        kind: 'seed',
        person: connection.user,
        connectionId: connection.id,
        createdAt: connection.created_at,
      });
    }
  }

  seeds.sort((a, b) => {
    if (a.kind === 'conversation' && b.kind === 'conversation') {
      return compareLastMessageAt(b.conversation, a.conversation);
    }
    if (a.kind === 'conversation') return -1;
    if (b.kind === 'conversation') return 1;
    return compareCreatedAt(b.createdAt, a.createdAt);
  });

  return seeds;
}



// append probe
/** Newest conversation activity first. */
function compareLastMessageAt(a: Conversation, b: Conversation): number {
  const aTime = a.last_message_at ?? '';
  const bTime = b.last_message_at ?? '';
  if (aTime < bTime) return 1;
  if (aTime > bTime) return -1;
  return 0;
}

/** Idle relationships first by how recently they started — freshest offer on
 *  top of the list. */
function compareCreatedAt(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Only the connected people with no thread yet. Local search over this screen
 *  never claims to search every server-side person — `MessageSearchField`
 *  still describes itself as "search messages or companies". */
export function filterSeedRows(
  seeds: readonly MessageRow[],
  query: string,
): MessageRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...seeds];
  return seeds.filter((row) =>
    row.kind === 'seed'
      ? matches(needle, row.person.name, row.person.username, row.person.public_id)
      : false,
  );
}

