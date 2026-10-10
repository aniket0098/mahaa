/**
 * DiscoverCategoryTabs — the in-page category control.
 *
 * A horizontal row of chips (scrollable so "Projects & Gigs" is reachable on a
 * narrow screen). Each non-"All" chip maps to a real `OpportunityType`; the
 * selection is exposed with `accessibilityState={{ selected }}` and a
 * primary-tinted surface, never by colour alone.
 */

import { useCallback, useState } from 'react';
import { Animated, Pressable, ScrollView } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { useReduceMotion } from '@/features/feed/useReduceMotion';
import { colors } from '@/theme/tokens';
import { DISCOVER_CATEGORIES } from './discoverFilters';
import { styles } from './discoverStyles';

export interface DiscoverCategoryTabsProps {
  selectedId: string;
  onSelect: (categoryId: string) => void;
}

export function DiscoverCategoryTabs({ selectedId, onSelect }: DiscoverCategoryTabsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.categoryRow}>
      {DISCOVER_CATEGORIES.map((category) => (
        <CategoryChip
          key={category.id}
          label={category.label}
          icon={category.icon}
          active={category.id === selectedId}
          onPress={() => onSelect(category.id)}
        />
      ))}
    </ScrollView>
  );
}

function CategoryChip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: { ios: string; android: string };
  active: boolean;
  onPress: () => void;
}) {
  const [scale] = useState(() => new Animated.Value(1));
  const reduceMotion = useReduceMotion();
  const animate = useCallback(
    (toValue: number) => {
      if (reduceMotion) return;
      Animated.spring(scale, { toValue, useNativeDriver: true }).start();
    },
    [reduceMotion, scale],
  );

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => animate(0.95)}
      onPressOut={() => animate(1)}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={[styles.categoryChip, active ? styles.categoryChipActive : null]}>
      <Animated.View style={[styles.categoryChipInner, { transform: [{ scale }] }]}>
        <AppIcon name={icon} size={16} color={active ? colors.colorPrimary : colors.colorTextSecondary} />
        <AppText variant="small" weight={active ? 'semibold' : 'medium'} tone={active ? 'accent' : 'secondary'}>
          {label}
        </AppText>
      </Animated.View>
    </Pressable>
  );
}
