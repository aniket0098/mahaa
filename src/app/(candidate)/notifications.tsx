/**
 * Notifications — candidate.
 *
 * The API has no notifications router, so this is an honest notice. There is no
 * badge anywhere in the app either, because a badge implies a count that the
 * server cannot supply.
 */
import { StageScreen } from '@/features/stages/StageScreen';

export default function CandidateNotificationsScreen() {
  return (
    <StageScreen
      title="Notifications"
      description="Application updates, interview invitations, and message alerts will appear here."
      stage="Stage 6 — notifications"
      nextStep="The API has no notifications router yet, so the app shows no unread count anywhere rather than inventing one."
    />
  );
}