/**
 * Community tab for candidates.
 *
 * Dedicated space for student peer networking, group discussions,
 * and campus connection.
 */

import { StageScreen } from '@/features/stages/StageScreen';

export default function CandidateCommunityScreen() {
  return (
    <StageScreen
      title="Student Community"
      description="Connect with peers, join campus study groups, and participate in technical forums."
      stage="Stage 7 — community & peer networks"
      nextStep="The Community domain is currently in active planning. Check back for peer discussions and campus chapters."
    />
  );
}
