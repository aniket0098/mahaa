/**
 * Onboarding wizard step resolution â€” pure logic, no React and no network.
 *
 * The wizard's job is to land a person on the right step and to refuse to move
 * past one the server has not accepted. These tests drive that logic directly,
 * because the alternative is a test that can only prove the happy path.
 */

import { describe, expect, it } from 'vitest';

import {
  allRequiredComplete,
  clampStep,
  isLastStep,
  resolveStep,
  stepProgress,
  stepStatus,
} from '@/features/onboarding/onboardingLogic';
import {
  CANDIDATE_STEPS,
  REVIEW_STEP_KEY,
  firstStepIndex,
  requiredKeys,
  stepsForRole,
} from '@/features/onboarding/onboardingSteps';
import type { OnboardingStateRead } from '@/types/onboarding';

function state(overrides: Partial<OnboardingStateRead> = {}): OnboardingStateRead {
  return {
    role: 'candidate',
    state: 'not_started',
    percent: 0,
    next_step: null,
    steps: [
      { key: 'basics', label: 'Basic profile', complete: false, required: true, hint: '' },
      { key: 'education', label: 'Education', complete: false, required: true, hint: '' },
      { key: 'skills', label: 'Skills', complete: false, required: true, hint: '' },
    ],
    ...overrides,
  };
}

const ROLES = ['candidate', 'employer', 'college'] as const;

describe('requiredKeys â€” the completion gate', () => {
  it('lists only the steps that can block completion', () => {
    // Optional steps must never appear here: the gate decides whether a person may
    // finish, and including a skippable step would trap them in the wizard.
    expect(requiredKeys('candidate')).toEqual(['basics', 'education', 'skills', 'preferences']);
    expect(requiredKeys('employer')).toEqual(['company']);
    expect(requiredKeys('college')).toEqual(['institution', 'programs']);
  });

  it('gives every role at least one required step', () => {
    // A role with no gate could never be "incomplete", which is how the direct-to-
    // home bug would quietly reappear for that role alone.
    for (const role of ROLES) {
      expect(requiredKeys(role).length, role).toBeGreaterThan(0);
    }
  });

  it('ends every role with the review step, so the wizard can be finished', () => {
    // The bug this catches: no role's step list ended with review, so the last
    // screen was an optional step whose Continue clamped back to itself. Every
    // account got stuck on the final screen with no way out.
    for (const role of ROLES) {
      const steps = stepsForRole(role);
      expect(steps[steps.length - 1].key, role).toBe(REVIEW_STEP_KEY);
    }
  });

  it('has exactly one review step per role', () => {
    // Two would mean the first is unreachable and the last can never be reached
    // past, so the count is asserted rather than assumed.
    for (const role of ROLES) {
      const count = stepsForRole(role).filter((step) => step.key === REVIEW_STEP_KEY).length;
      expect(count, role).toBe(1);
    }
  });

  it('does not treat review as a required gate', () => {
    // Review is where the wizard ends, not a step that can block it â€” the server
    // decides completion from real data. Marking it required would make the gate
    // depend on a screen that only reports.
    for (const role of ROLES) {
      const review = stepsForRole(role).find((step) => step.key === REVIEW_STEP_KEY);
      expect(review?.required, role).toBe(false);
    }
  });

  it('gives every required step a screen, and every screen real copy', () => {
    for (const role of ROLES) {
      const steps = stepsForRole(role);
      for (const key of requiredKeys(role)) {
        // A required key with no screen is a gate nothing can ever satisfy.
        expect(steps.some((step) => step.key === key), `${role}/${key}`).toBe(true);
      }
      for (const step of steps) {
        expect(step.label.length, step.key).toBeGreaterThan(0);
        expect(step.description.length, step.key).toBeGreaterThan(0);
      }
    }
  });
});

