/**
 * The onboarding header: which step this is, and how far through the wizard it is.
 *
 * Two things are deliberately separate, because they answer different questions:
 *
 * - **"Step 3 of 7"** is the wizard's position, derived from the step index.
 * - **The bar** fills from the same index.
 *
 * Neither is the profile-completeness percentage, which is a different number with
 * a different meaning and is shown by the profile and home screens from the
 * server's own value. Using one as a stand-in for the other is how a progress bar
 * ends up claiming 100% on a half-finished profile.
 *
 * Completed steps are tappable so a person can go back and fix something without
 * losing their place; a step that is not yet reached is not tappable, because
 * jumping ahead of a requirement is exactly what the server would refuse.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import type { StepMeta } from '@/features/onboarding/onboardingSteps';
import { isLastStep, stepProgress } from '@/features/onboarding/onboardingLogic';
import { colors, radius, spacing, typography } from '@/theme/tokens';

export interface StepHeaderProps {
  step: StepMeta;
  index: number;
  total: number;
  /** Server-derived: whether the current step's data is in place. */
  complete: boolean;
  /** Called with the index of a completed, already-visited step. */
  onJumpTo: (index: number) => void;
}

export function StepHeader({ step, index, total, complete, onJumpTo }: StepHeaderProps) {
  const isFinal = isLastStep(index, total);
  const progress = stepProgress(index, total);

  return (
    <View style={styles.wrapper}>
      <View style={styles.titles}>
        <AppText variant="label" tone="secondary">
          {`Step ${index + 1} of ${total}`}
        </AppText>
        <AppText variant="h1" accessibilityRole="header">
          {step.label}
        </AppText>
        <AppText variant="body" tone="secondary">
          {step.description}
        </AppText>
      </View>

      <View
        style={styles.track}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Registration progress"
        accessibilityValue={{ min: 0, max: 100, now: progress }}>
        <View style={[styles.fill, { width: `${progress}%` }]} />
      </View>

      {/* The dot row: a dot is the step's state, not decoration. Filled means the
          server has the data; hollow means it does not. */}
      <View style={styles.dots}>
        {Array.from({ length: total }, (_unused, dotIndex) => {
          const visited = dotIndex <= index;
          const isCurrent = dotIndex === index;
          return (
            <Pressable
              key={dotIndex}
              // Only a step already reached can be jumped back to; a future step
              // is deliberately inert rather than broken.
              disabled={dotIndex > index}
              accessibilityRole="button"
              accessibilityLabel={`Step ${dotIndex + 1}`}
              accessibilityState={{ selected: isCurrent, disabled: dotIndex > index }}
              hitSlop={8}
              onPress={() => onJumpTo(dotIndex)}
              style={styles.dotSlot}>
              <View
                style={[
                  styles.dot,
                  visited ? styles.dotVisited : null,
                  isCurrent ? styles.dotCurrent : null,
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      {complete ? (
        <View style={styles.done}>
          <AppText variant="caption" tone="success">
            {isFinal ? 'Ready to finish' : 'Saved — you can change this later'}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.md },
  titles: { gap: spacing.xs },
  track: {
    backgroundColor: colors.colorBorder,
    borderRadius: radius.full,
    height: 8,
    overflow: 'hidden',
  },
  fill: {
    backgroundColor: colors.colorPrimary,
    borderRadius: radius.full,
    height: 8,
  },
  dots: { flexDirection: 'row', gap: spacing.sm },
  dotSlot: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    minWidth: 24,
  },
  dot: {
    borderColor: colors.colorBorderStrong,
    borderRadius: radius.full,
    borderWidth: 2,
    height: 10,
    width: 10,
  },
  dotVisited: { backgroundColor: colors.colorPrimary, borderColor: colors.colorPrimary },
  dotCurrent: { height: typography.fontSizeCaption * 0.6, width: typography.fontSizeCaption * 0.6 },
  done: { alignItems: 'center' },
});
