/**
 * Employer applicants — pipeline.
 *
 * Honest notice: no applications router exists, so no pipeline counts are shown.
 * Contact details staying hidden until a candidate consents is a server rule, not
 * a setting, and nothing on this screen implies otherwise.
 */
import { StageScreen } from '@/features/stages/StageScreen';

export default function EmployerApplicantsScreen() {
  return (
    <StageScreen
      title="Applicants"
      description="Review applicants per role, then shortlist, schedule an interview, or decline with a reason."
      stage="Stage 7 — employer pipeline"
      nextStep="The API has no applications router yet, so counts stay hidden until real applications exist."
    />
  );
}