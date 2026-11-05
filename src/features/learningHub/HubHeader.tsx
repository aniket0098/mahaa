/**
 * Learning Hub header — the compact identity row shared by the hub's own
 * surfaces.
 *
 * Carries the one affordance iOS needs in a tabbed destination: a visible way
 * back to the candidate Home area (Android has hardware back). The back
 * control navigates to `/home` directly rather than stepping backwards
 * through hub sections, because from any section "back" means "leave the
 * Learning Hub" — and `/home` is this tree's own candidate home, so it is
 * always a legal destination inside the candidate group.
 *
 * Kept to a single 48-44px-target row so video content, not chrome, owns the
 * screen below it.
 */

import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { colors, layout, spacing } from '@/theme/tokens';

export interface HubHeaderProps {
  title: string;
  subtitle?: string;
  /**
   * Optional section label rendered above the title (e.g. `LEARNING HUB`).
   * Kept as a real uppercase micro-label so screen readers can reach it.
   */
  kicker?: string;
  /**
   * When provided, the search entry point is rendered. It only appears where a
   * real search exists behind it — the Courses screen's `q` filter.
   */
  onSearch?: () => void;
  searchAccessibilityLabel?: string;
  testID?: string;
}

export function HubHeader({
  title,
  subtitle,
  kicker,
  onSearch,
  searchAccessibilityLabel = 'Search courses',
  testID,
}: HubHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View
      testID={testID}
      style={[styles.wrap, { paddingTop: insets.top + spacing.xs }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Home"
        accessibilityHint="Leaves the Learning Hub and returns to your Home feed"
        hitSlop={12}
        onPress={() => router.navigate('/home' as never)}
        style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
        <AppIcon
          name={{ ios: 'chevron.left', android: 'arrow_back' }}
          size={22}
          color={colors.colorPrimary}
        />
      </Pressable>

      <View style={styles.titles}>
        {kicker ? (
          <AppText variant="caption" tone="secondary" uppercase style={styles.kicker}>
            {kicker}
          </AppText>
        ) : null}
        <AppText variant="h3" weight="semibold" numberOfLines={1} accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" tone="secondary" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>

      {onSearch ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={searchAccessibilityLabel}
          accessibilityHint="Opens course search"
          hitSlop={12}
          onPress={onSearch}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
          <AppIcon
            name={{ ios: 'magnifyingglass', android: 'search' }}
            size={22}
            color={colors.colorTextSecondary}
          />
        </Pressable>
      ) : (
        // Keeps the title block optically centred when there is no search entry.
        <View style={styles.headerButton} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.pagePadding,
    paddingBottom: spacing.sm,
  },
  headerButton: {
    width: layout.touchTargetSecondary,
    height: layout.touchTargetSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  titles: {
    flex: 1,
    gap: 4,
  },
  kicker: {
    marginBottom: 2,
  },
});
