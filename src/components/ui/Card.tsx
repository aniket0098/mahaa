/**
 * Card — the surface primitive. Borders first, shadows only when earned
 * (`docs/DESIGN_TOKENS.md` elevation rule).
 */

import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  padded?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * Fired when the card's own box is laid out.
   *
   * **Needed by the feed's video playback, and only that.** A card holding a video
   * has to publish its position within the scroll content so the coordinator can
   * tell whether it is on screen. `onLayout` reports `layout.y` relative to the
   * parent, which is what the coordinator compares against the scroll offset —
   * no extra measuring, and no polling.
   */
  onLayout?: (event: LayoutChangeEvent) => void;
}

export function Card({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  padded = true,
  testID,
  style,
  onLayout,
}: CardProps) {
  const content = (
    <View
      testID={testID}
      onLayout={onLayout}
      style={[styles.card, padded ? styles.padded : null, style]}>
      {children}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : null)}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  padded: {
    padding: spacing.cardPadding,
  },
  pressed: {
    opacity: 0.9,
  },
});
