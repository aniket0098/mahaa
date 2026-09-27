/**
 * Landing content (docs/PRODUCT.md, docs/SCREEN_DESIGN_RULES.md — Landing).
 *
 * Every line here is a statement the product can back. "Arriving in later
 * stages" is the deliberate alternative to placeholder metrics — see
 * `docs/ROADMAP.md`, which keeps those domains unshipped until their backend
 * exists.
 */

export const HIGHLIGHTS = ['Skills', 'Project evidence', 'Industry', 'Career pathways'] as const;

export interface Pillar {
  title: string;
  body: string;
}

export const PILLARS: readonly Pillar[] = [
  {
    title: 'Skills with evidence',
    body: 'A normalised skill profile with levels and evidence — not a free-text list.',
  },
  {
    title: 'Projects and education',
    body: 'Structured sections that become a real, versioned resume, with no PDF upload needed to start.',
  },
  {
    title: 'Companies and teams',
    body: 'An organisation layer with roles and permissions, so a hiring team is never a placeholder shell.',
  },
];

/** Only what a real endpoint serves today (`apps/api/app/api/v1/router.py`). */
export const LIVE_SURFACES = [
  'Account creation, sign-in, and identity',
  'Candidate profile, sections, and completeness',
  'Skills, skill catalogue, and evidence',
  'Structured resume versions',
  'Company profile, team, and verification request',
] as const;

export const LATER_STAGES = [
  'Job discovery, matching, and applications',
  'Recruiter pipeline and messaging',
  'Notifications and interview scheduling',
  'Learning recommendations and readiness coach',
] as const;
