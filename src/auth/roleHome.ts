/**
 * Role routing — one source of truth for post-login navigation.
 *
 * `docs/ARCHITECTURE.md` §7 keeps the candidate and employer shells separate, and
 * this app implements that as two distinct route trees (`(candidate)` and
 * `(employer)`) rather than one shell with a swapped tab bar. Each role therefore
 * has its own entry path, and `homePathForRole` is what every redirect consults
 * — login, signup, boot, and the role guard all resolve through this one
 * function, so there is no second place where a role could be sent to the wrong
 * tree.
 *
 * `admin` is never self-registered (server-side bootstrap only) and has no
 * mobile surface in V1. It resolves to the employer tree, and every privileged
 * call stays server-guarded, so no admin capability is implied by the app.
 */

import type { UserRole } from '@/types/auth';

/** Candidate entry — the `(candidate)` group. */
export const CANDIDATE_HOME_ROUTE = '/home' as const;

/** Employer entry — the `(employer)` group. */
export const EMPLOYER_HOME_ROUTE = '/employer/home' as const;

export function homePathForRole(role: UserRole | string): string {
  return role === 'candidate' ? CANDIDATE_HOME_ROUTE : EMPLOYER_HOME_ROUTE;
}

/** True when the principal belongs in the candidate tree. */
export function isCandidateRole(role: UserRole): boolean {
  return role === 'candidate';
}

/** True when the principal belongs in the employer tree. */
export function isEmployerRole(role: UserRole): boolean {
  return role === 'employer';
}

/**
 * True when `path` belongs to the tree this role is allowed to see.
 *
 * Used by the role guard to bounce a deep link that crosses the boundary (e.g. a
 * candidate opening `/employer/company` from a stale link or a push
 * notification) back to their own home, instead of rendering a screen whose data
 * the server would reject anyway.
 *
 * The role is accepted as a plain `string` because that is what `Principal.role`
 * is: the server sends a string, and pretending otherwise would only move the
 * cast to a call site. Only `candidate` is treated as the candidate tree;
 * anything else — including `admin` and any future role — resolves to the
 * employer tree, where every privileged call stays server-guarded.
 */
export function isRouteAllowedForRole(path: string, role: UserRole | string): boolean {
  if (role === 'candidate') return !path.startsWith('/employer');
  return true;
}
