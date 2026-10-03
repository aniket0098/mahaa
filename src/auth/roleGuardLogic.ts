/**
 * The onboarding half of `useRoleGuard`, as pure data.
 *
 * `RoleGuard.tsx` cannot be unit tested here — it is a hook, and this project's
 * test suite is Node-only by design (see `vitest.config.mts`: no DOM, no
 * native runtime, no component rendering). So the decision that has to be
 * correct lives here instead, next to the other pure routing logic in
 * `roleHome.ts`, and the hook does nothing but read it.
 *
 * **Why this is a module at all.** The guard used to ask a single question —
 * `data?.state === 'completed'` — and treat "the answer has not arrived yet" as
 * a negative answer. On a cold load of any authenticated route that is the very
 * first render, so the guard returned `needs-onboarding` before the request it
 * was waiting on had been sent, the layout rendered a real `<Redirect>`, and the
 * URL committed to `/onboarding`. A candidate who had genuinely finished
 * onboarding was bounced back into the wizard on every refresh and every deep
 * link, while in-app tab navigation (which reads a warm cache) kept working —
 * which is exactly why it survived a walkthrough of the signed-in app.
 *
 * The fix is not "be less strict about `undefined`". It is to stop asking until
 * there is an answer: `loading` is a distinct verdict, and the caller holds a
 * neutral loading state while it applies rather than committing a redirect it
 * may have to take back.
 */

import type { OnboardingState } from '@/types/onboarding';

/**
 * - `skipped`        — no check applies (signed out, or admin, which has no wizard)
 * - `loading`        — the request is in flight; wait, do not decide
 * - `completed`      — the server says the required steps are done; let the route render
 * - `needs-onboarding` — genuinely unfinished, or the read failed; go to the wizard
 */
export type OnboardingVerdict = 'skipped' | 'loading' | 'completed' | 'needs-onboarding';

/**
 * The four facts about the onboarding query that the verdict depends on.
 *
 * Deliberately plain: the hook reads them off the react-query result and passes
 * them in, so this function has no knowledge of react-query (and therefore
 * needs no runtime to test).
 *
 * `isLoading` is "pending *and* fetching" — not `isPending`. A disabled query
 * reports `isPending: true` forever, so reading `isPending` would make a
 * signed-out render look permanently like it was waiting for the server.
 */
export interface OnboardingCheck {
  /** Whether the guard should ask the server at all. */
  enabled: boolean;
  /** A request is in flight and no answer has arrived yet. */
  isLoading: boolean;
  /** The request settled with an error. */
  isError: boolean;
  /** The server's `state`, once it has answered. */
  state: OnboardingState | null | undefined;
}

export function resolveOnboardingVerdict(check: OnboardingCheck): OnboardingVerdict {
  if (!check.enabled) return 'skipped';

  // Asked, still asking. This is the whole fix: no verdict is formed from an
  // absent answer, so nothing is redirected before the server has spoken.
  if (check.isLoading) return 'loading';

  // The pre-existing policy, unchanged: a read that failed is not evidence that
  // the wizard was finished, and guessing "finished" on a network error would
  // hand somebody a dashboard they were never shown the wizard for. The wizard
  // is the recoverable place to land, and it retries the read.
  if (check.isError) return 'needs-onboarding';

  // The server has answered. Only its own verdict counts — the app never
  // computes completion from cached profile data.
  return check.state === 'completed' ? 'completed' : 'needs-onboarding';
}