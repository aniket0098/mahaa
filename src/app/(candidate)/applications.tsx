/**
 * Applications tab — submission tracking.
 *
 * Honest notice: there is no applications router on the server, so no counts or
 * rows are shown. The status vocabulary is already defined in the design system
 * for when the domain lands.
 */
import { StageScreen } from '@/features/stages/StageScreen';

export default function CandidateApplicationsScreen() {
  return (
    <StageScreen
      title="Applications"
      description="Every application you submit, with its status history and next step, will live here."
      stage="Stage 6 — applications"
      nextStep="The API has no /applications router yet. Status vocabulary is already defined in the design system for when it arrives."
    />
  );
}