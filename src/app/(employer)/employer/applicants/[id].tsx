/**
 * Applicant details.
 *
 * A real dynamic route: the id comes from the path and is echoed back. The body
 * is an honest notice — the applications domain does not exist on the server,
 * and an applicant screen is the worst place to invent a candidate's history.
 */
import { useLocalSearchParams } from 'expo-router';

import { StageScreen } from '@/features/stages/StageScreen';

export default function ApplicantDetailsScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  return (
    <StageScreen
      title="Applicant details"
      description={
        id
          ? `Applicant ${id}: match context, resume, and the shortlist, interview, or decline actions.`
          : 'Match context, resume, and the shortlist, interview, or decline actions.'
      }
      stage="Stage 7 — employer pipeline"
      nextStep="Contact details stay hidden until a candidate consents — that is a server rule, not a setting this screen could offer."
    />
  );
}