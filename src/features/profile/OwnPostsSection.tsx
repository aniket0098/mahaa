/**
 * Posts & Activity — the candidate's own published posts.
 *
 * Backed by `GET /posts/mine`, which is the only endpoint that answers "what has
 * this person actually published". The card, the filter, and the media viewer
 * are the Community Feed's own components: no second post system is built here,
 * and the merged profile-record half of the Home feed is deliberately left out
 * because a project that was never published is not an activity.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { FeedFilterBar } from '@/features/feed/FeedFilterBar';
import { FeedPostCard } from '@/features/feed/FeedPostCard';
import { filterFeed, type FeedFilter, type FeedPost } from '@/features/feed/feedModel';
import { styles } from '@/features/profile/profileStyles';

export interface OwnPostsSectionProps {
  status: 'loading' | 'error' | 'ready';
  posts: readonly FeedPost[];
  /** Server total from `GET /posts/mine` — not `posts.length`. */
  total: number;
  errorMessage: string | null;
  onRetry: () => void;
  onCreate: () => void;
  onOpenProfile: () => void;
  onOpenLink: (url: string) => void;
}

export function OwnPostsSection({
  status,
  posts,
  total,
  errorMessage,
  onRetry,
  onCreate,
  onOpenProfile,
  onOpenLink,
}: OwnPostsSectionProps) {
  const [filter, setFilter] = useState<FeedFilter>('latest');
  const visible = filterFeed(posts, filter);

  return (
    <Card testID="profile-posts" style={styles.card}>
      <View style={styles.postsHeader}>
        <AppText variant="h3" accessibilityRole="header">
          {'Posts & Activity'}
        </AppText>
        <Button label="Create" variant="ghost" onPress={onCreate} />
      </View>

      {status === 'loading' ? (
        <View style={styles.posts}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={5} />
        </View>
      ) : status === 'error' ? (
        <StatusBanner
          title="Your posts could not load"
          description={errorMessage ?? 'The API did not answer, so nothing is shown in its place.'}
          onRetry={onRetry}
        />
      ) : total === 0 ? (
        <View style={styles.empty}>
          <AppText variant="body" weight="semibold">
            You have not published anything yet.
          </AppText>
          <AppText variant="small" tone="secondary">
            Your published posts appear here as soon as the server stores one.
          </AppText>
          <View>
            <Button label="Create your first post" onPress={onCreate} />
          </View>
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.empty}>
          <AppText variant="small" tone="secondary">
            None of your {total} {total === 1 ? 'post is' : 'posts are'} of this type yet.
          </AppText>
          <View>
            <Button label="Show all posts" variant="secondary" onPress={() => setFilter('latest')} />
          </View>
        </View>
      ) : (
        <View style={styles.posts}>
          <FeedFilterBar filter={filter} onChange={setFilter} />
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
    </Card>
  );
}
