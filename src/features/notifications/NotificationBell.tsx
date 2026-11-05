/**
 * `NotificationBell` — the Home header's bell, with the server's unread count.
 *
 * The number comes from `GET /notifications/unread-count` and from nowhere else:
 * the component never counts rows, never decrements on a tap, and never invents
 * a dot. Zero and "unknown" both render no badge, so a failed fetch cannot leave
 * a stale number hanging over the header.
 *
 * The badge is `9+` above nine rather than a growing number — a header that
 * reflowed because somebody had 1,204 notifications would be a layout bug
 * dressed as a feature — and the same number is in the accessible label in
 * words, so the badge is not the only way to read it.
 *
 * Refreshing is deliberately not a timer. The count is invalidated when a
 * `notification.created` event arrives (the realtime bridge already targets this
 * key), on connection actions resolving, and by React Query's own focus
 * refetching when the reader returns to the app — three moments when the number
 * can genuinely have changed, instead of a poll every few seconds.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { colors, layout, radius, typography } from '@/theme/tokens';
import { badgeAccessibilityLabel, badgeLabel } from '@/features/notifications/notificationModel';

export interface NotificationBellProps {
  /** The server's unread count. Zero or a failed fetch both mean "no badge". */
  count: number;
  /** True when the request is in flight; suppresses the badge until it lands. */
  isLoading?: boolean;
  onPress: () => void;
}

export function NotificationBell({ count, isLoading = false, onPress }: NotificationBellProps) {
  const label = badgeLabel(count);
  const accessibleLabel = badgeAccessibilityLabel(count);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        hitSlop={layout.hitSlop}
        // 48px minimum target (§4), matching the other header controls, so the
        // icon's 22px box does not decide how big the tap area is.
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={accessibleLabel}
        accessibilityHint="Opens notifications">
        <AppIcon
          name={{ ios: 'bell', android: 'notifications' }}
          size={22}
          color={colors.colorTextPrimary}
        />
      </Pressable>
      {/*
        Rendered only while a real count is known. `isLoading` hides it rather
        than showing a zero, so a badge cannot flash "1" from a previous session
        and then vanish.
      */}
      {!isLoading && label !== null ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.touchTargetPrimary,
    minWidth: layout.touchTargetPrimary,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.touchTargetPrimary,
    minWidth: layout.touchTargetPrimary,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.colorDanger,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.colorBgSurface,
    justifyContent: 'center',
    left: '58%',
    minWidth: 18,
    paddingHorizontal: 4,
    position: 'absolute',
    top: '22%',
  },
  badgeText: {
    color: colors.colorOnPrimary,
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightSemibold,
    lineHeight: 14,
    textAlign: 'center',
  },
});
