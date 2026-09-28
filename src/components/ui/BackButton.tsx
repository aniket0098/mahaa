/**
 * Back — the navigation affordance for a detail route.
 *
 * Detail routes are reached by pushing onto the current role's tree, and
 * expo-router's `Tabs` renders no header of its own (`headerShown: false`
 * everywhere in this app, by design), so without this control a detail screen
 * has no visible way out on iOS: there is no header back button, and a tab bar
 * does not support the edge-swipe gesture.
 *
 * The destination falls back to the signed-in role's own home when there is no
 * history to pop — a cold start straight into a deep link, or a browser-style
 * refresh. A back control that silently does nothing would be worse than no
 * control at all, and so would one that pushed the user into the other role's
 * tree, so the fallback resolves through {@link homePathForRole} rather than a
 * fixed path.
 */

import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { useAuth } from '@/auth/AuthContext';
import { homePathForRole } from '@/auth/roleHome';
import { colors, spacing } from '@/theme/tokens';

export interface BackButtonProps {
  /** Accessible name and visible text. */
  label?: string;
  /**
   * Replaces the default navigation.
   *
   * Only for a screen that must do something first — the composer asks whether
   * to discard an unfinished post before it will leave. The control stays a back
   * button in every other respect, including the role-aware fallback, which the
   * composer re-implements by calling `router.back()`/`router.replace()` itself.
   */
  onPress?: () => void;
}

export function BackButton({ label = 'Back', onPress }: BackButtonProps) {
  const router = useRouter();
  const { principal } = useAuth();

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(homePathForRole(principal?.role ?? 'candidate') as never);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      // 44px inline-secondary minimum target; the visible row is padded to it.
      hitSlop={12}
      onPress={onPress ?? goBack}
      style={({ pressed }) => [styles.back, pressed ? styles.pressed : null]}>
      <AppIcon
        name={{ ios: 'chevron.left', android: 'arrow_back' }}
        size={20}
        color={colors.colorPrimary}
      />
      <AppText variant="small" weight="semibold" tone="accent">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
});