/**
 * The wiring behind Home's people suggestions.
 *
 * `peopleSearch.test.ts` proves the pure sanitize/exclude rules; the API
 * binding is pinned in `src/api/users.test.ts`. This file pins the *connections*
 * between them — the debounce, the per-term cache keying that makes a stale
 * response unable to replace the current term's rows, the "error is not empty"
 * rule, and the tap → `/user/[id]` navigation. Each has produced (or could
 * produce) a device-only failure no pure-function test can see, so they are
 * asserted at the source level the way `storyViewerWiring.test.ts` pins the
 * story viewer.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

// `usePeopleSearch` imports the api client, which loads expo-secure-store and
// expo-device at module scope. They cannot load in Node; the constants under
// test are pure, so the native edges are replaced exactly as the api tests do.
vi.mock('@/auth/tokenStorage', () => ({
  tokenStorage: {
    get: async () => null,
    set: async () => undefined,
    clear: async () => undefined,
  },
}));

vi.mock('@/lib/env', () => ({
  env: {
    apiBaseUrl: 'http://api.test/api/v1',
    needsDeviceConfiguration: false,
  },
}));

// The `vi.mock` calls above must precede these imports: vitest hoists them, and
// the module under test reads the mocked edges at import time.
/* eslint-disable import/first -- vi.mock must precede the imports it replaces. */
import { queryKeys } from '@/api/queryKeys';
import {
  PEOPLE_MIN_QUERY_LENGTH,
  PEOPLE_SEARCH_DEBOUNCE_MS,
} from '@/features/people/usePeopleSearch';
/* eslint-enable import/first */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('stale responses cannot replace the current term', () => {
  it('each distinct term is cached under its own key, so answers cannot cross terms', () => {
    // React Query keys the request by the debounced term; an older term's data
    // lives under the older key forever and is never read for the newer term.
    const a = queryKeys.userLookup('aniket');
    const b = queryKeys.userLookup('aniketa');
    expect(a).not.toEqual(b);
    expect(queryKeys.userLookup('aniket')).toEqual(a);
  });

  it('the hook only ever reads the cache for the debounced term, never the raw input', () => {
    const hook = read('usePeopleSearch.ts');
    expect(hook).toContain('queryKey: queryKeys.userLookup(activeTerm)');
    expect(hook).toContain('queryFn: () => lookupUsers(activeTerm)');
    // The raw value drives the field; only the debounced value reaches the network.
    expect(hook).toContain('const activeTerm = isLongEnough ? debounced : \'\'');
  });

  it('debounces keystrokes and refuses to request below the minimum length', () => {
    const hook = read('usePeopleSearch.ts');
    expect(hook).toContain('setTimeout(() => setDebounced(trimmed), PEOPLE_SEARCH_DEBOUNCE_MS)');
    expect(PEOPLE_SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(200);
    expect(PEOPLE_MIN_QUERY_LENGTH).toBeGreaterThanOrEqual(2);
    // Dropping below the minimum disables the query instead of searching for it.
    expect(hook).toContain('const enabled = activeTerm.length >= PEOPLE_MIN_QUERY_LENGTH');
  });
});

describe('loading, empty and error stay distinct', () => {
  it('an empty state is only reachable when the request succeeded and returned nothing', () => {
    const hook = read('usePeopleSearch.ts');
    // If isError were not excluded, a failed request would render "No people
    // match" and hide the outage behind a plausible empty state.
    expect(hook).toContain(
      'isEmpty: enabled && !lookup.isPending && !lookup.isError && people.length === 0',
    );
  });

  it('the header renders a retryable error banner and a separate empty message', () => {
    const header = read('../home/DashboardHeader.tsx');
    expect(header).toContain('{people.isError ? (');
    expect(header).toContain('onPress={people.refetch}');
    expect(header).toContain('{people.isEmpty ? (');
    expect(header).toContain('No people match');
    // The loading line is shown while debouncing or pending — never both states at once.
    expect(header).toContain('{people.isDebouncing || people.isPending ? (');
  });

  it('the caller is excluded from their own results before rendering', () => {
    const header = read('../home/DashboardHeader.tsx');
    expect(header).toContain("usePeopleSearch(isSearchOpen ? query : '', principal.public_id)");
    const hook = read('usePeopleSearch.ts');
    expect(hook).toContain('excludeSelf(lookup.data, selfPublicId)');
  });
});

describe('tapping a suggestion opens the real profile', () => {
  it('each row navigates to /user/[id] keyed by the immutable public id', () => {
    const results = read('PeopleSearchResults.tsx');
    expect(results).toContain('router.push(`/user/${encodeURIComponent(person.public_id)}`');
    // The row renders exactly the lookup's identity fields — no invented ones.
    expect(results).toContain('{person.name}');
    expect(results).toContain('{`@${person.username}`}');
  });

  it('the public profile route exists and is declared for candidates', () => {
    const nav = read('../../config/navConfig.ts');
    expect(nav).toContain("path: '/user/[id]'");
    const route = read('../../app/(candidate)/user/[id].tsx');
    expect(route).toContain('useLocalSearchParams');
  });
});
