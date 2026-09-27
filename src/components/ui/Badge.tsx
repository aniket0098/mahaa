/**
 * Badge — the chip primitive used across the dashboard.
 *
 * Native port of `apps/web/src/components/ui/Badge.tsx` + `badge.module.css`:
 * a 26px-tall pill with 12px horizontal padding, caption typography, and one of
 * six tones.
 *
 * Tone is never the only signal — a badge always carries text, which is what
 * keeps a chip readable when colour is unavailable or the contrast is low
 * (DESIGN_SYSTEM §23).
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme/tokens';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** Optional leading glyph. Never decorative-only: the text carries meaning. */
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const toneColors: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.colorBgMuted, fg: colors.colorTextSecondary },
  primary: { bg: colors.colorPrimarySubtle, fg: colors.colorPrimary },
  success: { bg: colors.colorSuccessSubtle, fg: colors.colorSuccess },
  warning: { bg: colors.colorWarningSubtle, fg: colors.colorWarning },
  danger: { bg: colors.colorDangerSubtle, fg: colors.colorDanger },
  info: { bg: colors.colorInfoSubtle, fg: colors.colorInfo },
};

export function Badge({ children, tone = 'neutral', icon, style }: BadgeProps) {
  const palette = toneColors[tone];

  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }, style]}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={[styles.label, { color: palette.fg }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    flexDirection: 'row',
    gap: 4,
    minHeight: 26,
    paddingHorizontal: spacing.md,
  },
  icon: { flexDirection: 'row' },
  label: {
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightMedium,
    lineHeight: typography.lineHeightCaption,
  },
});