/**
 * Shared shell for a screen whose backend domain has not shipped yet.
 *
 * Each stage names the real domain it will be built from, so the notice is
 * specific rather than a generic "coming soon". Nothing here fabricates data:
 * the whole point is that there is nothing to show until the domain exists.
 *
 * **Every stage screen opens with a Back control, and that is load-bearing.**
 * These screens sit on detail routes inside a `Tabs` shell that renders no
 * header, so a stage screen without one is a dead end — reachable by a deep
 * link or a push, with no visible way out. The previous design put a
 * "Back to home" button below the notice and let a caller opt out of it
 * entirely, which left `/notifications` stranded on a screen with no way back.
 * The control is now unconditional, and {@link BackButton} resolves its
 * destination from the signed-in role, so a candidate never lands in the
 * employer tree and vice versa.
 */

import { BackButton } from '@/components/ui/BackButton';
import { Screen } from '@/components/ui/Screen';
import { StageNotice } from '@/components/ui/StageNotice';

export interface StageScreenProps {
  title: string;
  description: string;
  stage: string;
  nextStep: string;
  /**
   * @deprecated Kept so an existing caller still type-checks. The back control is
   * always rendered now — a stage screen is never a dead end.
   */
  backToHome?: boolean;
}

export function StageScreen({ title, description, stage, nextStep }: StageScreenProps) {
  return (
    <Screen testID={`stage-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <BackButton />
      <StageNotice title={title} description={description} stage={stage} nextStep={nextStep} />
    </Screen>
  );
}
