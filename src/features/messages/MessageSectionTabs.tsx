/**
 * MessageSectionTabs — the three internal tabs of the Message section.
 *
 * These are NOT the global bottom navigation. They sit directly under the search
 * field and switch between the section's three panes: `all` (every thread),
 * `unread` (threads the server marks unread), and `requests` (the pending
 * message requests). The active tab is signalled by the primary filled-pill
 * treatment — never by colour alone — with a small unread dot on the Unread tab
 * when any thread is unread, backed by `accessibilityState.selected`.
 *
 * The Requests label carries the server's pending count (`Requests (3)`), passed
 * in as a prop; zero renders as plain `Requests` so there is never a `(0)` badge.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { MESSAGE_SECTIONS, sectionLabel, type MessageSectionId } from '@/features/messages/messageSections';
import { colors, layout, radius, spacing } from '@/theme/tokens';

export interface MessageSectionTabsProps {
  active: MessageSectionId;
  /** Server-derived pending request count for the Requests label. */
  pendingCount: number;
  /** Threads with a server-reported `unread_count` above zero. */
  unreadThreadCount: number;
  /** A press switches `active` — every section is a pane of this screen. */
  onSelect: (id: MessageSectionId) => void;
}

export function MessageSectionTabs({ active, pendingCount, unreadThreadCount, onSelect }: MessageSectionTabsProps) {
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {MESSAGE_SECTIONS.map((section) => {
        const isActive = section.id === active;
        const label = sectionLabel(section, pendingCount);
        const showUnreadDot = section.id === 'unread' && unreadThreadCount > 0;
        return (
          <Pressable
            key={section.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={showUnreadDot ? `${label}, ${unreadThreadCount} unread` : label}
            // 48px minimum touch target (§4) even though the visible pill is shorter.
            style={({ pressed }) => [
              styles.tab,
              isActive ? styles.tabActive : styles.tabInactive,
              pressed && styles.pressed,
            ]}
            onPress={() => onSelect(section.id)}>
            <AppText
              variant="small"
              weight={isActive ? 'semibold' : 'regular'}
              tone={isActive ? 'onPrimary' : 'secondary'}
              numberOfLines={1}>
              {label}
            </AppText>
            {showUnreadDot ? (
              <View
                style={styles.unreadDot}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tab: {
    alignItems: 'center',
    borderRadius: radius.full,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: layout.touchTargetSecondary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  tabActive: {
    backgroundColor: colors.colorPrimary,
  },
  tabInactive: {
    backgroundColor: colors.colorBgMuted,
  },
  unreadDot: {
    backgroundColor: colors.colorPrimary,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  pressed: {
    opacity: 0.7,
  },
});
