/**
 * Employer jobs — opportunity management.
 *
 * Honest notice: the API has no opportunities router, so no job list, count, or
 * draft state is invented here.
 */
import { StageScreen } from '@/features/stages/StageScreen';

export default function EmployerJobsScreen() {
  return (
    <StageScreen
      title="Post and manage roles"
      description="Create opportunities, edit drafts, and pause, close, or archive a role will live here."
      stage="Stage 7 — opportunity composer"
      nextStep="The API has no opportunities router yet. Employer accounts need an active company first — membership authorization already exists."
    />
  );
}