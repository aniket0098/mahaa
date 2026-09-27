/**
 * Employer messages.
 *
 * Honest notice: the API has no messaging router, and nothing is stored on the
 * device in the meantime. When messaging lands it will be one system scoped to
 * real applications, not two.
 */
import { StageScreen } from '@/features/stages/StageScreen';

export default function EmployerMessagesScreen() {
  return (
    <StageScreen
      title="Messages"
      description="Conversations with candidates, with read states and a composer, will live here."
      stage="Stage 8 — messaging"
      nextStep="The API has no messaging router yet. There will be exactly one messaging system, scoped to a real application."
    />
  );
}