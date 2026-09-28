/**
 * Candidate Innovation Lab — hackathons, research incubator, and student challenges.
 *
 * This feature arrives in a later stage, so this screen names the planned
 * domain honestly without generating mock challenges or fake hackathon listings.
 */

import { StageScreen } from '@/features/stages/StageScreen';

export default function CandidateInnovationLabScreen() {
  return (
    <StageScreen
      title="Innovation Lab"
      description="Student innovation challenges, corporate hackathons, and collaborative research incubators will live here."
      stage="Stage 9 — innovation & challenges"
      nextStep="Corporate and university challenge integrations will land here in Stage 9. You can build and showcase your personal projects on your profile now."
    />
  );
}
