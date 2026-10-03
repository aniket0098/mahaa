/**
 * Auth + role guard for the authenticated route trees.
 *
 * The session states are resolved in one place so `(candidate)/_layout.tsx` and
 * `(employer)/_layout.tsx` cannot drift apart:
 *
 *   loading          -> render nothing and let the caller redirect to `/boot`,
 *                       so protected content never flashes and no redirect is
 *                       guessed before the server has answered;
 *   unauthenticated  -> `/login`;
 *   wrong role       -> the signed-in user's own home, so a deep link that
 *                       crosses the role boundary bounces instead of rendering a
 *                       screen the server would reject anyway.
 *
 * **Onboarding is a fourth state, and the reason this guard exists in its current
 * form.** A signed-in user with required steps outstanding is sent to `/onboarding`
 * whatever route they asked for. Without that, the "cannot open home before
 * onboarding is finished" rule would only hold for people who arrived through
 * login or signup Ã¢â‚¬â€ a hand-typed `/home`, a stale deep link, or a browser Back
 * straight into the dashboard would all still work, which is a bypass with a
 * front door. The answer comes from the server, so the guard and the entry points
 * can never disagree about who is finished.
 *
 * The admin exemption is deliberate: admin is never self-registered and has no
 * onboarding surface, so there is nothing for it to be incomplete about.
 */

import { Redirect, usePathname } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { fetchOnboardingState } from '@/api/onboarding';
import { queryKeys } from '@/api/queryKeys';
import { useAuth } from '@/auth/AuthContext';
import { resolveOnboardingVerdict } from '@/auth/roleGuardLogic';
import { homePathForRole, isRouteAllowedForRole, ONBOARDING_ROUTE } from '@/auth/roleHome';
import type { UserRole } from '@/types/auth';

export interface GuardOptions {
  /** The role allowed to render this tree. `admin` is treated as an employer. */
  allow: Exclude<UserRole, 'admin'>;
}

type GuardResult =
  | { kind: 'loading' }
  | { kind: 'unauthenticated'; redirect: string }
  | { kind: 'wrong-role'; redirect: string }
  | { kind: 'needs-onboarding'; redirect: string }
  | { kind: 'ready'; role: UserRole; principal: NonNullable<ReturnType<typeof useAuth>['principal']> };

export function useRoleGuard({ allow }: GuardOptions): GuardResult {
  const { status, principal } = useAuth();
  const pathname = usePathname();

  const role = (principal?.role ?? 'candidate') as UserRole;
  // `admin` has no onboarding flow, so it is never held at the wizard.
  const needsCheck = status === 'authenticated' && Boolean(principal) && role !== 'admin';

  const state = useQuery({
    queryKey: queryKeys.onboarding,
    queryFn: fetchOnboardingState,
    enabled: needsCheck,
    // A cached answer from before sign-in belongs to a different account, so the
    // guard always asks the server rather than trusting whatever is in memory.
    staleTime: 0,
  });

  /**
   * The verdict is resolved by a pure function (`roleGuardLogic.ts`) rather than
   * inline, because the decision that has to be right - *wait for the answer
   * instead of redirecting because there is not one yet* - is exactly the part a
   * walkthrough of the running app cannot catch. In-app navigation reads a warm
   * cache and behaves perfectly, so only a cold load exposes it.
   */
  const verdict = resolveOnboardingVerdict({
    enabled: needsCheck,
    isLoading: state.isLoading,
    isError: state.isError,
    state: state.data?.state,
  });

  if (status === 'loading') return { kind: 'loading' };
  if (status !== 'authenticated' || !principal) {
    return { kind: 'unauthenticated', redirect: '/login' };
  }

  const isAllowedRole =
    allow === 'candidate' ? role === 'candidate' : allow === 'college' ? role === 'college' : role === 'employer';
  if (!isAllowedRole || !isRouteAllowedForRole(pathname, role)) {
    return { kind: 'wrong-role', redirect: homePathForRole(role) };
  }

  /*
   * Asked, still asking: hold the same neutral loading state the auth check
   * already uses rather than committing a redirect the server has not earned.
   * The role layouts render `null` for `loading`, so this introduces no new
   * spinner and no flash of the wrong screen - it only stops the premature
   * navigation that sent a finished candidate back to the wizard on reload.
   *
   * It sits *after* the role checks on purpose: a candidate deep-linking into
   * `/employer/*` is still bounced immediately, without waiting on a wizard
   * question that has nothing to do with the role boundary.
   */
  if (verdict === 'loading') return { kind: 'loading' };

  if (verdict === 'needs-onboarding') {
    return { kind: 'needs-onboarding', redirect: ONBOARDING_ROUTE };
  }

  return { kind: 'ready', role, principal };
}

/**
 * Convenience wrapper for a screen that must never render without a principal.
 * Returns `null` while the guard is deciding, so a screen body never has to
 * handle the unauthenticated case itself.
 *
 * `needs-onboarding` redirects to the wizard. That is the guarantee behind "you
 * cannot open home before onboarding is finished": it does not matter which route
 * inside the tree was requested, because every one of them is behind this wrapper.
 */
export function RequireRole({
  allow,
  children,
}: {
  allow: Exclude<UserRole, 'admin'>;
  children: React.ReactNode;
}) {
  const guard = useRoleGuard({ allow });
  if (guard.kind === 'loading') return null;
  if (guard.kind !== 'ready') return <Redirect href={guard.redirect as never} />;
  return <>{children}</>;
}
