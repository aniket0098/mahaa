/**
 * Jobs tab — opportunity discovery.
 *
 * The API has no opportunities router, so this screen states that plainly
 * instead of rendering invented listings. The notice names the endpoint that
 * will back it, so the screen documents itself.
 */
import { StageScreen } from '@/features/stages/StageScreen';

export default function CandidateJobsScreen() {
  return (
    <StageScreen
      title="Job discovery"
      description="Published opportunities with search, filters, and an explained match score will live here."
      stage="Stage 6 — opportunities"
      nextStep="The API has no /opportunities router yet. When it does, this screen reads it directly; no other change is needed here."
    />
  );
}