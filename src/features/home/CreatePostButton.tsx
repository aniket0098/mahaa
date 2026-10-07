/**
 * CreatePostButton — the compact blue (+) circle beside `Your story`.
 *
 * **It replaces the old Home composer card** ("What are you working on?"), which
 * was a full-width prompt plus a row of type chips. That card is gone; this is the
 * one tappable entry to the same `/add-post` screen, kept deliberately small so the
 * stories row stays a row of circles rather than growing a second card.
 *
 * It navigates rather than composing here: `/add-post` owns the draft, the upload
 * state machine and validation, so there is exactly one definition of a publishable
 * post. `accessibilityLabel` names the action because a bare "+" icon says nothing
 * to a screen reader.
 */

import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { colors } from '@/theme/tokens';
import { styles } from '@/features/home/homeStyles';

export function CreatePostButton() {
  const router = useRouter();
  const open = useCallback(() => router.push('/add-post' as never), [router]);

  return (
    <Pressable
      style={styles.createContainer}
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel="Create post"
      accessibilityHint="Opens the post composer"
      testID="create-post-button">
      <View style={styles.createPostCircle}>
        <AppIcon
          name={{ ios: 'plus', android: 'add' }}
          size={28}
          color={colors.colorTextOnPrimary}
        />
      </View>
      {/* Reserves the label height so the circle shares the row's baseline. */}
      <View style={styles.createPostSpacer} />
    </Pressable>
  );
}