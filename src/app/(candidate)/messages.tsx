/**
 * Candidate Messages — direct conversation and interview correspondence.
 *
 * The API has no messaging router for candidates yet, so this screen states
 * that plainly rather than showing fabricated chat threads or fake unread counts.
 */

import { StageScreen } from '@/features/stages/StageScreen';

export default function CandidateMessagesScreen() {
  return (
    <StageScreen
      title="Messages"
      description="Direct messaging with recruiters, campus mentors, and application interviewers will live here."
      stage="Stage 8 — messaging"
      nextStep="The API has no candidate messaging router yet. Once it ships, this screen will connect directly without fabricated chats."
    />
  );
}
