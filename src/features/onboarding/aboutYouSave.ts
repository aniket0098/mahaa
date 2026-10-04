/**
 * The About You save contract — pure, so it is unit testable in Node.
 *
 * Kept out of `AboutYouStep.tsx` for the same reason `skillsBrowse.ts` is kept
 * away from the component: that file imports `react-native`, and a Node test that
 * reached it would pull React Native's Flow sources into the runner.
 *
 * **The bug this models.** The reported failure was: fill in education, add a
 * skill or two, press Continue, and get
 *
 *     That did not save
 *     That did not register as saved. Check the highlighted fields and try again.
 *     Retry
 *
 * …on a request that had returned `201`. The save worked. What had not worked was
 * the *verification*: the server counted `skills >= 3` toward this step's
 * completion while the screen had only ever asked for an institution, so the
 * wizard read a successful write as a failed one and Retry — which replays the
 * identical save — could never clear it.
 *
 * Two rules follow from that, and they are the whole of this module:
 *
 *  1. **Verify what was saved, not a proxy for it.** `verifyStepSave` asks the
 *     server whether *this step* is complete, and returns the reason it is not
 *     so the screen can name it.
 *  2. **A step whose gate the screen cannot satisfy must not be gated.** The
 *     screen is the only thing that can produce the data, so it defines what
 *     "saved" can mean.
 */

/** The server's per-step verdict, mirroring `OnboardingStep`. */
export interface StepVerdict {
  key: string;
  complete: boolean;
  required: boolean;
  hint: string;
}

/** What the server said the person must still do. */
export interface IncompleteStep {
  key: string;
  label: string;
  hint: string;
}

/**
 * The steps that are still outstanding, worst-relevant first.
 *
 * Only *required* incomplete steps are returned: an optional step the person
 * chose to skip is a finished account, not an outstanding one, and treating it
 * as blocking is what turns "Skip for now" into a dead end.
 */
export function outstandingSteps(
  steps: readonly StepVerdict[],
  labels: Readonly<Record<string, string>>,
): IncompleteStep[] {
  return steps
    .filter((step) => step.required && !step.complete)
    .map((step) => ({
      key: step.key,
      label: labels[step.key] ?? step.key,
      hint: step.hint,
    }));
}

/**
 * The message to show when a save returned without error but the server still
 * reports the step as incomplete.
 *
 * **Why this is not a generic string.** The old copy said "That did not register
 * as saved. Check the highlighted fields and try again." — which names no field,
 * points at a form that is already correct, and describes a *save* that in fact
 * succeeded. When the server can tell us which step is outstanding, the message
 * names it; only a genuinely unknown verdict falls back to wording that is at
 * least true.
 */
export function describeIncompleteStep(step: IncompleteStep | undefined): string {
  if (!step) {
    return "Your progress could not be confirmed. Check your connection and try again.";
  }
  if (step.hint) {
    return `${step.label} is not finished yet: ${step.hint}`;
  }
  return `${step.label} is not finished yet. Use the dots above to go back to it.`;
}

/**
 * Whether the wizard may advance past a step after a successful save.
 *
 * `required: false` steps always advance — that is what makes Skip real. A
 * required step advances only when the *server* says it is complete; the client
 * never decides this for itself, and never advances on an unanswered read.
 */
export function mayAdvance(
  steps: readonly StepVerdict[],
  key: string,
  wasRequired: boolean | undefined,
): boolean {
  if (wasRequired === false) return true;
  const step = steps.find((entry) => entry.key === key);
  // A step the server has never heard of is not a pass. Treating an unknown
  // verdict as complete would let a malformed payload skip a real gate.
  return step?.complete ?? false;
}

/**
 * A human sentence for a save that threw, given what kind of failure it was.
 *
 * The three cases are kept apart because they need different things from the
 * reader: a field error is theirs to fix, a network failure is worth retrying
 * verbatim, and an expired session is not fixable by trying again at all.
 */
export type SaveFailureKind = 'field' | 'network' | 'auth' | 'unknown';

export function saveFailureMessage(kind: SaveFailureKind, detail?: string | null): string {
  switch (kind) {
    case 'field':
      // The server's own field message, when there is one. Never replaced with
      // a generic "that did not save" — the whole point of a field error is
      // that it names the field.
      return detail?.trim() || 'Please check the highlighted fields and try again.';
    case 'auth':
      return 'Your session expired. Please sign in again.';
    case 'network':
      return "Couldn't save your changes. Please try again.";
    default:
      return detail?.trim() || "Couldn't save your changes. Please try again.";
  }
}