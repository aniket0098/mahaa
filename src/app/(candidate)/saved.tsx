/**
 * Saved tab — shortlist.
 *
 * Saving belongs to the opportunities domain, so this waits for that router
 * rather than persisting anything locally where it would be invisible to the
 * server.
 */
import { StageScreen } from '@/features/stages/StageScreen';

export default function CandidateSavedScreen() {
  return (
    <StageScreen
      title="Saved jobs"
      description="Shortlisted opportunities you kept for later will live here."
      stage="Stage 6 — opportunities"
      nextStep="Saving is part of the opportunities domain, so this screen waits for that router rather than storing anything locally."
    />
  );
}