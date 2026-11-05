/**
 * `connectionList` — the pure partition behind the Connections screen.
 *
 * One `GET /connections` call returns every relationship the caller holds in
 * both directions. This module splits that flat list into the three groups the
 * screen renders, and nothing else — no React, no API, so the rules are testable
 * in plain Node.
 *
 * The split is driven entirely by the **server's own fields**:
 *
 *  - `status` decides whether a row is live (`pending`), established
 *    (`accepted`), or history (`declined` / `canceled` / `removed`);
 *  - `is_outgoing` decides which side of a *pending* row the caller is on, and
 *    therefore which action the screen may offer — Cancel for a request the
 *    caller sent, Accept/Decline for one the caller received.
 *
 * History rows are dropped entirely: the server lets a fresh request be sent
 * after any of them, so pinning a resolved request on screen would be a lie
 * about the current state.
 */

import type { Connection } from '@/types/onboarding';

export interface ConnectionLists {
  /** Pending requests the caller **received**: Accept / Decline. */
  incoming: Connection[];
  /** Pending requests the caller **sent**: Cancel / Withdraw. */
  outgoing: Connection[];
  /** Established connections, most recent first. */
  accepted: Connection[];
}

/**
 * Partition the caller's rows. A row is placed only when it is live or
 * established; history is discarded. Rows without a usable `user` are dropped
 * rather than rendered as a broken card.
 */
export function partitionConnections(rows: readonly Connection[] | null | undefined): ConnectionLists {
  const lists: ConnectionLists = { incoming: [], outgoing: [], accepted: [] };

  for (const row of rows ?? []) {
    if (!row || !row.user || !row.user.public_id) continue;

    if (row.status === 'accepted') {
      lists.accepted.push(row);
      continue;
    }
    if (row.status !== 'pending') continue; // history: declined / canceled / removed

    if (row.is_outgoing) lists.outgoing.push(row);
    else lists.incoming.push(row);
  }

  return lists;
}

/** The number of pending requests awaiting the caller's answer (incoming only). */
export function pendingIncomingCount(rows: readonly Connection[] | null | undefined): number {
  return partitionConnections(rows).incoming.length;
}