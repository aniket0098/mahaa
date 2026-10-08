/**
 * Story viewer screen for candidates.
 *
 * Resolves the tapped story id into a **group** (one person's stories, oldest
 * first) and hands `StoryViewer` the whole grouped list plus an opening
 * position — so the viewer walks story → story → next person without ever
 * coming back here for data.
 *
 * Two sources, one viewer:
 *  - a **real** story id from `GET /stories`, which records a view through
 *    `POST /stories/{id}/view` and refreshes the cached ring state; and
 *  - a **demo** id (`demo-…` from `demoStories.ts`), resolved locally and
 *    never sent to the API — no view POST, no cache invalidation.
 *
 * **The record-view callback is built from react-query's stable `mutate`
 * reference** — never from the whole mutation object, which is a fresh object
 * every render. Combined with `StoryViewer`'s record-once-per-story-id effect,
 * this is the fix for the production crash: the old chain
 * (unstable callback → effect re-fire → POST → invalidate → refetch →
 * re-render → …) ended in "Maximum update depth exceeded" and a dead Android
 * process about a second after the caption appeared.
 */

import { useCallback, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { fetchStories, recordStoryView } from '@/api/stories';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { BackButton } from '@/components/ui/BackButton';
import { StoryViewer } from '@/features/stories/StoryViewer';
import { isDemoStory, isDemoStoryId, markDemoStoryViewed } from '@/features/stories/demoStories';
import { groupStoriesByAuthor, positionForStoryId } from '@/features/stories/storyGroups';
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
      // Refresh the stories cache so the ring transitions to 'viewed'. Safe to
      // do repeatedly *now*: nothing re-fires the mutation on a refetch — the
      // viewer records each story id exactly once.
      void queryClient.invalidateQueries({ queryKey: queryKeys.stories });
    },
  });
  // react-query guarantees `mutate` is referentially stable; depending on the
  // mutation object (a new object per render) was half of the crash loop.
  const mutateRecordView = recordViewMutation.mutate;

  const storyItems = useStoryList(storiesQuery.data?.items);
  // Grouping lives in a pure module; the screen only positions the viewer.
  const groups = useMemo(() => groupStoriesByAuthor(storyItems), [storyItems]);
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
      mutateRecordView(story.id);
    },
    [mutateRecordView],
  );

  const handleOpenOpportunity = useCallback(
    (opportunityId: string) => {
      router.push(`/jobs/${opportunityId}` as never);
    },
    [router],
  );

  // The tapped id → its group + the first unviewed story in that group, so a
  // partially-watched person resumes where they stopped.
  const position = useMemo(() => (id ? positionForStoryId(groups, id) : null), [groups, id]);

  // A demo story is local, so waiting on the stories request would only delay
  // content that is already in hand.
  if (!isDemoTarget && storiesQuery.isPending) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.colorPrimary} />
      </View>
    );
  }

  if (!position) {
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
      groups={groups}
      initialPosition={position}
      onClose={handleClose}
      onStoryViewed={handleStoryViewed}
      onOpenOpportunity={handleOpenOpportunity}
    />
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    backgroundColor: colors.colorTextPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
