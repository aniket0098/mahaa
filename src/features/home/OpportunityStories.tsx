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
 * - The Create (+) entry is the page's only publishing entry point
 * - With demo mode off and no real stories, the honest empty state stands
 */

import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { CreatePostButton } from '@/features/home/CreatePostButton';
import { styles } from '@/features/home/homeStyles';
import { StoryBubble } from '@/features/stories/StoryBubble';
import type { StoryItem } from '@/types/story';

export interface OpportunityStoriesProps {
  /** Real stories from `GET /stories`, with demo stories appended. */
  stories: readonly StoryItem[];
}

export function OpportunityStories({ stories }: OpportunityStoriesProps) {
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
        <CreatePostButton />
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
            No active stories right now. Check back soon for company announcements!
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

