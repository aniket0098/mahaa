/**
 * Story bubble — one publisher circle with a ring that carries the only state
 * the row has to communicate: unread (primary accent) or viewed (muted border).
 *
 * A demo story is drawn by the same component as a real one — the row never has
 * a second, parallel bubble — and is told apart by a visible DEMO chip, because
 * `verified` is always false for demo content and must never be borrowed to
 * mark it. The chip occupies a fixed slot either way, so adding it does not
 * shift the rest of the row.
 */

import { useCallback, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { Avatar } from '@/components/ui/Avatar';
import { colors } from '@/theme/tokens';
import type { StoryItem } from '@/types/story';
import { DEMO_STORY_BADGE, isDemoStory } from './demoStories';
import { storyStyles } from './storyStyles';

export interface StoryBubbleProps {
  readonly story: StoryItem;
  readonly onPress: () => void;
}

export function StoryBubble({ story, onPress }: StoryBubbleProps) {
  // A lazy state initialiser, not a ref: the animated value is read during
  // render, and reading a ref there is what the react-hooks lint rules forbid.
  const [scale] = useState(() => new Animated.Value(1));

  const isViewed = story.viewed;
  const isDemo = isDemoStory(story);
  const isVerified = story.publisher.verified;

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

  return (
    <Pressable
      style={storyStyles.bubbleContainer}
      onPress={onPress}
      onPressIn={() => animate(0.93)}
      onPressOut={() => animate(1)}
      accessibilityRole="button"
      accessibilityLabel={`${story.publisher.name} story, ${isViewed ? 'viewed' : 'unread'}${
        isDemo ? ', demo content' : ''
      }`}
      accessibilityHint="Opens the full story">
      <Animated.View style={{ transform: [{ scale }] }}>
        <View
          style={[
            storyStyles.ringContainer,
            isViewed ? storyStyles.ringViewed : storyStyles.ringUnread,
          ]}>
          <View style={storyStyles.avatarInner}>
            <Avatar
              src={story.publisher.logoUrl}
              name={story.publisher.name}
              size={56}
            />
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
        {story.publisher.name}
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
