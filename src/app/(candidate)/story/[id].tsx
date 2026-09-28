/**
 * Story viewer screen for candidates.
 *
 * Full-screen viewer with progress bars, publisher branding, caption card, and
 * an optional "View job" CTA for stories that carry a real opportunity.
 *
 * Two sources, one viewer:
 *  - a **real** story id from `GET /stories`, which records a view through
 *    `POST /stories/{id}/view` and refreshes the cached ring state; and
 *  - a **demo** id (`demo-…`) from `demoStories.ts`, which is resolved locally
 *    and is never sent to the API — no `GET /stories/{id}`, no view POST, and no
 *    cache invalidation, because there is no server row whose state could change.
 *
 * The demo branch is taken from the id before any request, so opening a demo
 * story works even when the stories request itself is still in flight or has
 * failed, and no demo id can ever reach the transport layer.
 */

import { useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { fetchStories, recordStoryView } from '@/api/stories';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { BackButton } from '@/components/ui/BackButton';
import { StoryViewer } from '@/features/stories/StoryViewer';
import { isDemoStory, isDemoStoryId, markDemoStoryViewed } from '@/features/stories/demoStories';
import { useStoryList } from '@/features/stories/useStoryList';
import { colors } from '@/theme/tokens';

import type { StoryItem } from '@/types/story';

export default function StoryScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const storiesQuery = useQuery({
    queryKey: queryKeys.stories,
    queryFn: () => fetchStories(),
  });

  const recordViewMutation = useMutation({
    mutationFn: (storyId: string) => recordStoryView(storyId),
    onSuccess: () => {
      // Refresh stories in cache so ring transitions to 'viewed' immediately
      void queryClient.invalidateQueries({ queryKey: queryKeys.stories });
    },
  });

  const stories = useStoryList(storiesQuery.data?.items);
  const initialIndex = stories.findIndex((s: StoryItem) => s.id === id);
  // Decided from the id alone, before any request is made, so a demo story can
  // never wait on — or be looked up in — the stories API.
  const isDemoTarget = isDemoStoryId(id);

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/home' as never);
    }
  }, [router]);

  const handleStoryViewed = useCallback(
    (story: StoryItem) => {
      if (isDemoStory(story)) {
        // Local session state only: the demo ring is driven from the module
        // store, and nothing is written to the server.
        markDemoStoryViewed(story.id);
        return;
      }
      recordViewMutation.mutate(story.id);
    },
    [recordViewMutation],
  );

  const handleOpenOpportunity = useCallback(
    (opportunityId: string) => {
      router.push(`/jobs/${opportunityId}` as never);
    },
    [router],
  );

  // A demo story is local, so waiting on the stories request would only delay
  // content that is already in hand.
  if (!isDemoTarget && storiesQuery.isPending) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.colorPrimary} />
      </View>
    );
  }

  if (initialIndex === -1) {
    return (
      <View style={styles.centerContainer}>
        <BackButton />
        <AppText variant="body" tone="secondary">
          This story is no longer available.
        </AppText>
      </View>
    );
  }

  return (
    <StoryViewer
      stories={stories}
      initialIndex={initialIndex}
      onClose={handleClose}
      onStoryViewed={handleStoryViewed}
      onOpenOpportunity={handleOpenOpportunity}
    />
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
