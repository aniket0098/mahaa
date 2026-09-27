/**
 * Avatar — identity bubble with an initials fallback.
 *
 * Native port of `apps/web/src/components/ui/Avatar.tsx` + `avatar.module.css`.
 * The same four sizes and the same deterministic name-derived tint are used, so
 * the same person or company gets the same colour in both apps.
 *
 * The tint is decoration: the name is always rendered as text beside the avatar,
 * so a screen reader never depends on the colour to identify anyone.
 */

import { useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius, typography } from '@/theme/tokens';

export type AvatarSize = 32 | 40 | 56 | 96;

export interface AvatarProps {
  /** Display name — drives both the initials and the deterministic tint. */
  name: string;
  src?: string | null;
  size?: AvatarSize;
  /** `rounded` (radius 10) is used for company logos. */
  shape?: 'circle' | 'rounded';
  style?: StyleProp<ViewStyle>;
}

const TINTS = ['slate', 'blue', 'sky', 'emerald', 'amber', 'rose'] as const;
type Tint = (typeof TINTS)[number];

/** First letter of the first and last words, e.g. "Ada Lovelace" -> "AL". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Stable colour per name, so the same company is always the same colour. */
export function tintFor(name: string): Tint {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return TINTS[hash % TINTS.length] ?? 'slate';
}

const tintColors: Record<Tint, { bg: string; fg: string }> = {
  slate: { bg: colors.colorBgMuted, fg: colors.colorTextSecondary },
  blue: { bg: colors.colorPrimarySubtle, fg: colors.colorPrimary },
  sky: { bg: colors.colorInfoSubtle, fg: colors.colorInfo },
  emerald: { bg: colors.colorSuccessSubtle, fg: colors.colorSuccess },
  amber: { bg: colors.colorWarningSubtle, fg: colors.colorWarning },
  rose: { bg: colors.colorDangerSubtle, fg: colors.colorDanger },
};

const sizeFont: Record<AvatarSize, number> = {
  32: typography.fontSizeCaption,
  40: typography.fontSizeSmall,
  56: typography.fontSizeH3,
  96: typography.fontSizeH1,
};

export function Avatar({ name, src = null, size = 40, shape = 'circle', style }: AvatarProps) {
  // A broken image URL must degrade to initials rather than an empty circle.
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;
  const tint = tintFor(name);
  const palette = tintColors[tint];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.base,
        { width: size, height: size },
        shape === 'rounded' ? styles.rounded : styles.circle,
        showImage ? styles.imageBackground : { backgroundColor: palette.bg },
        style,
      ]}>
      {showImage ? (
        <Image
          source={{ uri: src as string }}
          style={[styles.image, { width: size, height: size }]}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text
          style={[styles.initials, { color: palette.fg, fontSize: sizeFont[size] }]}
          numberOfLines={1}>
          {initials(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    // `flex: 0` keeps the avatar from growing or shrinking inside a row; RN's
    // `flex` is a number, not a boolean.
    flex: 0,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  circle: { borderRadius: radius.full },
  rounded: { borderRadius: radius.control },
  imageBackground: { backgroundColor: colors.colorBgMuted },
  image: { height: '100%', width: '100%' },
  initials: {
    fontWeight: typography.fontWeightSemibold,
    textAlign: 'center',
  },
});