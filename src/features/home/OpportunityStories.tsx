/**
 * Opportunity stories — the first section on the dashboard.
 *
 * Native reproduction of `OpportunityStories.tsx` / `OpportunityStoryItem.tsx` /
 * `AddOpportunityStoryItem.tsx` and their CSS.
 *
 * **The row is empty by design, and that is the honest state.** The web app
 * declares `candidateStories: OpportunityStory[] = []` for exactly this reason:
 * `/companies/*` is membership-gated so a candidate receives 404, and there is
 * no story or opportunity feed yet. So this screen renders the "Add Opportunity"
 * bubble plus the real empty state, and no fictional company is invented to
 * fill the row. Populating `stories` is the single integration point once a
 * candidate-readable source exists.
 *
 * The bubbles are the one genuinely circular element in the original home
 * design: a 66px circle (68px at ≥1024px) with a 2px border, plus a primary
 * ring and 2px subtle halo when real data says new opportunities exist.
 */

import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { colors } from '@/theme/tokens';
import { STORY_AVATAR, styles } from '@/features/home/homeStyles';

export interface OpportunityStory {
  id: string;
  name: string;
  logoUrl: string | null;
  hasNewOpportunities: boolean;
}

export interface OpportunityStoriesProps {
  /** Real stories. Empty until a candidate-readable source exists. */
  stories: readonly OpportunityStory[];
}

export function OpportunityStories({ stories }: OpportunityStoriesProps) {
  const router = useRouter();

  return (
    <View style={[styles.section, styles.storiesSection]} testID="opportunity-stories">
      <View style={styles.sectionHeader}>
        <AppText variant="h2" weight="semibold" accessibilityRole="header">
          Explore Opportunities
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

      {/*
       * The strip scrolls horizontally while the page itself never does, and its
       * own padding stays inside the viewport so the last bubble is always fully
       * reachable at any width.
       */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.storyRow}>
        <AddOpportunityBubble onOpenJobs={() => router.push('/jobs' as never)} />
        {stories.map((story) => (
          <StoryBubble key={story.id} story={story} />
        ))}
      </ScrollView>

      {stories.length === 0 ? (
        <View>
          <AppText variant="caption" tone="tertiary">
            No opportunities available right now.{' '}
          </AppText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/jobs' as never)}
            hitSlop={8}>
            <AppText variant="caption" weight="medium" tone="accent">
              Explore Jobs
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function StoryBubble({ story }: { story: OpportunityStory }) {
  const router = useRouter();
  const circle = (
    <View style={styles.storyCircle}>
      <Avatar name={story.name} src={story.logoUrl} size={STORY_AVATAR} />
    </View>
  );

  return (
    <View style={styles.storyItem}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${story.name} — view opportunities`}
        style={styles.storyBubble}
        onPress={() => router.push('/jobs' as never)}>
        {story.hasNewOpportunities ? (
          <View style={styles.storyRingNew}>{circle}</View>
        ) : (
          circle
        )}
        <AppText variant="caption" tone="secondary" style={styles.storyName} numberOfLines={2}>
          {story.name}
        </AppText>
        {story.hasNewOpportunities ? (
          <AppText variant="caption" weight="semibold" tone="accent" style={styles.storyNew}>
            New
          </AppText>
        ) : null}
      </Pressable>
    </View>
  );
}

/**
 * The leading create bubble: a dashed primary ring with a plus glyph, built from
 * the same footprint as the company bubbles.
 *
 * A candidate has no employer-only publishing form, so this does not open a
 * compose sheet it cannot submit. It explains the boundary and stays in the app,
 * exactly as the original dialog does.
 */
function AddOpportunityBubble({ onOpenJobs }: { onOpenJobs: () => void }) {
  return (
    <View style={styles.storyItem}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add Opportunity — learn about hiring on MahaJob"
        style={styles.storyBubble}
        onPress={onOpenJobs}>
        <View style={[styles.storyCircle, styles.storyCircleCreate]}>
          <AppIcon
            name={{ ios: 'plus', android: 'add' }}
            size={24}
            color={colors.colorPrimary}
          />
        </View>
        <AppText variant="caption" tone="secondary" style={styles.storyName} numberOfLines={2}>
          Add Opportunity
        </AppText>
      </Pressable>
    </View>
  );
}
