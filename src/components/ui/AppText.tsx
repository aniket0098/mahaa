/**
 * Typography primitive — the only place font size, weight, and colour are chosen.
 *
 * Mirrors the semantic type scale in `docs/DESIGN_TOKENS.md` §5 so Android and
 * iOS render identical text. Components never set raw font values.
 */

import { Text, type TextProps, type TextStyle } from 'react-native';

import { colors, typography } from '@/theme/tokens';

export type TextVariant = 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'caption' | 'label';
export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'disabled'
  | 'onPrimary'
  | 'inverse'
  | 'accent'
  | 'danger'
  | 'success'
  | 'warning';
export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold';

const sizeByVariant: Record<TextVariant, number> = {
  display: typography.fontSizeDisplay,
  h1: typography.fontSizeH1,
  h2: typography.fontSizeH2,
  h3: typography.fontSizeH3,
  body: typography.fontSizeBody,
  small: typography.fontSizeSmall,
  caption: typography.fontSizeCaption,
  label: typography.fontSizeSmall,
};

const lineHeightByVariant: Record<TextVariant, number> = {
  display: typography.lineHeightDisplay,
  h1: typography.lineHeightH1,
  h2: typography.lineHeightH2,
  h3: typography.lineHeightH3,
  body: typography.lineHeightBody,
  small: typography.lineHeightSmall,
  caption: typography.lineHeightCaption,
  label: typography.lineHeightSmall,
};

const weightByWeight: Record<TextWeight, TextStyle['fontWeight']> = {
  regular: typography.fontWeightRegular as TextStyle['fontWeight'],
  medium: typography.fontWeightMedium as TextStyle['fontWeight'],
  semibold: typography.fontWeightSemibold as TextStyle['fontWeight'],
  bold: typography.fontWeightBold as TextStyle['fontWeight'],
};

const colorByTone: Record<TextTone, string> = {
  primary: colors.colorTextPrimary,
  secondary: colors.colorTextSecondary,
  tertiary: colors.colorTextTertiary,
  disabled: colors.colorTextDisabled,
  onPrimary: colors.colorTextOnPrimary,
  inverse: colors.landingTextPrimary,
  accent: colors.colorPrimary,
  danger: colors.colorDanger,
  success: colors.colorSuccess,
  warning: colors.colorWarning,
};

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  weight?: TextWeight;
  /** Uppercase micro-label used for section eyebrows. */
  uppercase?: boolean;
}

export function AppText({
  variant = 'body',
  tone = 'primary',
  weight = 'regular',
  uppercase = false,
  style,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[
        {
          fontSize: sizeByVariant[variant],
          lineHeight: lineHeightByVariant[variant],
          fontWeight: variant === 'label' ? weightByWeight.semibold : weightByWeight[weight],
          color: colorByTone[tone],
        },
        uppercase ? styles.uppercase : null,
        style,
      ]}
    />
  );
}

const styles = {
  uppercase: { textTransform: 'uppercase' as const, letterSpacing: 0.6 },
};
