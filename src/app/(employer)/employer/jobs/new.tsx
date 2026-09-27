/**
 * Post a job.
 *
 * Honest notice: the API has no opportunities router, so the guided composer
 * does not exist yet. The screen exists so the entry point is reviewable and so
 * the route is wired, without pretending a form can save.
 */
import { StageScreen } from '@/features/stages/StageScreen';

export default function NewEmployerJobScreen() {
  return (
    <StageScreen
      title="Post a job"
      description="A guided composer with autosaving drafts and a preview will live here."
      stage="Stage 7 — opportunity composer"
      nextStep="The API has no opportunities router yet, so there is nothing this form could save to."
    />
  );
}