describe('resolveStep â€” the server decides the position', () => {
  it('opens a new account on its first unfinished step', () => {
    const resolved = resolveStep(state({ next_step: 'education' }), CANDIDATE_STEPS);
    expect(CANDIDATE_STEPS[resolved].key).toBe('education');
  });

  it('opens a fresh account on the first screen when nothing is stored', () => {
    expect(resolveStep(state(), CANDIDATE_STEPS)).toBe(firstStepIndex(CANDIDATE_STEPS));
  });

  it('sends a finished account to the last step for review', () => {
    const resolved = resolveStep(state({ state: 'completed' }), CANDIDATE_STEPS);
    expect(resolved).toBe(CANDIDATE_STEPS.length - 1);
  });

  it('honours a requested step so a person can go back', () => {
    // Revisiting a completed step is a stated requirement, so the URL wins when it
    // names a step that exists.
    expect(resolveStep(state({ next_step: 'skills' }), CANDIDATE_STEPS, 0)).toBe(0);
  });

  it('clamps a step past the end rather than rendering nothing', () => {
    // A hand-typed ?step=99 must not blank the screen.
    expect(resolveStep(state(), CANDIDATE_STEPS, 99)).toBe(CANDIDATE_STEPS.length - 1);
    expect(resolveStep(state(), CANDIDATE_STEPS, -5)).toBe(0);
  });

  it('falls back to the first step for an unknown step key', () => {
    const resolved = resolveStep(state({ next_step: 'not_a_real_step' }), CANDIDATE_STEPS);
    expect(CANDIDATE_STEPS[resolved].key).toBe('basics');
  });

  it('opens on the first step when there is no state at all', () => {
    // Before the server answers, the wizard must still render something valid
    // rather than a blank screen or a crash on state.next_step.
    expect(resolveStep(null, CANDIDATE_STEPS)).toBe(0);
    expect(resolveStep(undefined, CANDIDATE_STEPS)).toBe(0);
  });
});

describe('clampStep', () => {
  it('handles an empty wizard without dividing by zero', () => {
    expect(clampStep(3, [])).toBe(0);
  });

  it('floors a fractional index', () => {
    expect(clampStep(2.9, CANDIDATE_STEPS)).toBe(2);
  });
});


describe('allRequiredComplete â€” the finish gate', () => {
  it('is false while any required step is outstanding', () => {
    const partial = state({
      steps: [
        { key: 'basics', label: 'Basic profile', complete: true, required: true, hint: '' },
        { key: 'education', label: 'Education', complete: false, required: true, hint: '' },
      ],
    });
    expect(allRequiredComplete(partial)).toBe(false);
  });

  it('is true only when every required step is complete', () => {
    const done = state({
      state: 'completed',
      steps: [
        { key: 'basics', label: 'Basic profile', complete: true, required: true, hint: '' },
        { key: 'education', label: 'Education', complete: true, required: true, hint: '' },
      ],
    });
    expect(allRequiredComplete(done)).toBe(true);
  });

  it('ignores optional steps', () => {
    // An unfinished optional step must not block finishing â€” that is what makes
    // "Skip for now" a real option rather than a dead end.
    const withOptional = state({
      state: 'completed',
      steps: [
        { key: 'basics', label: 'Basic profile', complete: true, required: true, hint: '' },
        { key: 'photo', label: 'Photo', complete: false, required: false, hint: '' },
      ],
    });
    expect(allRequiredComplete(withOptional)).toBe(true);
  });

  it('is false with no state, so Finish can never be enabled on a guess', () => {
    expect(allRequiredComplete(null)).toBe(false);
    expect(allRequiredComplete(undefined)).toBe(false);
  });
});

describe('stepStatus â€” a tick only when the server says so', () => {
  it('reports the server flag rather than a local guess', () => {
    const current = state({
      steps: [
        { key: 'basics', label: 'Basic profile', complete: true, required: true, hint: 'done' },
      ],
    });
    expect(stepStatus(current, 'basics')).toEqual({ complete: true, hint: 'done' });
  });

  it('reports a step the server has not heard of as incomplete', () => {
    expect(stepStatus(state(), 'nope')).toEqual({ complete: false, hint: '' });
  });

  it('never paints a tick when there is no state at all', () => {
    // The failure this prevents: a progress dot filled in from a default.
    expect(stepStatus(null, 'basics').complete).toBe(false);
  });
});

describe('stepProgress â€” wizard position, not profile completeness', () => {
  it('reports 0 at the first step and 100 at the last', () => {
    expect(stepProgress(0, 5)).toBe(0);
    expect(stepProgress(4, 5)).toBe(100);
  });

  it('reports 100 for a single-step flow', () => {
    expect(stepProgress(0, 1)).toBe(100);
  });

  it('never goes below zero or above 100', () => {
    expect(stepProgress(-3, 5)).toBe(0);
    expect(stepProgress(99, 5)).toBe(100);
  });
});

describe('isLastStep', () => {
  it('is true only on the final index', () => {
    expect(isLastStep(3, 4)).toBe(true);
    expect(isLastStep(2, 4)).toBe(false);
  });
});
