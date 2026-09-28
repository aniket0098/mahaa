/**
 * FeedFilterBar — the filter chips above the feed.
 *
 * Horizontally scrollable, because four chips do not fit a small phone at a
 * large font scale. The active chip is both tinted **and** marked
 * `accessibilityState: { selected: true }`, so the state is never carried by
 * colour alone.
 *
 * The four filters are the only ones offered, and each is backed by real data
 * (`feedModel.filterFeed`). There is no "For You" chip: no ranking service
 * exists, and a filter implying personalisation must not be shown.
 */

import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { styles } from '@/features/feed/feedStyles';
import { feedFilters, type FeedFilter } from '@/features/feed/feedModel';

export interface FeedFilterBarProps {
  filter: FeedFilter;
  onChange: (filter: FeedFilter) => void;
}

export function FeedFilterBar({ filter, onChange }: FeedFilterBarProps) {
  return (
    <View testID="feed-filter-bar">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}>
        {feedFilters.map((option) => {
          const active = option.value === filter;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Show ${option.label} posts`}
              onPress={() => onChange(option.value)}
              hitSlop={4}
              style={[styles.filterChip, active ? styles.filterChipActive : null]}>
              <AppText
                variant="small"
                weight="medium"
                style={active ? styles.linkLabel : styles.filterChipLabel}>
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
