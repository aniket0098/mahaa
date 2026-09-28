/**
 * Create-post entry — the first circle in the stories row.
 *
 * A blue circle with a white plus and a "Create" label, sized to match the
 * 68px story bubbles so the row scans as one rhythm. It opens the existing
 * `/add-post` screen, which is an honest StageScreen notice until the posts
 * API exists — this button never submits anything itself.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { Animated, Pressable, Text } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { colors } from '@/theme/tokens';
import { styles } from '@/features/home/homeStyles';

export function CreatePostButton() {
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

  return (
    <Pressable
      style={styles.createContainer}
      onPress={() => router.push('/add-post' as never)}
      onPressIn={() => animate(0.93)}
      onPressOut={() => animate(1)}
      accessibilityRole="button"
      accessibilityLabel="Create a post"
      accessibilityHint="Opens the post creation screen">
      <Animated.View style={[{ transform: [{ scale }] }]}>
        <Animated.View style={styles.createCircle}>
          <AppIcon
            name={{ ios: 'plus', android: 'add' }}
            size={28}
            color={colors.colorTextOnPrimary}
          />
        </Animated.View>
      </Animated.View>
      <Text style={styles.createLabel} numberOfLines={1} ellipsizeMode="tail">
        Create
      </Text>
      {/* Spacer keeps the label baseline aligned with story bubbles. */}
      <Animated.View style={styles.createSlot} />
    </Pressable>
  );
}
