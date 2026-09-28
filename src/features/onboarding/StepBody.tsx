/**
 * The shell every onboarding step renders inside.
 *
 * It owns the three things that must be identical on every step, because a
 * wizard whose Back button behaves differently on step 3 than on step 4 is a
 * wizard people stop trusting:
 *
 * - **Back above the actions**, not hidden on the first step (there is nowhere to
 *   go back to, so the control is simply absent rather than inert).
 * - **Skip offered only where the step is skippable.** The wizard passes `onSkip`
 *   only for the optional steps, so "required" is enforced by what the screen can
 *   offer rather than by a disabled button with an explanation.
 * - **Continue disabled only on a client-checkable hard block.** A field the
 *   server validates (a URL, a date range) is submitted and the server's message
 *   is shown inline, rather than being guessed at here.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { spacing } from '@/theme/tokens';

export interface StepBodyProps {
  children: ReactNode;
  /** Persist, then advance. The wizard's Continue button. */
  onNext: () => void;
  /** False blocks Continue on a hard block the client can see (an empty required field). */
  ready: boolean;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  /** The primary button's label — "Continue", or "Finish" on the last step. */
  nextLabel?: string;
}

export function StepBody({
  children,
  onNext,
  ready,
  busy,
  canGoBack,
  onBack,
  onSkip,
  skipLabel = 'Skip for now',
  nextLabel = 'Continue',
}: StepBodyProps) {
  return (
    <View style={styles.container}>
      <View style={styles.fields}>{children}</View>

      <View style={styles.actions}>
        {canGoBack ? (
          <Button label="Back" variant="ghost" fullWidth onPress={onBack} disabled={busy} />
        ) : null}
        {onSkip ? (
          <Button
            label={skipLabel}
            variant="secondary"
            fullWidth
            onPress={onSkip}
            disabled={busy}
          />
        ) : null}
        <Button
          label={nextLabel}
          size="lg"
          fullWidth
          loading={busy}
          disabled={!ready}
          onPress={onNext}
          // A disabled Continue must say *why*. A greyed-out button with no
          // explanation is the single most common reason people believe a wizard
          // is broken, so the required fields are named rather than the button
          // simply refusing.
          accessibilityHint={ready ? undefined : 'Fill in the required fields on this step to continue.'}
        />
        {!ready ? (
          <AppText variant="caption" tone="tertiary" style={styles.blocked}>
            Fill in the required fields above to continue.
          </AppText>
        ) : null}
        <AppText variant="caption" tone="tertiary">
          Your progress saves as you go. You can come back to any step later.
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * No `flex: 1` on the container.
   *
   * It was there to make the action bar sit at the bottom of a full-height screen,
   * but inside a ScrollView's content container `flex: 1` resolves against an
   * unbounded height and collapses to zero — so the Continue button rendered with
   * no height and was invisible while the code looked perfectly correct. The host
   * supplies `flexGrow: 1` on the scroll content instead, which grows to fill a
   * tall screen and simply flows on a short one.
   */
  container: { gap: spacing.lg },
  fields: { gap: spacing.lg },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  /** Centred so the reason a button is disabled reads as a note, not an error. */
  blocked: { textAlign: 'center' },
});
