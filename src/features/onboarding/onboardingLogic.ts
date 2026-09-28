/**
 * Onboarding step resolution ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â pure logic, no React, no network, no storage.
 *
 * Authority model: the wizard's position comes **only** from the server's
 * `GET /onboarding/state`. Nothing here decides a step from a local flag, a
 * stored draft, or a guess about what the user has filled in ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â it takes the
 * server's answer and works out where to render. That is what makes a relaunch, a
 * deep link, and a profile edited from another screen all land on the same step,
 * because they are all reading the same derived truth.
 */

import type { StepMeta } from '@/features/onboarding/onboardingSteps';
import { firstStepIndex } from '@/features/onboarding/onboardingSteps';
import type { OnboardingStateRead, OnboardingStep } from '@/types/onboarding';

export function isLastStep(index: number, total: number): boolean {
  return index >= total - 1;
}

/**
 * Clamp a requested step into the range the wizard actually has.
 *
 * A hand-typed `?step=7` must not be able to render past the end, and a stale
 * index from a previous session must not strand somebody on a screen the server
 * already considers finished. Both ends are clamped.
 */
export function clampStep(requested: number, steps: readonly StepMeta[]): number {
  if (steps.length === 0) return 0;
  if (!Number.isFinite(requested)) return firstStepIndex(steps);
  const index = Math.floor(requested);
  if (index < 0) return 0;
  if (index >= steps.length) return steps.length - 1;
  return index;
}

/**
 * The step to open, given what the server said.
 *
 * `next_step` wins when the server names one, because that is the step the stored
 * data says is outstanding. A requested step (from a Back press or a tappable
 * completed step) is honoured but clamped, so a person can revisit what they have
 * already done without being able to jump ahead of a requirement. When the flow is
 * complete the last step ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Review ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â is where they land.
 */
export function resolveStep(
  state: OnboardingStateRead | null | undefined,
  steps: readonly StepMeta[],
  requested?: number,
): number {
  if (steps.length === 0) return 0;
  if (requested !== undefined) return clampStep(requested, steps);
  if (!state) return 0;
  if (state.state === 'completed') return steps.length - 1;
  const nextIndex = steps.findIndex((step) => step.key === state.next_step);
  return nextIndex >= 0 ? nextIndex : firstStepIndex(steps);
}

/**
 * Progress for the header bar, 0-100.
 *
 * Derived from the step index rather than from a completion percentage, because
 * the bar answers "how far through the wizard am I" while the profile percentage
 * answers "how complete is my profile" ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â two different questions with two
 * different honest answers.
 *
 * The result is **clamped to 0-100**. Without that, an out-of-range index produces
 * a nonsense width: `stepProgress(99, 5)` is 2475%, and `width: '2475%'` is invalid
 * CSS that renders as a broken bar on web and an over-wide one natively. The
 * index is clamped on the way in by `resolveStep`, but this function is also
 * called directly by the header, so it has to be safe on its own.
 */
export function stepProgress(index: number, total: number): number {
  if (total <= 1) return 100;
  const ratio = (index / (total - 1)) * 100;
  return Math.min(100, Math.max(0, Math.round(ratio)));
}

/** True when every required step the server reports is complete. */
export function allRequiredComplete(state: OnboardingStateRead | null | undefined): boolean {
  if (!state) return false;
  return state.steps.filter((step) => step.required).every((step) => step.complete);
}

/**
 * The server's verdict on one step, paired with the screen that renders it.
 *
 * The flag comes from the server, so a step's check mark can never be painted on
 * before the data behind it exists - which is the whole point of not computing
 * this on the client.
 */
export function stepStatus(
  state: OnboardingStateRead | null | undefined,
  key: string,
): { complete: boolean; hint: string } {
  const match: OnboardingStep | undefined = state?.steps.find((step) => step.key === key);
  return { complete: match?.complete ?? false, hint: match?.hint ?? '' };
}
