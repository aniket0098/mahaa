/**
 * Regression tests for the onboarding half of the role guard.
 *
 * The bug these lock down was a *timing* bug, so the loading cases are the
 * important ones: `data === undefined` is the normal state of the world on the
 * first render of a cold load, and treating it as "not finished" bounced every
 * completed candidate out of every authenticated route on refresh.
 */

import { describe, expect, it } from 'vitest';

import { resolveOnboardingVerdict } from '@/auth/roleGuardLogic';

const CHECK = { enabled: true, isLoading: false, isError: false, state: undefined } as const;

describe('resolveOnboardingVerdict', () => {
  it('waits instead of redirecting while the onboarding query is loading', () => {
    // The regression. Before the fix this returned 'needs-onboarding' because
    // `state` was undefined, and the layout committed a redirect to /onboarding.
    expect(resolveOnboardingVerdict({ ...CHECK, isLoading: true })).toBe('loading');
    expect(resolveOnboardingVerdict({ ...CHECK, isLoading: true, state: undefined })).toBe('loading');
  });

  it('stays loading even on a slow response that has not answered yet', () => {
    expect(resolveOnboardingVerdict({ ...CHECK, isLoading: true, state: null })).toBe('loading');
  });

  it('allows the requested route once the server says the wizard is finished', () => {
    expect(resolveOnboardingVerdict({ ...CHECK, state: 'completed' })).toBe('completed');
  });

  it('sends an unfinished candidate to onboarding', () => {
    expect(resolveOnboardingVerdict({ ...CHECK, state: 'in_progress' })).toBe('needs-onboarding');
    expect(resolveOnboardingVerdict({ ...CHECK, state: 'not_started' })).toBe('needs-onboarding');
  });

  it('never decides from an absent answer once loading has finished', () => {
    // A settled query with no `state` is a contract violation, not a pass. It
    // must not read as completed, or a malformed payload would unlock the tree.
    expect(resolveOnboardingVerdict({ ...CHECK, state: undefined })).toBe('needs-onboarding');
    expect(resolveOnboardingVerdict({ ...CHECK, state: null })).toBe('needs-onboarding');
    expect(
      resolveOnboardingVerdict({ ...CHECK, state: 'completed' as never }),
    ).toBe('completed');
  });

  it('keeps the existing policy that a failed read is not a finished wizard', () => {
    // Unchanged behaviour, asserted so the fix cannot quietly relax it: an error
    // means "ask again in the wizard", never "let them into the dashboard".
    expect(resolveOnboardingVerdict({ ...CHECK, isError: true })).toBe('needs-onboarding');
    expect(resolveOnboardingVerdict({ ...CHECK, isError: true, state: undefined })).toBe(
      'needs-onboarding',
    );
  });

  it('does not ask the server when no check applies', () => {
    // Signed out, or admin — who has no onboarding surface at all. `isPending`
    // is true forever on a disabled query, so `enabled` has to win first or a
    // signed-out render would hang in `loading` rather than reaching /login.
    expect(
      resolveOnboardingVerdict({ ...CHECK, enabled: false, isLoading: true, state: undefined }),
    ).toBe('skipped');
    expect(resolveOnboardingVerdict({ ...CHECK, enabled: false, state: 'in_progress' })).toBe(
      'skipped',
    );
  });

  it('sends the user back to the wizard when a background refetch fails', () => {
    // Documented, unchanged policy rather than an oversight: the guard trusts
    // the *settled* read, so a failed refetch re-opens the wizard even when a
    // `completed` answer is still in hand. The wizard is where that read is
    // retried, so the outcome is a detour and never a wrong "you are done".
    expect(
      resolveOnboardingVerdict({
        enabled: true,
        isLoading: false,
        isError: true,
        state: 'completed',
      }),
    ).toBe('needs-onboarding');
  });
});