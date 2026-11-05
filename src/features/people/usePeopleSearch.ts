/**
 * `usePeopleSearch` — the real, debounced people lookup behind Home's search.
 *
 * One rule governs the whole module: **every result comes from the server**.
 * There is no local suggestion array, no invented user, and no hard-coded list.
 * The query is `GET /users/lookup` (see `api/users.ts`), which searches by
 * display name and by public username and respects each account's
 * discoverability setting server-side.
 *
 * Two things this hook does that a naive `useQuery` would not:
 *
 *  - **Debounce.** Keystrokes are debounced in state, so the request is made
 *    once the reader pauses rather than once per character.
 *  - **Stale-response safety.** React Query keys each distinct term under
 *    `queryKeys.userLookup(term)`, so an older term's data lives under the older
 *    key and can never overwrite the term currently on screen. The hook only
 *    ever reads the cache for the *debounced* term, so the rendered rows always
 *    match the query the reader is looking at.
 *
 * Blank input makes no request, and the caller is dropped from the results by
 * {@link excludeSelf} so a person can never see — or connect to — themself.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { lookupUsers } from '@/api/users';
import { queryKeys } from '@/api/queryKeys';
import { excludeSelf } from '@/features/people/peopleSearch';
import type { UserSummary } from '@/types/onboarding';

/** Minimum term before the real lookup request is made (mirrors the skill search). */
export const PEOPLE_MIN_QUERY_LENGTH = 2;

/** How long the reader must pause before the request fires. */
export const PEOPLE_SEARCH_DEBOUNCE_MS = 300;

export interface PeopleSearchResult {
  /** The sanitized, self-excluded rows for the current debounced term. */
  people: UserSummary[];
  /** True while the reader is still typing toward the minimum length. */
  isDebouncing: boolean;
  isPending: boolean;
  isError: boolean;
  /** The server's message for a failed lookup, else null. */
  error: string | null;
  /** True when the current term produced zero usable people. */
  isEmpty: boolean;
  refetch: () => void;
}

export function usePeopleSearch(
  query: string,
  selfPublicId: string | null | undefined,
): PeopleSearchResult {
  // Debounced mirror of the raw input. The raw value keeps driving the field;
  // this is what actually reaches the network. It is only ever written from the
  // timeout callback — never synchronously in the effect body — and the
  // "below threshold" case is derived during render instead (see `activeTerm`).
  const [debounced, setDebounced] = useState('');
  const trimmed = query.trim();
  const isLongEnough = trimmed.length >= PEOPLE_MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!isLongEnough) return;
    const handle = setTimeout(() => setDebounced(trimmed), PEOPLE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trimmed, isLongEnough]);

  // The term the network is allowed to answer for. Dropping below the minimum
  // clears it immediately (during render), so an in-flight answer for a longer
  // previous term can never linger as "the" result and no request is fired.
  const activeTerm = isLongEnough ? debounced : '';
  const enabled = activeTerm.length >= PEOPLE_MIN_QUERY_LENGTH;

  const lookup = useQuery({
    queryKey: queryKeys.userLookup(activeTerm),
    queryFn: () => lookupUsers(activeTerm),
    enabled,
    // Keep a no-result term briefly so re-typing the same thing is instant but
    // stale rows never linger under a different term.
    staleTime: 30_000,
  });

  // Only ever read the cache for the active term, so the rows shown always
  // belong to the query the reader is looking at.
  const people = useMemo(
    () => excludeSelf(lookup.data, selfPublicId),
    [lookup.data, selfPublicId],
  );

  const isDebouncing = isLongEnough && activeTerm !== trimmed;

  return {
    people,
    isDebouncing,
    isPending: enabled && lookup.isPending,
    isError: lookup.isError,
    error: lookup.error ? "Couldn't search people. Check your connection and try again." : null,
    isEmpty: enabled && !lookup.isPending && !lookup.isError && people.length === 0,
    refetch: () => void lookup.refetch(),
  };
}