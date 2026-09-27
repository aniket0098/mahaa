/**
 * Personalized feed — "Your Feed".
 *
 * Native reproduction of `PersonalizedFeed.tsx` + `FeedSectionHeader.tsx` +
 * `feed.module.css`.
 *
 * **There is no feed endpoint, and none is invented.** The stream is built from
 * the authenticated candidate's own profile records, which the existing
 * `GET /profile` aggregate already returns (see `dashboardModel.ts`). The web
 * app can append fictional "Demo" posts in development; the native app has no
 * demo mode, so the only thing that appears here is real data or the honest
 * empty state.
 *
 * The filter chips filter by **real record type** rather than the blueprint's
 * conceptual For You / Latest / Trending, because ranking data does not exist.
 * Every chip is backed by data the server actually returns.
 */

import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { colors } from '@/theme/tokens';
import { FeedPostCard } from '@/features/home/FeedPostCard';
import {
  buildFeedPosts,
  feedFilters,
  filterFeedPosts,
  type FeedFilter,
  type FeedPost,
} from '@/features/home/dashboardModel';
import { styles } from '@/features/home/homeStyles';
import type { ProfileAggregate } from '@/types/profile';

export interface PersonalizedFeedProps {
  status: 'loading' | 'error' | 'ready';
  profile?: ProfileAggregate;
  errorMessage?: string | null;
  onRetry?: () => void;
  onOpenProfile: () => void;
  onOpenJobs: () => void;
  onOpenLink: (url: string) => void;
}

export function PersonalizedFeed({
  status,
  profile,
  errorMessage,
  onRetry,
  onOpenProfile,
  onOpenJobs,
  onOpenLink,
}: PersonalizedFeedProps) {
  const [filter, setFilter] = useState<FeedFilter>('all');

  if (status === 'loading') {
    return (
      <View style={styles.feed} testID="personalized-feed">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={4} />
      </View>
    );
  }

  if (status === 'error' || !profile) {
    return (
      <View style={styles.feed} testID="personalized-feed">
        <FeedHeader filter={filter} onFilterChange={setFilter} />
        <Card>
          <StatusBanner
            title="Your feed could not load"
            description={errorMessage ?? 'The API did not answer.'}
            onRetry={onRetry}
          />
        </Card>
      </View>
    );
  }

  const posts: FeedPost[] = buildFeedPosts(profile);
  const visible = filterFeedPosts(posts, filter);

  return (
    <View style={styles.feed} testID="personalized-feed">
      <FeedHeader filter={filter} onFilterChange={setFilter} />

      <AppText variant="caption" tone="tertiary">
        Showing your own MahaJob records, newest first. Community posts, media, and engagement
        arrive with the community stage.
      </AppText>

      {posts.length === 0 ? (
        <Card>
          <View style={styles.emptyState}>
            <AppIcon name={{ ios: 'tray', android: 'inbox' }} size={24} color={colors.colorTextTertiary} />
            <AppText variant="body" weight="semibold">
              Your feed is getting ready.
            </AppText>
            <AppText variant="body" tone="secondary">
              Explore opportunities or share your first idea. Projects, certifications,
              achievements, and education you add to your profile appear here.
            </AppText>
            <Button label="Explore opportunities" onPress={onOpenJobs} />
            <Button label="Complete your profile" variant="secondary" onPress={onOpenProfile} />
          </View>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <View style={styles.emptyState}>
            <AppIcon name={{ ios: 'tray', android: 'inbox' }} size={24} color={colors.colorTextTertiary} />
            <AppText variant="body" weight="semibold">
              Nothing in this filter yet.
            </AppText>
            <AppText variant="body" tone="secondary">
              You have no records of this type on your profile. Switch the filter or add the record
              from your profile.
            </AppText>
            <Button label="Add it on your profile" onPress={onOpenProfile} />
          </View>
        </Card>
      ) : (
        <View style={styles.list}>
          {visible.map((post) => (
            <FeedPostCard
              key={post.id}
              post={post}
              onOpenProfile={onOpenProfile}
              onOpenLink={onOpenLink}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function FeedHeader({
  filter,
  onFilterChange,
}: {
  filter: FeedFilter;
  onFilterChange: (filter: FeedFilter) => void;
}) {
  return (
    <View style={styles.feedHeader}>
      <AppText variant="h2" weight="semibold" accessibilityRole="header">
        Your Feed
      </AppText>
      <AppText variant="body" tone="secondary">
        Discover ideas, projects, learning updates, and opportunities.
      </AppText>
      <View style={styles.feedControls}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}>
          {feedFilters.map((option) => {
            const active = filter === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Filter: ${option.label}`}
                onPress={() => onFilterChange(option.value)}
                style={[styles.filterButton, active ? styles.filterButtonActive : null]}>
                <AppText variant="small" weight="medium" tone={active ? 'accent' : 'secondary'}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
