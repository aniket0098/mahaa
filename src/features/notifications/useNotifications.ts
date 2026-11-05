/**
 * `useNotifications` — the inbox's data and its two actions.
 *
 * One `GET /notifications` page and one `GET /notifications/unread-count` are
 * the whole read side, and the count is always the server's: this hook never
 * tallies rows, never decrements on a tap, and never keeps a number a failed
 * refetch could not confirm. The badge and the list are separate queries so a
 * screen that only draws the badge does not pay for the list.
 *
 * **Accept and Reject change a row only after the server confirms.** React Query
 * locks the mutation, so a second tap on the same row is a no-op; the row leaves
 * the actionable set through the post-success invalidation, which refetches the
 * list, the count and the caller's connections together — so the bell, this
 * inbox and the Connections screen all reconcile to one server truth instead of
 * three clients guessing.
 *
 * A 409 means the request was already settled somewhere else (another session, a
 * double network delivery). It is not retried as a user error: the invalidation
 * is triggered and the server's state wins, which is the same rule the
 * Connections screen and the message-request hook already follow.
 */

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { acceptConnection, declineConnection, listConnections } from '@/api/connections';
import { ApiError } from '@/api/errors';
import { listNotifications, markAllNotificationsRead, markNotificationRead, unreadCount } from '@/api/notifications';
import type { Connection } from '@/types/onboarding';
import type { Notification } from '@/api/notifications';
import { queryKeys } from '@/api/queryKeys';
import { isAppNotification, notificationAction, pendingActionableIds } from '@/features/notifications/notificationModel';
import { messagingQueryKeys, notificationQueryKeys } from '@/realtime/queryBridge';

/** Page size for the inbox. The server's default is the same, asked for once. */
const NOTIFICATION_PAGE_LIMIT = 30;

export interface NotificationsView {
  notifications: Notification[];
  isLoading: boolean;
  /** A persistent load error message, or null. */
  loadError: string | null;
  /** The id of the row whose action is currently on the wire. */
  busyId: string | null;
  /** The last accept/reject failure, cleared by dismissActionError. */
  actionError: string | null;
  /** The id of the row whose action failed, for a per-row banner. */
  actionErrorId: string | null;
  accept: (notification: Notification) => void;
  reject: (notification: Notification) => void;
  /** Mark one row read — what a tap on a non-actionable row does. */
  markRead: (notification: Notification) => void;
  dismissActionError: () => void;
  retryLoad: () => void;
  /** The caller's live connection rows (also the seed source for Messages). */
  connections: Connection[] | null;
  /** Server-confirmed pending requests still actionable by the caller. */
  pendingCount: number;
  /** Mark every inbox row read. */
  markAll: () => void;
}

/**
 * Everything a notification change must refresh, as one call.
 *
 * A connection resolution is the clearest example of why this is one call and not
 * three: accepting removes the row, drops the badge by one, flips the sender's
 * pill to Connected, and — because a connection now exists — can make that person
 * eligible for a conversation. Invalidating a subset would leave exactly one of
 * those four lying.
 */
function useInvalidateNotifications() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list });
    void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unreadCount });
    void queryClient.invalidateQueries({ queryKey: queryKeys.connectionsRoot });
    // A newly accepted connection may make someone messageable, and the
    // conversation list is the main API's answer to that. Same key the realtime
    // bridge marks stale, so no second cache exists.
    void queryClient.invalidateQueries({ queryKey: messagingQueryKeys.conversations });
  }, [queryClient]);
}

export function useNotifications(): NotificationsView {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateNotifications();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionErrorId, setActionErrorId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: notificationQueryKeys.list,
    queryFn: () => listNotifications({ limit: NOTIFICATION_PAGE_LIMIT }),
  });

  // The caller's live connection rows — also the seed source for the Message
  // section's idle seeds. One read, shared with the inbox's pending tally.
  const connectionsQuery = useQuery({
    queryKey: queryKeys.connectionsRoot,
    queryFn: () => listConnections(),
  });

  const resolve = useMutation({
    mutationFn: ({
      connectionId,
      action,
    }: {
      connectionId: string;
      action: 'accept' | 'reject';
    }) => (action === 'accept' ? acceptConnection(connectionId) : declineConnection(connectionId)),
    onSuccess: () => {
      setActionError(null);
      setActionErrorId(null);
      invalidate();
    },
    onError: (error, variables) => {
      setActionErrorId(variables.connectionId);
      if (error instanceof ApiError && error.isConflict) {
        // Already settled elsewhere: let the server's state replace the row.
        invalidate();
        setActionError('That request was already handled. Refreshing…');
      } else {
        setActionError(
          error instanceof ApiError
            ? error.message
            : 'That request could not be updated. Please try again.',
        );
      }
    },
  });

  const accept = useCallback(
    (notification: Notification) => {
      const action = notificationAction(notification);
      // The row must be actionable, and one action at a time — a mutation in
      // flight makes a second tap a no-op rather than a duplicate request the
      // server would have to dedupe.
      if (!action.enabled || !action.connectionId || resolve.isPending) return;
      resolve.mutate({
        connectionId: action.connectionId,
        action: 'accept',
      });
    },
    [resolve],
  );

  const reject = useCallback(
    (notification: Notification) => {
      const action = notificationAction(notification);
      if (!action.enabled || !action.connectionId || resolve.isPending) return;
      resolve.mutate({
        connectionId: action.connectionId,
        action: 'reject',
      });
    },
    [resolve],
  );

  const markRead = useCallback(
    (notification: Notification) => {
      if (notification.is_read) return;
      void markNotificationRead(notification.id)
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list });
          void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unreadCount });
        })
        // A failed mark-read is not worth a banner: read state is monotonic and
        // the next visit re-reads it, so swallowing this beats blocking a tap.
        .catch(() => undefined);
    },
    [queryClient],
  );

  const markAll = useCallback(() => {
    void markAllNotificationsRead()
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list });
        void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unreadCount });
      })
      .catch(() => undefined);
  }, [queryClient]);

  const dismissActionError = useCallback(() => {
    setActionError(null);
    setActionErrorId(null);
  }, []);

  const retryLoad = useCallback(() => void list.refetch(), [list]);

  const notifications = useMemo(
    () => (list.data?.items ?? []).filter(isAppNotification),
    [list.data],
  );
  const loadError = list.isError && list.error instanceof Error ? list.error.message : null;

  return {
    notifications,
    isLoading: list.isPending,
    loadError,
    busyId: resolve.isPending ? (resolve.variables?.connectionId ?? null) : null,
    actionError,
    actionErrorId,
    accept,
    reject,
    markRead,
    markAll,
    connections: connectionsQuery.data ?? null,
    pendingCount: pendingActionableIds(notifications, connectionsQuery.data).length,
    dismissActionError,
    retryLoad,
  };
}

/**
 * The bell's number, and nothing else.
 *
 * Separate from {@link useNotifications} so the header does not fetch the inbox
 * to draw a badge. React Query's own focus/online refetching is left enabled —
 * the same "refresh when the reader comes back" behaviour the Home screen gets
 * from its focus effect — so the count is corrected on return rather than on a
 * timer. No polling interval is set: a badge that polled every few seconds would
 * be one request per user per interval for a number that changes when an event
 * arrives, and the realtime bridge already invalidates this key on that event.
 */
export function useUnreadNotificationCount() {
  const query = useQuery({
    queryKey: notificationQueryKeys.unreadCount,
    queryFn: () => unreadCount(),
    staleTime: 15_000,
  });

  return {
    count: query.data?.count ?? 0,
    isLoading: query.isPending,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}

