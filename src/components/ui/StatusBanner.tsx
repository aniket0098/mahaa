/**
 * Status banner — a persistent, non-dismissible message region.
 *
 * Used for request failures that the user must act on (sign-in failed, the API
 * is unreachable). Toasts are reserved for non-critical confirmations
 * (docs/MOBILE_UX_SPEC.md §5), so this component never auto-hides: an error
 * that disappears on a timer is an error the user misses.
 */

import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

export type BannerTone = 'error' | 'info' | 'success' | 'warning';

export interface StatusBannerProps {
  title: string;
  description?: string | null;
  tone?: BannerTone;
  /** Optional retry affordance — always available for transport failures. */
  onRetry?: () => void;
}

export function StatusBanner({ title, description, tone = 'error', onRetry }: StatusBannerProps) {
  const toneStyle = toneStyles[tone];

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: toneStyle.bg, borderColor: toneStyle.border }]}>
      <View style={styles.text}>
        <AppText variant="body" weight="semibold" style={{ color: toneStyle.fg }}>
          {title}
        </AppText>
        {description ? (
          <AppText variant="small" tone="secondary">
            {description}
          </AppText>
        ) : null}
      </View>
      {onRetry ? (
        <AppText
          variant="body"
          weight="semibold"
          accessibilityRole="button"
          onPress={onRetry}
          style={[styles.retry, { color: toneStyle.fg }]}>
          Retry
        </AppText>
      ) : null}
    </View>
  );
}

const toneStyles: Record<BannerTone, { bg: string; fg: string; border: string }> = {
  error: {
    bg: colors.colorDangerSubtle,
    fg: colors.colorDanger,
    border: colors.colorDanger,
  },
  info: {
    bg: colors.colorInfoSubtle,
    fg: colors.colorInfo,
    border: colors.colorInfo,
  },
  success: {
    bg: colors.colorSuccessSubtle,
    fg: colors.colorSuccess,
    border: colors.colorSuccess,
  },
  warning: {
    bg: colors.colorWarningSubtle,
    fg: colors.colorWarning,
    border: colors.colorWarning,
  },
};

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  text: {
    gap: 2,
  },
  retry: {
    marginTop: spacing.xs,
    minHeight: 44,
    textAlignVertical: 'center',
  },
});
