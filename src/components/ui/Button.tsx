/**
 * Button — the shared action primitive for Android and iOS.
 *
 * Touch target is 48px minimum (docs/MOBILE_UX_SPEC.md §4). The accessible role
 * and label are always set, and the busy state disables the control rather than
 * only dimming it, so a double submit is impossible.
 */

import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, elevation, layout, radius, spacing } from '@/theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  accessibilityHint,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const tone = toneFor(variant, isDisabled);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        { backgroundColor: tone.bg, borderColor: tone.border },
        variant === 'primary' && !isDisabled ? elevation.sm : null,
        pressed && !isDisabled ? styles.pressed : null,
        fullWidth ? styles.fullWidth : null,
        style,
      ]}>
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={tone.fg} style={styles.spinner} />
        ) : null}
        <AppText
          variant="body"
          weight="semibold"
          style={[styles.label, { color: tone.fg, lineHeight: typographyLineHeight }]}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const typographyLineHeight = 20;

function toneFor(variant: ButtonVariant, isDisabled: boolean) {
  if (isDisabled) {
    return {
      bg: variant === 'ghost' ? 'transparent' : colors.colorBgMuted,
      fg: colors.colorTextDisabled,
      border: variant === 'ghost' ? 'transparent' : colors.colorBorder,
    };
  }
  switch (variant) {
    case 'primary':
      return { bg: colors.colorPrimary, fg: colors.colorOnPrimary, border: colors.colorPrimary };
    case 'secondary':
      return {
        bg: colors.colorPrimarySubtle,
        fg: colors.colorPrimary,
        border: colors.colorPrimarySubtle,
      };
    case 'danger':
      return { bg: colors.colorDanger, fg: colors.colorOnPrimary, border: colors.colorDanger };
    case 'ghost':
    default:
      return { bg: 'transparent', fg: colors.colorPrimary, border: colors.colorBorderStrong };
  }
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.control,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  md: {
    minHeight: layout.touchTargetPrimary,
  },
  lg: {
    minHeight: 52,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  label: {
    textAlign: 'center',
  },
  spinner: {
    marginRight: spacing.xs,
  },
  pressed: {
    opacity: 0.85,
  },
});
