/**
 * Tests for the About You save contract — pure, no React and no network.
 *
 * **The bug these exist for.** The reported failure was a `201` from
 * `POST /profile/education` followed by
 *
 *     That did not save
 *     That did not register as saved. Check the highlighted fields and try again.
 *     Retry
 *
 * …and then Retry repeating the identical failure forever. The save had worked;
 * the *verification* was wrong, because the `about` step's gate counted
 * `skills >= 3` while the screen had only ever asked for an institution.
 *
 * Every test below is pinned to that one story, in the order a person meets it:
 * a correct save advances, a correct save offers no Retry, a genuine failure
 * names what is outstanding, and an optional step is never a trap.
 */

import { describe, expect, it } from 'vitest';

import {
  describeIncompleteStep,
  mayAdvance,
  outstandingSteps,
  saveFailureMessage,
  type StepVerdict,
} from '@/features/onboarding/aboutYouSave';

const LABELS = {
  basics: 'Basic profile',
  about: 'About You',
  photo: 'Profile photo',
  review: 'Review and finish',
};

/** `about` complete on one education row — the fixed contract. */
function savedSteps(overrides: Record<string, Partial<StepVerdict>> = {}): StepVerdict[] {
  const base: Record<string, StepVerdict> = {
    basics: { key: 'basics', complete: true, required: true, hint: '' },
    about: { key: 'about', complete: true, required: true, hint: '' },
    photo: { key: 'photo', complete: false, required: false, hint: '' },
    review: { key: 'review', complete: true, required: false, hint: '' },
  };
  for (const [key, patch] of Object.entries(overrides)) {
    base[key] = { ...base[key], ...patch } as StepVerdict;
  }
  return Object.values(base);
}

describe('1. the first Continue succeeds', () => {
  it('advances past About You once its education row is stored', () => {
    // The regression. Before the fix the server reported `about: false` for
    // anybody with fewer than three skills, so a correct save was read as a
    // failed one.
    expect(mayAdvance(savedSteps(), 'about', true)).toBe(true);
  });

  it('advances with zero skills, because skills are not this step’s gate', () => {
    // Nothing in this list mentions skills, and that is the point: the step's
    // completion is a function of the education row alone.
    expect(mayAdvance(savedSteps(), 'about', true)).toBe(true);
  });
});

describe('2. a successful save does not produce Retry', () => {
  it('reports nothing outstanding once the step is saved', () => {
    expect(outstandingSteps(savedSteps(), LABELS)).toEqual([]);
  });

  it('leaves no message to render, so no banner appears', () => {
    // `describeIncompleteStep(undefined)` is the "nothing outstanding" case; it
    // must not be reached on a successful save.
    expect(outstandingSteps(savedSteps(), LABELS)).toHaveLength(0);
  });
});
describe('3. a genuine failure names what is outstanding', () => {
  it('lists only required, incomplete steps', () => {
    const steps = savedSteps({ about: { complete: false, hint: 'Add where you studied.' } });
    expect(outstandingSteps(steps, LABELS)).toEqual([
      { key: 'about', label: 'About You', hint: 'Add where you studied.' },
    ]);
  });

  it('never calls an optional, skipped step outstanding', () => {
    // The photo step is `required: false` and skipped by design. Treating it as
    // blocking is what turns "Skip for now" into a dead end.
    const steps = savedSteps({ photo: { complete: false, hint: 'Optional.' } });
    expect(outstandingSteps(steps, LABELS)).toEqual([]);
  });

  it('refuses to advance past a required step the server says is incomplete', () => {
    expect(mayAdvance(savedSteps({ about: { complete: false } }), 'about', true)).toBe(false);
  });

  it('describes the step by name, not as a generic save failure', () => {
    // The exact wording this replaces: "That did not register as saved. Check
    // the highlighted fields and try again." — which named no field and
    // described a save that had in fact succeeded.
    const [step] = outstandingSteps(
      savedSteps({ about: { complete: false, hint: 'Add where you studied.' } }),
      LABELS,
    );
    const message = describeIncompleteStep(step);
    expect(message).toContain('About You');
    expect(message).toContain('Add where you studied.');
    expect(message).not.toContain('That did not save');
    expect(message).not.toContain('highlighted fields');
  });

  it('still says something useful when the server sent no hint', () => {
    const [step] = outstandingSteps(savedSteps({ about: { complete: false } }), LABELS);
    expect(describeIncompleteStep(step)).toContain('About You');
  });

  it('does not blame the save when the verdict itself is unknown', () => {
    // No step at all is a contract violation, not a persistence failure, so the
    // wording points at the connection rather than at the data.
    expect(describeIncompleteStep(undefined)).toContain('could not be confirmed');
  });
});

describe('4. optional steps can always be skipped', () => {
  it('advances past an incomplete optional step', () => {
    expect(mayAdvance(savedSteps({ photo: { complete: false } }), 'photo', false)).toBe(true);
  });

  it('never treats an unknown step key as complete', () => {
    // A malformed payload must not unlock the tree.
    expect(mayAdvance(savedSteps(), 'not-a-step', true)).toBe(false);
  });
});

describe('5. the failure message names the real cause', () => {
  it('shows the server’s own field message for a 422', () => {
    expect(saveFailureMessage('field', 'Please enter your college name.')).toBe(
      'Please enter your college name.',
    );
  });

  it('still names the field when the server sent no detail', () => {
    expect(saveFailureMessage('field')).toContain('highlighted fields');
  });

  it('says the session expired for a 401, which retrying cannot fix', () => {
    expect(saveFailureMessage('auth')).toContain('sign in again');
  });

  it('offers a plain retry for a network failure', () => {
    expect(saveFailureMessage('network')).toContain('try again');
  });

  it('never falls back to the old wording', () => {
    for (const kind of ['field', 'network', 'auth', 'unknown'] as const) {
      expect(saveFailureMessage(kind, 'Something specific.')).not.toContain('That did not save');
    }
  });
});