/**
 * Avatar cache synchronisation — one place that answers "who else shows this
 * face?" after a profile photo is saved, replaced or removed.
 *
 * **Why this module exists.** The photo step used to write the upload response
 * into `queryKeys.me` and invalidate that one key. But a profile photo is *not*
 * only rendered by the account screen: it is on the Profile page, the Home
 * header, every post card this person authored, every connection row, every
 * search result, and their public profile. Each of those is a separately-cached
 * query, so updating one left the rest showing the previous avatar — or, because
 * the upload response was not the shape the cache expected, an object with no
 * avatar field at all.
 *
 * **Why not `queryClient.invalidateQueries()` with no key.** That refetches
 * everything the app has ever asked for, including the feed, jobs and messages
 * that have nothing to do with this person's face. It is not correct, it is not
 * fast, and it is the kind of thing that turns into a request storm.
 *
 * **Why it is a list of prefixes, not a list of queries.** `users` already
 * contains `me`, `userLookup` and `publicProfile`, and `profile` already contains
 * the aggregate plus its six section screens. Invalidating the prefixes covers
 * every variant of each, including ones added later, without this file needing
 * to be updated when a new screen appears.
 */

import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/api/queryKeys';

/**
 * Everything that can render an avatar, as invalidation prefixes.
 *
 * Deliberately not `queryClient.clear()`: that would drop the feed and every
 * other warm cache on a routine photo save, and would make the app re-request
 * the world each time somebody changes a picture.
 */
const AVATAR_PREFIXES = [
  // `me`, `userLookup(<q>)` and `publicProfile(<id>)` all live under this.
  queryKeys.avatarDependent,
  // The profile aggregate — `identity.avatar_url`. Also the Home header, which
  // reads this same query rather than making its own request.
  queryKeys.profile,
  // `author.avatar_url` on every feed card, and the caller's own posts.
  queryKeys.posts,
  // `user.avatar_url` on every connection row. The bare `connections` root,
  // because the status-filtered variants are produced by a function key.
  queryKeys.connectionsRoot,
  // `publisher.logo_url` on every story bubble.
  queryKeys.stories,
  // The wizard's own photo-step completion flag, so leaving the step and coming
  // back cannot show a stale tick or a stale `next_step`.
  queryKeys.onboarding,
] as const;

/**
 * Reconciles every avatar-bearing query after a photo write.
 *
 * **No optimistic write.** `PUT /users/me/photo` answers with the stored media row
 * (§11.2), not the account, so there is no `avatar_url` in the response to write.
 * An earlier version of this file took the upload response and did
 * `setQueryData(queryKeys.me, updated)` — which cached a `MediaRead` (no
 * `avatar_url`) under the account's key and blanked every avatar in the app. The
 * account is therefore simply marked stale and re-read from the server, which is
 * the authority and the only place `avatar_url` exists.
 *
 * Invalidation is by *prefix*, so one call covers `me`, the profile aggregate,
 * every post card, every connection row, every story bubble and this person's
 * public profile — including variants added later.
 */
export function invalidateAfterAvatarChange(queryClient: QueryClient): void {
  for (const prefix of AVATAR_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey: prefix });
  }
}

/**
 * The same reconciliation for a caller with no account object to hand — a
 * sign-out, or a session restore. Nothing is written; everything avatar-shaped is
 * simply re-read.
 */
export function invalidateAllAvatars(queryClient: QueryClient): void {
  for (const prefix of AVATAR_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey: prefix });
  }
}