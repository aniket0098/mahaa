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
 */

import { Redirect, usePathname } from 'expo-router';

import { useAuth } from '@/auth/AuthContext';
import { homePathForRole, isRouteAllowedForRole } from '@/auth/roleHome';
import type { UserRole } from '@/types/auth';

export interface GuardOptions {
  /** The role allowed to render this tree. `admin` is treated as an employer. */
  allow: Exclude<UserRole, 'admin'>;
}

export function useRoleGuard({ allow }: GuardOptions) {
  const { status, principal } = useAuth();
  const pathname = usePathname();

  if (status === 'loading') return { kind: 'loading' as const };
  if (status !== 'authenticated' || !principal) {
    return { kind: 'unauthenticated' as const, redirect: '/login' as const };
  }

  const role = (principal.role ?? 'candidate') as UserRole;
  const isAllowedRole = allow === 'candidate' ? role === 'candidate' : role !== 'candidate';

  if (!isAllowedRole || !isRouteAllowedForRole(pathname, role)) {
    return { kind: 'wrong-role' as const, redirect: homePathForRole(role) as never };
  }

  return { kind: 'ready' as const, role, principal };
}

/**
 * Convenience wrapper for a screen that must never render without a principal.
 * Returns `null` while the guard is deciding, so a screen body never has to
 * handle the unauthenticated case itself.
 */
export function RequireRole({
  allow,
  children,
}: {
  allow: Exclude<UserRole, 'admin'>;
  children: React.ReactNode;
}) {
  const guard = useRoleGuard({ allow });
  if (guard.kind === 'unauthenticated') return <Redirect href={guard.redirect} />;
  if (guard.kind === 'wrong-role') return <Redirect href={guard.redirect} />;
  if (guard.kind === 'loading') return null;
  return <>{children}</>;
}