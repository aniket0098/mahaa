/**
 * `YourStoryButton` — the first circle in the stories row, and the way a member
 * adds a story.
 *
 * **It shows the caller's own avatar, not a generic plus.** A row of other
 * people's faces should be answered by yours; a blue "+" circle in that row read
 * as "add an opportunity", which is not something this app lets anybody do.
 * Phase 12 made it open `/add-story` — the real, backed creation flow — instead
 * of the generic Create entry that used to open the *post* composer.
 *
 * It never pretends to be a story bubble: there is no unread/viewed ring, because
 * a ring means "you have not seen this" and there is nothing here yet. A small
 * badge carries the affordance instead.
 *
 * The avatar is the caller's, resolved from the profile aggregate Home already
 * fetches — no extra request — and absolutised here because the API serves media
 * as a relative path.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { Animated, Pressable, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { Avatar } from '@/components/ui/Avatar';
import { absoluteMediaUri } from '@/api/media';
import { colors } from '@/theme/tokens';
import { styles } from '@/features/home/homeStyles';

export interface YourStoryButtonProps {
  /** The signed-in member's display name, for the avatar fallback. */
  readonly name: string;
  /** Relative or absolute avatar path from the profile aggregate. */
  readonly avatarUrl?: string | null;
}

export function YourStoryButton({ name, avatarUrl }: YourStoryButtonProps) {
  const router = useRouter();
  const [scale] = useState(() => new Animated.Value(1));

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

  const open = useCallback(() => router.push('/add-story' as never), [router]);
  const avatarSrc = avatarUrl ? absoluteMediaUri(avatarUrl) : null;

  return (
    <Pressable
      style={styles.createContainer}
      onPress={open}
      onPressIn={() => animate(0.93)}
      onPressOut={() => animate(1)}
      accessibilityRole="button"
      accessibilityLabel="Your story"
      accessibilityHint="Create a story for other members to see"
      testID="your-story-button">
      <Animated.View style={[{ transform: [{ scale }] }]}>
        {/* The same geometry as a story bubble, so the row scans as one rhythm. */}
        <View style={styles.createCircle}>
          {/* `56` is the size `StoryBubble` uses, so the two circles are the same
              diameter and the row reads as one rhythm. */}
          <Avatar name={name} src={avatarSrc} size={56} />
          {/* The badge, rather than a plus covering the face: it says "add" without
              hiding who the story would be from. */}
          <View style={styles.createBadge}>
            <AppIcon
              name={{ ios: 'plus', android: 'add' }}
              size={14}
              color={colors.colorTextOnPrimary}
            />
          </View>
        </View>
      </Animated.View>
      <Text style={styles.createLabel} numberOfLines={1} ellipsizeMode="tail">
        Your story
      </Text>
      {/* Spacer keeps the label baseline aligned with story bubbles. */}
      <Animated.View style={styles.createSlot} />
    </Pressable>
  );
}