/**
 * Candidate Learning — courseware, skill roadmaps, and certifications.
 *
 * The API has no learning management router yet, so this screen explains that
 * plainly instead of inventing courses, ratings, or mock progress bars.
 */

import { StageScreen } from '@/features/stages/StageScreen';

export default function CandidateLearnScreen() {
  return (
    <StageScreen
      title="Learning & Skills"
      description="Curated learning paths, industry skill certifications, and workshop webinars will live here."
      stage="Stage 7 — learning & readiness"
      nextStep="The learning catalog API is in active design. Completed profile skills and catalog evidence can be reviewed on your profile today."
    />
  );
}
