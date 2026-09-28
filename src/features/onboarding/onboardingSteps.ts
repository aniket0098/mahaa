/**
 * The wizard's screens, per role — pure data, no React.
 *
 * The split between `required` and optional is the approved field list made
 * explicit. Only a `required: true` step can keep somebody in the flow, so this
 * table is the single place that decides what gates completion; the server's
 * `GET /onboarding/state` is what decides whether each of them is *done*.
 */

export interface StepMeta {
  key: string;
  label: string;
  description: string;
  /** False for the skippable steps (photo, links, extra profile work). */
  required: boolean;
}

/**
 * The starting index of a wizard.
 *
 * Always 0: a flow opens at its first screen. It exists as a named function so
 * callers do not each hardcode `0`, which is how a future role with a different
 * starting step (an employer whose first question is the company, say) would end
 * up with the number baked into five call sites.
 */
export function firstStepIndex(_steps: readonly StepMeta[]): number {
  return 0;
}

export const CANDIDATE_STEPS: readonly StepMeta[] = [
  {
    key: 'basics',
    label: 'Basic profile',
    description: 'Add the headline, location, and bio employers see first.',
    required: true,
  },
  {
    key: 'education',
    label: 'Education',
    description: 'Add where you studied — recruiters look here for early-career roles.',
    required: true,
  },
  {
    key: 'skills',
    label: 'Skills',
    description: 'Add at least three skills. They power explained matching later.',
    required: true,
  },
  {
    key: 'experience',
    label: 'Experience & projects',
    description: 'Show what you have done so far. Optional — you can skip it.',
    required: false,
  },
  {
    key: 'preferences',
    label: 'Preferences',
    description: 'Set the work modes and job types you want.',
    required: true,
  },
  {
    key: 'photo',
    label: 'Profile photo',
    description: 'Add a photo from your camera or gallery. Optional.',
    required: false,
  },
  {
    key: 'links',
    label: 'Resume & links',
    description: 'Add a resume, a portfolio, or a LinkedIn link. Optional.',
    required: false,
  },
  {
    key: 'review',
    label: 'Review and finish',
    description: 'Check everything, then finish and open your dashboard.',
    // The review screen is how the wizard ends, so it must always be present. It
    // is not itself a gate — the server decides completion from the real data —
    // but without this entry the last screen is an optional step whose Continue
    // has nowhere to go, and the account can never leave the wizard.
    required: false,
  },
];

export const EMPLOYER_STEPS: readonly StepMeta[] = [
  {
    key: 'profile',
    label: 'Your profile',
    description: 'Add a photo, your designation, and a phone number. Optional.',
    required: false,
  },
  {
    key: 'company',
    label: 'Company',
    description: 'Create the company you hire through. This one is required.',
    required: true,
  },
  {
    key: 'verification',
    label: 'Verification',
    description: 'See where your company stands. Optional to act on now.',
    required: false,
  },
  {
    key: 'review',
    label: 'Review and finish',
    description: 'Check your recruiter and company details, then finish.',
    required: false,
  },
];

export const COLLEGE_STEPS: readonly StepMeta[] = [
  {
    key: 'profile',
    label: 'Your contact profile',
    description: 'Add a photo and your designation as the contact person. Optional.',
    required: false,
  },
  {
    key: 'institution',
    label: 'Institution',
    description: "Add your institution's name and details.",
    required: true,
  },
  {
    key: 'programs',
    label: 'Programs',
    description: 'Add at least one course or program you offer.',
    required: true,
  },
  {
    key: 'verification',
    label: 'Verification',
    description: 'See where your institution stands. Optional to act on now.',
    required: false,
  },
  {
    key: 'review',
    label: 'Review and finish',
    description: 'Check your institution and programs, then finish.',
    required: false,
  },
];

/**
 * The step every role's wizard ends on.
 *
 * Exported as a constant rather than repeated per role so `OnboardingStepView` can
 * route on the key without each list drifting into its own spelling.
 */
export const REVIEW_STEP_KEY = 'review';

/** The screens for a role, in the order they are presented. */
export function stepsForRole(role: string | undefined): readonly StepMeta[] {
  if (role === 'employer') return EMPLOYER_STEPS;
  if (role === 'college') return COLLEGE_STEPS;
  return CANDIDATE_STEPS;
}

/** The required keys for a role — the gate, and nothing else. */
export function requiredKeys(role: string | undefined): readonly string[] {
  return stepsForRole(role)
    .filter((step) => step.required)
    .map((step) => step.key);
}
