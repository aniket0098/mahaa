/**
 * Server-decided post-authentication navigation.
 *
 * This lives apart from `roleHome.ts` on purpose: that module is pure data with no
 * imports, which is what lets the routing rules be unit tested in Node. This one
 * needs a `QueryClient` and the network, so it cannot live there without dragging
 * React Query into a pure test.
 *
 * One function, called by every entry point (signup, login, boot, session
 * restore). The bug this replaces was four call sites each deciding for itself:
 * signup navigated straight to the role's home, so a brand-new account skipped
 * onboarding entirely and landed on a dashboard built from an empty profile.
 */

import type { QueryClient } from '@tanstack/react-query';

import { fetchOnboardingState } from '@/api/onboarding';
import { queryKeys } from '@/api/queryKeys';
import { entryPathForRole } from '@/auth/roleHome';

/**
 * Where a freshly signed-in person should land, according to the **server**.
 *
 * The server is asked rather than the client, and a failure is deliberately *not*
 * treated as "finished". Sending somebody to their dashboard because the state
 * call failed would be the original bug in a new form. Instead the wizard opens,
 * and the wizard itself refuses to finish until the server agrees — so the worst
 * case is somebody seeing the first onboarding step again, never a bypass.
 */
export async function resolveEntryPath(queryClient: QueryClient, role: string): Promise<string> {
  try {
    const state = await queryClient.fetchQuery({
      queryKey: queryKeys.onboarding,
      queryFn: fetchOnboardingState,
      // The token was stored moments ago, so a cached answer from before sign-in
      // (a previous account, or none at all) must never be reused.
      staleTime: 0,
    });
    return entryPathForRole(role, state);
  } catch {
    return entryPathForRole(role, { state: 'not_started' });
  }
}