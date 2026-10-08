/**
 * Story bubble — **one circle per person**, carrying the only state the row has
 * to communicate: the group's ring.
 *
 * The bubble receives a {@link StoryGroup} (all of one author's stories), not a
 * single story: three stories by one person must render as one circle, and the
 * circle represents the whole group — tapping it opens the group.
 *
 * Ring rules, from `storyGroups.ts`:
 * - group contains a `job` or `internship` story → **premium gold** ring;
 * - every story in the group is viewed → the ring mutes (gold dims to
 *   `ringPremiumViewed`, standard to `ringViewed`);
 * - otherwise → MahaJob blue (`ringUnread`).
 *
 * A demo group is drawn by the same component as a real one and is told apart
 * by a visible DEMO chip — never by borrowing `verified`, which is always false
 * for demo content. The chip occupies a fixed slot either way, so adding it
 * does not shift the rest of the row.
 */

import { useCallback, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { Avatar } from '@/components/ui/Avatar';
import { colors } from '@/theme/tokens';
import { DEMO_STORY_BADGE, isDemoStory } from './demoStories';
import { storyGroupRing, type StoryGroup } from './storyGroups';
import { storyStyles } from './storyStyles';

export interface StoryBubbleProps {
  readonly group: StoryGroup;
  readonly onPress: () => void;
}

export function StoryBubble({ group, onPress }: StoryBubbleProps) {
  // A lazy state initialiser, not a ref: the animated value is read during
  // render, and reading a ref there is what the react-hooks lint rules forbid.
  const [scale] = useState(() => new Animated.Value(1));

  const isViewed = group.allViewed;
  const ring = storyGroupRing(group);
  const isDemo = group.stories.some(isDemoStory);
  const isVerified = group.verified;

  // A press nudge, and nothing more: the row is scanned, not animated at.
  const animate = useCallback(
    (toValue: number) =>
      Animated.spring(scale, {
        toValue,
        useNativeDriver: true,
        speed: 40,
        bounciness: 0,
      }).start(),
    [scale],
  );

  const ringStyle =
    ring === 'premium'
      ? isViewed
        ? storyStyles.ringPremiumViewed
        : storyStyles.ringPremium
      : isViewed
        ? storyStyles.ringViewed
        : storyStyles.ringUnread;

  const storyCount = group.stories.length;
  const premium = ring === 'premium';

  return (
    <Pressable
      style={storyStyles.bubbleContainer}
      onPress={onPress}
      onPressIn={() => animate(0.93)}
      onPressOut={() => animate(1)}
      accessibilityRole="button"
      accessibilityLabel={`${group.name} stories, ${storyCount} ${
        storyCount === 1 ? 'story' : 'stories'
      }, ${isViewed ? 'viewed' : 'unread'}${premium ? ', includes a job or internship' : ''}${
        isDemo ? ', demo content' : ''
      }`}
      accessibilityHint="Opens this person's stories">
      <Animated.View style={{ transform: [{ scale }] }}>
        <View style={[storyStyles.ringContainer, ringStyle]}>
          <View style={storyStyles.avatarInner}>
            <Avatar src={group.logoUrl} name={group.name} size={56} />
          </View>

          {isVerified && (
            <View style={storyStyles.badgeContainer}>
              <View style={storyStyles.verifiedBadge}>
                <AppIcon
                  name={{ ios: 'checkmark', android: 'check' }}
                  size={10}
                  color={colors.colorTextOnPrimary}
                />
              </View>
            </View>
          )}
        </View>
      </Animated.View>

      <Text
        style={[storyStyles.label, isViewed && storyStyles.labelViewed]}
        numberOfLines={1}
        ellipsizeMode="tail">
        {group.name}
      </Text>

      {/* The slot is always reserved so every bubble in the row is the same
          height, whether or not it carries the chip. */}
      <View style={storyStyles.labelSlot}>
        {isDemo ? (
          <View style={storyStyles.demoChip}>
            <Text style={storyStyles.demoChipText}>{DEMO_STORY_BADGE}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
