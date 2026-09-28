/**
 * Role routing â€” one source of truth for post-login navigation.
 *
 * `docs/ARCHITECTURE.md` Â§7 keeps the candidate and employer shells separate, and
 * this app implements that as two distinct route trees (`(candidate)` and
 * `(employer)`) rather than one shell with a swapped tab bar. College is a third
 * tree for the same reason: an institution is neither a candidate nor an
 * employer, and a deep link must never cross the boundary. Each role therefore
 * has its own entry path, and every redirect consults the functions here â€” so
 * there is no second place where a role could be sent to the wrong tree.
 *
 * **Onboarding comes before home.** `entryPathForRole` is the one function that
 * decides, so login, signup, boot, and session restore cannot disagree about
 * whether somebody lands in the wizard or their dashboard. The state it takes is
 * the server's (`GET /onboarding/state`); a local flag is never consulted,
 * because a flag that disagrees with the server is how somebody gets stranded on
 * a step they already finished.
 *
 * `admin` is never self-registered (server-side bootstrap only) and has no mobile
 * surface in V1. It resolves to the employer tree, and every privileged call
 * stays server-guarded, so no admin capability is implied by the app.
 */

import type { UserRole } from '@/types/auth';

/** Candidate entry â€” the `(candidate)` group. */
export const CANDIDATE_HOME_ROUTE = '/home' as const;

/** Employer entry â€” the `(employer)` group. */
export const EMPLOYER_HOME_ROUTE = '/employer/home' as const;

/** College entry â€” the `(college)` group. */
export const COLLEGE_HOME_ROUTE = '/college/home' as const;

/** The guided onboarding host. Outside every role tree, so no guard can loop it. */
export const ONBOARDING_ROUTE = '/onboarding' as const;

/** The finish screen, shown once with the public ID and a copy button. */
export const ONBOARDING_COMPLETE_ROUTE = '/onboarding-complete' as const;


export function homePathForRole(role: UserRole | string): string {
  if (role === 'candidate') return CANDIDATE_HOME_ROUTE;
  if (role === 'college') return COLLEGE_HOME_ROUTE;
  return EMPLOYER_HOME_ROUTE;
}

/**
 * Where a signed-in person should land.
 *
 * The server's onboarding state is the only input. A person whose required steps
 * are outstanding goes to the wizard at the step they stopped at; a person who is
 * finished goes straight to their own dashboard. Nothing is inferred from a local
 * flag.
 *
 * **A missing answer is treated as "not finished", not as "finished".** This is
 * the whole safety property, and it is easy to get backwards: the earlier version
 * read `onboarding && state !== 'completed'`, so a null or unknown state fell
 * straight through to `homePathForRole` — meaning a failed state call, a
 * half-loaded response, or a caller that simply forgot to pass one all sent
 * somebody to a dashboard. Only the explicit string `'completed'` unlocks home.
 * The cost of being wrong in this direction is a person seeing the first step
 * again; the cost in the other direction is the bypass this rule exists to stop.
 *
 * `admin` is exempt because it is never self-registered and has no onboarding
 * surface, so there is nothing for it to be incomplete about.
 */
export function entryPathForRole(
  role: UserRole | string,
  onboarding?: { state?: string } | null,
): string {
  if (role === 'admin') return homePathForRole(role);
  if (onboarding?.state === 'completed') return homePathForRole(role);
  return ONBOARDING_ROUTE;
}

/** True when the principal belongs in the candidate tree. */
export function isCandidateRole(role: UserRole): boolean {
  return role === 'candidate';
}

/**
 * True when the principal belongs in the employer tree.
 *
 * Strictly the employer role, and deliberately **not** "any non-candidate". A
 * college is also a non-candidate, so the loose version let an employer's guard
 * (`allow: 'employer'`, which matches every non-candidate) accept a college and
 * render an employer shell for it. Both this predicate and the guard's own check
 * have to agree that college is a third thing.
 */
export function isEmployerRole(role: UserRole): boolean {
  return role === 'employer';
}

/** True when the principal belongs in the college tree. */
export function isCollegeRole(role: UserRole): boolean {
  return role === 'college';
}

/**
 * True when `path` belongs in the tree this role is allowed to see.
 *
 * Used by the role guard to bounce a deep link that crosses a boundary (a college
 * account opening `/employer/company` from a stale link, say) back to their own
 * home, instead of rendering a screen whose data the server would refuse anyway.
 *
 * Each role owns a namespaced prefix, so the check is a prefix test rather than a
 * growing list of exceptions. A non-candidate role may still open the unprefixed
 * candidate screens in V1; every private read there is refused by the server's own
 * role gate, so this guard is about navigation, not access control.
 */
export function isRouteAllowedForRole(path: string, role: UserRole | string): boolean {
  if (role === 'candidate') {
    return !path.startsWith('/employer') && !path.startsWith('/college');
  }
  if (role === 'college') return !path.startsWith('/employer');
  if (role === 'employer') return !path.startsWith('/college');
  return true;
}
