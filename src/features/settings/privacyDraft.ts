/**
 * Privacy draft seeding for the candidate settings screen.
 *
 * `PUT /profile/privacy` takes the **complete** privacy state, never a patch,
 * so the form is seeded from the server response and submits all of it. That
 * makes "which server value is the draft built from" real logic worth stating
 * explicitly — and worth testing without mounting a component, which this repo
 * deliberately does not do (no React testing library; the suites are pure-logic
 * by convention).
 *
 * The screen used to re-seed inside a `useEffect`, which meant the draft was
 * painted once with the previous value and then corrected on a second render,
 * and which the React lint rules reject as a cascading render. The rule is right:
 * this is dependent state, not synchronisation with an external system, so it
 * belongs in the render body guarded by a "has the source changed?" check. See
 * `CandidateSettingsScreen` for the application.
 */

import type { PrivacyRead, PrivacyUpdate } from '@/types/profile';

/**
 * Build the writable draft from a server read.
 *
 * `updated_at` is deliberately dropped: the write model sets `extra="forbid"`,
 * so handing the read straight back is a 422. This is the only place that
 * translation happens.
 */
export function draftFromPrivacy(privacy: PrivacyRead): PrivacyUpdate {
  return {
    profile_visibility: privacy.profile_visibility,
    discoverable: privacy.discoverable,
    allow_messages: privacy.allow_messages,
    show_email: privacy.show_email,
    show_phone: privacy.show_phone,
  };
}

/**
 * Whether the draft must be re-seeded for this server value.
 *
 * A type predicate rather than a plain boolean, so the caller inside
 * `if (shouldReseedDraft(...))` is narrowed to a resolved `PrivacyRead` without
 * a cast or a redundant truthiness check.
 *
 * Identity, not deep equality: react-query hands back a fresh object on every
 * successful fetch, so an invalidated-and-refetched privacy query is treated as
 * a new source of truth (and the form resettles to the saved state, which is
 * what the user expects straight after pressing Save). Two renders carrying the
 * *same* object do not re-seed, so ordinary re-renders never discard edits.
 *
 * `undefined` (query not resolved yet) and the first value both count as a
 * change, which is what lets the initial seed happen.
 */
export function shouldReseedDraft(
  previousSource: PrivacyRead | undefined,
  currentSource: PrivacyRead | undefined,
): currentSource is PrivacyRead {
  return currentSource !== undefined && currentSource !== previousSource;
}
