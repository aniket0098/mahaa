/**
 * Author connection state — what one feed card may honestly say about the
 * relationship between the signed-in reader and a post's author.
 *
 * Pure data in, string out: no React, no React Query, no API import, so the
 * rules below are testable in plain Node (`connectionState.test.ts`).
 *
 * The rules are the server's semantics, not the UI's:
 *
 *  - **Only `pending` and `accepted` are live.** `declined`, `canceled`, and
 *    `removed` are history — the server lets a new request be sent after any of
 *    them — so a card shows the Connect pill again rather than pinning somebody
 *    to a decision that no longer exists.
 *  - **`is_outgoing` is deliberately ignored.** A pending request the reader
 *    sent and a pending request the reader *received* are both "pending" from
 *    this card's point of view: either way the honest label is Pending, and
 *    answering requests is the Connections screen's job, not the feed's.
 *  - **A null public id is not a person the app can ask about.** Demo authors
 *    have no account, and a record without a public id has no lookup path, so
 *    the answer is `none` without ever scanning the rows.
 */

import type { Connection } from '@/types/onboarding';

/** What the Connect pill renders: `none` → Connect, `pending` → Pending, `connected` → Connected. */
export type AuthorConnectionState = 'none' | 'pending' | 'connected';

/**
 * The relationship to one author, derived from the caller's connection rows.
 *
 * `rows` is the bare list from `GET /connections` (both directions, any status);
 * `publicId` is the *author's* immutable public id from the feed post. Rows for
 * other people are ignored rather than trusted for ordering, because the list
 * is sorted by recency across every relationship the caller holds.
 */
export function deriveConnectionState(
  rows: readonly Connection[] | null | undefined,
  publicId: string | null | undefined,
): AuthorConnectionState {
  if (!publicId) return 'none';

  for (const row of rows ?? []) {
    if (row.user.public_id !== publicId) continue;
    if (row.status === 'pending') return 'pending';
    if (row.status === 'accepted') return 'connected';
    // Anything else is history: keep scanning, and the fallback below offers
    // Connect again — which is exactly what the server would accept.
  }

  return 'none';
}
