/**
 * Notifications — the candidate's inbox for connection requests and events.
 *
 * Read from the main backend's `/notifications` router (see
 * `src/api/notifications.ts`): the caller's own rows, newest first, with the
 * server-rendered `title` and optional `body` as their text. Only a
 * `connection_request` addressed to the caller carries Accept / Reject, because
 * that is the one event whose resolution routes exist and whose direction the
 * server enforces — every other type is informational.
 *
 * **Incoming requests live here, not in the Message section.** `GET
 * /connections` is the same data filtered another way, so this screen is one
 * read of the server's own event log rather than a second source of truth for
 * request state. Accepting sends `POST /connections/{id}/accept` and rejecting
 * sends `…/decline`; both wait for the server's answer and then invalidate the
 * inbox, the badge count and the connections list together, which is why the
 * bell, this screen and the Connections screen agree after every taper:
 * they all re-read.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { useMemo, useState } from 'react';

import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { colors, layout, spacing } from '@/theme/tokens';
import { connectionIdFromNotification, type Notification } from '@/api/notifications';
import {
  actorName,
  filterNotificationsByCategory,
  formatNotificationTime,
  isUnread,
  notificationAction,
  notificationSubtitle,
} from '@/features/notifications/notificationModel';
import { useRouter } from 'expo-router';
import type { NotificationCategory } from '@/features/notifications/notificationModel';
import { useUnreadNotificationCount } from '@/features/notifications/useNotifications';
import { useNotifications, type NotificationsView } from '@/features/notifications/useNotifications';

const CATEGORIES: ReadonlyArray<{
  id: NotificationCategory | 'all';
  label: string;
}> = [
  { id: 'all', label: 'All' },
  { id: 'requests', label: 'Requests' },
  { id: 'activity', label: 'Activity' },
];

export default function CandidateNotificationsScreen() {
  const view = useNotifications();
  const router = useRouter();
  const unreadCount = useUnreadNotificationCount();
  const [activeCategory, setActiveCategory] = useState<NotificationCategory | 'all'>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const filteredNotifications = useMemo(() => {
    // 'all' shows the whole inbox; every other tab is one category bucket.
    if (activeCategory === 'all') return view.notifications;
    const all = filterNotificationsByCategory(view.notifications, activeCategory);
    if (!unreadOnly) return all;
    return all.filter((notification) => isUnread(notification));
  }, [view.notifications, activeCategory, unreadOnly]);

  // Requests carries the server's pending count. Every other bucket is purely
  // informational and must never print a number the client cannot have.
  const requestLabel = view.pendingCount > 0 ? `Requests (${view.pendingCount})` : 'Requests';

  return (
    <Screen testID="notifications-screen">
      <BackButton />

      <AppText variant="h1" accessibilityRole="header" style={styles.title}>
        Notifications
      </AppText>

      {view.isLoading ? (
        <View style={styles.stack}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </View>
      ) : null}

      {!view.isLoading && view.loadError ? (
        <StatusBanner
          title="Couldn't load your notifications"
          description={view.loadError}
          onRetry={view.retryLoad}
        />
      ) : null}

      {!view.isLoading && !view.loadError && view.notifications.length === 0 ? (
        <StatusBanner
          tone="info"
          title="You're all caught up"
          description="Connection requests and updates will appear here."
        />
      ) : null}

      {!view.isLoading && !view.loadError && view.notifications.length > 0 ? (
        <>
          {/* Category tabs. Only the Requests tab prints the server's pending
           * count; every other bucket is informational and prints nothing. */}
          <View style={styles.tabBar} accessibilityRole="tablist">
            {CATEGORIES.map((category) => {
              const isActive = category.id === activeCategory;
              const label = category.id === 'requests'
                ? requestLabel
                : category.label;
              return (
                <Pressable
                  key={category.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  onPress={() => setActiveCategory(category.id)}
                  style={({ pressed }) => [
                    styles.tab,
                    isActive ? styles.tabActive : null,
                    pressed && styles.tabPressed,
                  ]}>
                  <AppText
                    variant="small"
                    weight={isActive ? 'semibold' : 'regular'}
                    tone={isActive ? 'onPrimary' : 'secondary'}>
                    {label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          {/* Filters and actions — unread-only display and a single-pass clear.
           * Both are server-truth driven and never optimistically changed. */}
          <View style={styles.toolbar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                unreadOnly
                  ? 'Show all notifications'
                  : 'Show only unread notifications'
              }
              onPress={() => setUnreadOnly((current) => !current)}
              style={styles.toolbarButton}>
              <AppText variant="caption" weight="semibold">
                {unreadOnly ? 'Unread' : 'All'}
              </AppText>
            </Pressable>

            {view.notifications.length > 0 && unreadCount.count > 0 ? (
              <Button
                label="Mark all read"
                variant="ghost"
                onPress={view.markAll}
                style={styles.toolbarButton}
              />
            ) : null}
          </View>

          <View style={styles.list} testID="notifications-list">
            {filteredNotifications.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} view={view} />
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

/**
 * One event, and its resolution when the server says one exists.
 *
 * The name and avatar come from the notification's own `actor` — three fields
 * the server attached, so this row never needs a second request to say who
 * knocked. Tapping anywhere but the action buttons marks the row read; the row
 * body itself navigates nowhere, because a notification is an event log, not a
 * profile link. The full request surface (including a link into the person's
 * profile) stays in `/connections`.
 */
function NotificationRow({
  notification,
  view,
}: {
  notification: Notification;
  view: NotificationsView;
}) {
  const router = useRouter();
  const action = notificationAction(notification);
  const unread = isUnread(notification);
  const busy = view.busyId === action.connectionId && action.connectionId !== null;
  const failed = view.actionErrorId === action.connectionId && action.connectionId !== null;
  const name = actorName(notification);
  const subtitle = notificationSubtitle(notification);
  const time = formatNotificationTime(notification.created_at);

  const open = () => {
    view.markRead(notification);
    const connectionId = connectionIdFromNotification(notification);
    if (connectionId) {
      const connection = view.connections?.find((row) => row.id === connectionId);
      if (connection?.user?.public_id) {
        router.push(`/user/${connection.user.public_id}` as never);
        return;
      }
      router.push('/connections' as never);
      return;
    }
    if (notification.data?.conversation_id) {
      router.push(`/conversation/${notification.data.conversation_id}` as never);
    }
  };

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${notification.title}${unread ? ', unread' : ''}`}
      accessibilityHint={
        action.kind === 'accept'
          ? `Open the sender's profile or the connections list`
          : 'Marks this notification read'
      }
      testID={`notification-${notification.id}`}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}>
      <Avatar
        name={name.length > 0 ? name : 'Notification'}
        src={notification.actor?.avatar_url ?? null}
        size={40}
      />

      <View style={styles.identity}>
        <AppText variant="body" weight={unread ? 'semibold' : 'regular'} numberOfLines={3}>
          {notification.title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" tone="secondary" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
        <View style={styles.meta}>
          {time ? (
            <AppText variant="caption" tone="tertiary">
              {time}
            </AppText>
          ) : null}
          {unread ? (
            <View
              style={styles.unreadDot}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          ) : null}
        </View>

        {/*
          The only actions this build offers live here, and only when the
          notification's own `data` names the connection to resolve. Both wait
          for the server; the row stays (with a busy affordance) until the
          refetch removes or reconciles it — nothing above is optimistically
          dismissed.
        */}
        {action.kind === 'accept' && action.connectionId ? (
          <View style={styles.actions}>
            <Button
              label="Accept"
              loading={busy}
              disabled={busy}
              accessibilityHint={`Accepts the connection request from ${name}`}
              onPress={() => view.accept(notification)}
              style={styles.action}
            />
            <Button
              label="Reject"
              variant="ghost"
              disabled={busy}
              accessibilityHint={`Rejects the connection request from ${name}`}
              onPress={() => view.reject(notification)}
              style={styles.action}
            />
          </View>
        ) : null}

        {failed && view.actionError ? (
          <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {view.actionError}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: {
    marginBottom: spacing.lg,
    marginTop: spacing.sm,
  },
  stack: {
    gap: spacing.md,
  },
  row: {
    alignItems: 'flex-start',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: layout.touchTargetSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowPressed: {
    opacity: 0.85,
  },
  identity: {
    flex: 1,
    gap: spacing.xs,
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  unreadDot: {
    // Never the only signal — the title is semibold when unread — but a visual
    // the sighted eye scans for in a list.
    backgroundColor: colors.colorPrimary,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  action: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.colorPrimarySubtle,
  },
  tabPressed: {
    opacity: 0.8,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  toolbarButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
});