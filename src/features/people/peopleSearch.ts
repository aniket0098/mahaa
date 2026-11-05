/**
 * People search — the pure rules behind Home's people lookup and the Connect
 * affordance shared by the search suggestions and a person's public profile.
 *
 * Pure data in, decisions out: no React, no React Query, no API import, so every
 * rule here is testable in plain Node (`peopleSearch.test.ts`).
 *
 * Two domain ideas are kept strictly apart and must never be blurred:
 *
 *  - A **connection** (main backend `/connections`): a professional link between
 *    two people. It is the *only* thing this module reasons about.
 *  - A **message request** (`message-docker-service`): permission to start a
 *    conversation. It has its own routes, its own service and its own table, and
 *    accepting or rejecting one has nothing to do with a connection row.
 *
 * Every state below is the *caller's* relationship to one other person, derived
 * from the caller's own connection rows and the signed-in public id — never from
 * a value the client invented. This mirrors {@link deriveConnectionState}, but
 * keeps the *direction* of a pending request, which the feed card deliberately
 * ignores and a profile must not.
 */

import type { Connection, UserSummary } from '@/types/onboarding';

/** The caller's relationship to one person, read off the caller's rows. */
export type PersonConnectionState =
  | 'none'
  | 'outgoing_pending'
  | 'incoming_pending'
  | 'rejected'
  | 'cancelled'
  | 'connected';

/** What a tap on the action should do. `none` means the control is informational. */
export type PersonActionKind = 'send' | 'cancel' | 'respond' | 'none';

export interface PersonAction {
  state: PersonConnectionState;
  /** The button label the caller should read for this state. */
  label: string;
  kind: PersonActionKind;
  /** True when a tap fires a request; false when the control only reports state. */
  enabled: boolean;
}

/**
 * True when `publicId` is the signed-in caller. Compared by immutable public id,
 * because that is the only identifier both sites agree on and the one that is
 * safe to display and route by.
 */
export function isSelf(
  publicId: string | null | undefined,
  selfPublicId: string | null | undefined,
): boolean {
  return Boolean(publicId && selfPublicId && publicId === selfPublicId);
}

/**
 * Drop anything that is not a usable person.
 *
 * The lookup contract is the server's and can change; a row missing either id or
 * a name is a record the app cannot route to or render, so it is dropped rather
 * than passed through to become a broken card or a dead Connect button.
 */
export function sanitizeLookupResults(
  results: readonly UserSummary[] | null | undefined,
): UserSummary[] {
  if (!results) return [];
  return results.filter(
    (row): row is UserSummary =>
      Boolean(row) &&
      typeof row.public_id === 'string' &&
      row.public_id.length > 0 &&
      typeof row.user_id === 'string' &&
      row.user_id.length > 0 &&
      typeof row.name === 'string' &&
      row.name.trim().length > 0,
  );
}

/**
 * The caller's own search suggestions: sanitized, and with the caller removed.
 *
 * A person may not connect to themself, so the caller is filtered out before the
 * list is built — the UI never has to remember to hide a row, and there is no
 * self-Connect button to disable after the fact.
 */
export function excludeSelf(
  results: readonly UserSummary[] | null | undefined,
  selfPublicId: string | null | undefined,
): UserSummary[] {
  return sanitizeLookupResults(results).filter((row) => !isSelf(row.public_id, selfPublicId));
}

/**
 * The caller's relationship to `publicId`, from the caller's connection rows.
 *
 * `rows` is the bare `GET /connections` list (both directions, any status); rows
 * for other people are skipped. A `pending` row keeps its direction so a profile
 * can offer Cancel (caller asked) or Respond (someone else asked).
 *
 * `declined`, `canceled` and `removed` are all closed states: the server will
 * accept a fresh request after any of them, but none of them leaves a live
 * request to act on, so the scan skips them and falls through to `none`. A
 * relationship someone walked away from (`removed`) is history with no verdict
 * at all.
 *
 * A live row always outranks a closed one for the same person, whichever order
 * the server sent them in: an accepted row beats a remembered decline, and a
 * pending row beats both. Only when nothing live matches does the scan return
 * `none`.
 */
export function derivePersonConnectionState(
  rows: readonly Connection[] | null | undefined,
  publicId: string | null | undefined,
): PersonConnectionState {
  if (!publicId) return 'none';

  for (const row of rows ?? []) {
    if (!row || !row.user || row.user.public_id !== publicId) continue;
    if (row.status === 'pending') {
      return row.is_outgoing ? 'outgoing_pending' : 'incoming_pending';
    }
    if (row.status === 'accepted') return 'connected';
    // `declined`, `canceled` and `removed` are closed with no live request:
    // skip them and keep scanning for a live row.
  }

  return 'none';
}

/** The action for a known state, honouring that you cannot act on your own profile. */
export function personAction(state: PersonConnectionState, isSelfProfile: boolean): PersonAction {
  if (isSelfProfile) {
    return { state, label: 'This is you', kind: 'none', enabled: false };
  }
  switch (state) {
    case 'none':
      return { state, label: 'Connect', kind: 'send', enabled: true };
    case 'outgoing_pending':
      return { state, label: 'Requested', kind: 'cancel', enabled: true };
    case 'incoming_pending':
      return { state, label: 'Respond', kind: 'respond', enabled: true };
    case 'rejected':
      return { state, label: 'Request Rejected', kind: 'send', enabled: true };
    case 'cancelled':
      return { state, label: 'Request Cancelled', kind: 'send', enabled: true };
    case 'connected':
      return { state, label: 'Connected', kind: 'none', enabled: false };
  }
}

/** Convenience: rows + public id straight to the action, for screens and cards alike. */
export function personActionFor(
  rows: readonly Connection[] | null | undefined,
  publicId: string | null | undefined,
  isSelfProfile: boolean,
): PersonAction {
  return personAction(derivePersonConnectionState(rows, publicId), isSelfProfile);
}
