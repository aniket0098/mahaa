/**
 * CommunityFeed — the feed section on the candidate Home page.
 *
 * Sits directly under the Stories row and scrolls with the page: it is a sibling
 * of the other Home sections inside the screen's single `ScrollView`, not a
 * nested scroll container.
 *
 * **The section is deliberately unlabelled.** There is no "Community Feed"
 * heading, no intro sentence, and no composer card, so the first thing a reader
 * sees under Stories is the feed itself. The filter row is the only control, and
 * it sits above the posts because it is the thing that changes them. The
 * section's `testID` is the only thing identifying it in tests, which is why it
 * is kept.
 *
 * **What the feed contains.** One merged list — the candidate's own real records
 * from the `GET /profile` aggregate the screen already fetched, followed by the
 * development-only demo posts. There is no posts API, so there is no second
 * author, no pagination, and no engagement count anywhere in this section, and
 * nothing here is fetched a second time.
 *
 * **Demo labelling is per card, not per section.** Each demo post still carries
 * its own DEMO chip and its images still carry a DEMO watermark, so removing the
 * section-level note did not weaken that guarantee.
 *
 * **States.** Loading shows skeleton cards shaped like posts rather than a
 * spinner, so the page does not visibly jump when data lands. An error keeps the
 * section's place and offers Retry — it never falls back to demo content. Each
 * filter has its own empty state, which says how many posts exist elsewhere
 * instead of leaving a blank region.
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
import { styles } from '@/features/feed/feedStyles';
import type { FeedFilter } from '@/features/feed/feedModel';
import { useFeedPosts } from '@/features/feed/useFeedPosts';
import type { ProfileAggregate } from '@/types/profile';

export interface CommunityFeedProps {
  /** Status of the profile aggregate the own-records half depends on. */
  status: 'loading' | 'error' | 'ready';
  profile?: ProfileAggregate;
  errorMessage?: string | null;
  onRetry?: () => void;
  onOpenProfile: () => void;
  onOpenLink: (url: string) => void;
}

export function CommunityFeed({
  status,
  profile,
  errorMessage,
  onRetry,
  onOpenProfile,
  onOpenLink,
}: CommunityFeedProps) {
  const [filter, setFilter] = useState<FeedFilter>('latest');
  const view = useFeedPosts(profile, filter);

  // The feed's own `/posts` request is the one that decides whether the section
  // is loading or has failed; the profile request only supplies the own-records
  // half, so a profile failure must not blank out real posts the server sent.
  const feedStatus = view.status === 'error' ? 'error' : view.status === 'loading' ? 'loading' : status;
  const feedError = view.status === 'error' ? view.errorMessage : errorMessage;

  return (
    <View style={styles.section} testID="community-feed">
      <FeedFilterBar filter={filter} onChange={setFilter} />

      {feedStatus === 'loading' ? (
        <View style={styles.list}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={5} />
        </View>
      ) : feedStatus === 'error' ? (
        <Card>
          <StatusBanner
            title="The feed could not load"
            description={
              feedError ??
              'The API did not answer, so there is nothing to show yet. Nothing here is invented to fill the gap.'
            }
            onRetry={onRetry}
          />
        </Card>
      ) : view.posts.length === 0 ? (
        <Card>
          <View style={styles.emptyState}>
            <AppText variant="body" weight="semibold" style={styles.emptyTitle}>
              {view.total === 0
                ? 'Your feed is waiting for its first post.'
                : 'Nothing in this filter yet.'}
            </AppText>
            <AppText variant="small" tone="secondary">
              {view.total === 0
                ? 'Projects, certifications, achievements, and education you add to your profile appear here as soon as you save them.'
                : `You have ${view.total} ${view.total === 1 ? 'post' : 'posts'} in the feed, but none of this type. Switch back to Latest to see them all.`}
            </AppText>
            {view.total === 0 ? (
              <Button label="Complete your profile" onPress={onOpenProfile} />
            ) : (
              <Button label="Show latest" variant="secondary" onPress={() => setFilter('latest')} />
            )}
          </View>
        </Card>
      ) : (
        <View style={styles.list}>
          {view.posts.map((post) => (
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
