/**
 * Progress meter — renders a real, server-derived percentage.
 *
 * The value always comes from the backend (`/profile/completeness`). A meter is
 * never rendered from an estimate, and the accessible value is always exposed
 * so the number is not conveyed by the arc alone (docs/MOBILE_UX_SPEC.md §6).
 */

import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

export interface ProgressMeterProps {
  /** 0-100, rounded by the caller. */
  value: number;
  label: string;
  caption?: string | null;
}

export function ProgressMeter({ value, label, caption }: ProgressMeterProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: clamped }}>
      <View style={styles.header}>
        <AppText variant="label" tone="secondary">
          {label}
        </AppText>
        <AppText variant="label" weight="semibold" tone="accent">
          {clamped}%
        </AppText>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${clamped}%` }]} />
      </View>

      {caption ? (
        <AppText variant="caption" tone="tertiary">
          {caption}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // The original indicator (`.completenessTrack` / `.completenessFill`): an 8px
  // horizontal track with a fully rounded fill, on `color-border` — NOT a ring.
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
  caption: {
    marginTop: spacing.xs,
  },
});
