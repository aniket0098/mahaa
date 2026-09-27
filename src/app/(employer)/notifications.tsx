/**
 * Employer notifications.
 *
 * Honest notice: no notifications router exists, so the app shows no unread count
 * anywhere rather than inventing one.
 */
import { StageScreen } from '@/features/stages/StageScreen';

export default function EmployerNotificationsScreen() {
  return (
    <StageScreen
      title="Notifications"
      description="New applicants, interview reminders, and message alerts will appear here."
      stage="Stage 7 — notifications"
      nextStep="The API has no notifications router yet, so no badge or count is shown anywhere in the app."
    />
  );
}