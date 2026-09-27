/**
 * Skeleton — the loading placeholder for cards and list rows
 * (docs/MOBILE_UX_SPEC.md §5). A screen is never a bare spinner, and a
 * skeleton never implies content that does not exist.
 */

import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';

export interface SkeletonProps {
  height?: number;
  width?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ height = 16, width = '100%', radius: r = radius.sm, style }: SkeletonProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.base, { height, width, borderRadius: r }, style]}
    />
  );
}

/** A card-shaped group of skeleton lines, for list loading states. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <View style={styles.card}>
      <Skeleton height={18} width="70%" />
      {Array.from({ length: Math.max(0, lines - 1) }).map((_, index) => (
        <Skeleton key={index} height={12} width={index % 2 === 0 ? '100%' : '85%'} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.colorBgMuted,
  },
  card: {
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.cardPadding,
  },
});
