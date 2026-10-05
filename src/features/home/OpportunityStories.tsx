/**
 * Opportunity stories — the horizontal stories section under the header.
 *
 * The list it renders is already merged by `useStoryList`: real stories from
 * `GET /stories` first, then the development-only demo stories, which carry a
 * visible DEMO chip on the bubble itself. This component never decides what
 * exists, so the row has no way of inventing content.
 *
 * Per approved product decisions:
 * - Unread ring (primary colour) vs viewed ring (subtle border)
 * - Tapping a bubble opens the existing `/story/[id]` viewer
 * - The `+ Add Opportunity` bubble is removed per agreed plan
 * - **The first bubble is `YourStoryButton`, which opens `/add-story`** (Phase
 *   12). It used to be a generic Create (+) that opened the *post* composer,
 *   which from a row of stories was the wrong destination.
 * - Post creation stays one tap away on the composer card below, so the page
 *   still has both entries — there is just one entry per thing
 * - With demo mode off and no real stories, the honest empty state stands
 */

import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { YourStoryButton } from '@/features/stories/YourStoryButton';
import { styles } from '@/features/home/homeStyles';
import { StoryBubble } from '@/features/stories/StoryBubble';
import type { StoryItem } from '@/types/story';

export interface OpportunityStoriesProps {
  /** Real stories from `GET /stories`, with demo stories appended. */
  stories: readonly StoryItem[];
  /**
   * The caller's own name and avatar, for the `Your story` bubble.
   *
   * Threaded in rather than fetched here, so the bubble shows the same identity
   * the header does — one aggregate, one request, no chance of disagreement.
   */
  name: string;
  avatarUrl: string | null;
}

export function OpportunityStories({ stories, name, avatarUrl }: OpportunityStoriesProps) {
  const router = useRouter();

  return (
    <View style={[styles.section, styles.storiesSection]} testID="opportunity-stories">
      <View style={styles.sectionHeader}>
        <AppText variant="h2" weight="semibold" accessibilityRole="header">
          Stories & Opportunities
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View all opportunities"
          hitSlop={8}
          onPress={() => router.push('/jobs' as never)}>
          <AppText variant="small" weight="medium" tone="accent">
            View all
          </AppText>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.storyRow}>
        {/* **Your story comes first and opens story creation.** It replaced the
            generic Create (+) circle, which opened the *post* composer: from a
            row of stories, the entry that belongs is the one that adds a story.
            Post creation is still one tap away from the composer card below, so
            nothing became harder to reach and one misleading entry disappeared. */}
        <YourStoryButton name={name} avatarUrl={avatarUrl} />
        {stories.map((story) => (
          <StoryBubble
            key={story.id}
            story={story}
            onPress={() => router.push(`/story/${story.id}` as never)}
          />
        ))}
      </ScrollView>

      {stories.length === 0 ? (
        <View style={styles.storiesNote}>
          <AppText variant="caption" tone="tertiary">
            No active stories right now. Be the first — tap Your story.
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

