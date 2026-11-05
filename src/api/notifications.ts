/**
 * Notifications API — §13's four read routes, and the first mobile caller they
 * have had.
 *
 * Binds to the `/notifications` router in
 * `backend/app/api/v1/endpoints/notifications.py`. Nothing here is invented:
 * every function maps to a line that exists there, and the shapes come from
 * `backend/app/schemas/notifications.py` (`NotificationRead`, `NotificationPage`,
 * `UnreadCount`).
 *
 * **There is no write-a-notification route, and that is the contract.** Every
 * notification is a side effect of a connection or messaging operation — the
 * actor and recipient are derived server-side from the token and the state
 * machine. So this module reads, and it marks read; it never creates.
 *
 * Three rules the server owns and this module must not re-implement:
 *
 *  - **The count is the server's.** `GET /notifications/unread-count` is the only
 *    source for a badge. A client that tallied its own inbox would drift from it
 *    the moment a page was truncated, which is exactly the failure §13/§22 order
 *    the count endpoint to prevent.
 *  - **`actor` is narrower than `UserSummary`.** §13.2 gives it three fields —
 *    `user_id`, `name`, `avatar_url`. There is deliberately no `public_id` and no
 *    `username`, so a notification row can never be navigated by handle; routing
 *    to the person goes through the connection row the notification points at
 *    (`data.connection_id`) or through `GET /users/lookup`, not through the
 *    notification payload.
 *  - **`title` is a server-rendered sentence, `body` is optional detail.** The
 *    client renders both as they arrive (§13.2: "never a rendered message" applies
 *    to `data`, which is ids only) and never rewrites them.
 *
 * `data` is an open object of ids (`{connection_id}` for a connection event), so
 * the client reads a key defensively rather than trusting a shape it declared.
 */

import { apiClient } from '@/api/client';

/**
 * The person who caused this — §13.2's three fields exactly.
 *
 * Null only for a `system` notification, or one whose actor has since been
 * deleted, so "not shown" and "shown and empty" stay distinguishable.
 */
export interface NotificationActor {
  user_id: string;
  name: string;
  avatar_url: string | null;
}

/**
 * The notification types the client acts on.
 *
 * Kept as string literals rather than an imported enum so a new server type is
 * an additive change here rather than a compile error — an unknown type renders
 * its own `title` and offers no action, which is the honest fallback.
 */
export type NotificationType =
  | 'connection_request'
  | 'connection_accepted'
  | 'message'
  | (string & {});

export interface Notification {
  id: string;
  type: NotificationType;
  actor: NotificationActor | null;
  target_type: string | null;
  target_id: string | null;
  title: string;
  body: string | null;
  /** Ids only, never a rendered sentence. `{connection_id}` for a connection. */
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

/**
 * A keyset page of notifications.
 *
 * Unlike the messaging envelope this carries a real `total` — §13.3 requires the
 * full count, not the page length, because this is the list a "new" figure is
 * read from. The count itself is still fetched separately; see {@link unreadCount}.
 */
export interface NotificationPage {
  items: Notification[];
  total: number;
  limit: number;
  next_cursor: string | null;
  has_more: boolean;
}

export interface UnreadCountResponse {
  count: number;
}

/**
 * One page of the caller's own notifications, newest first.
 *
 * Recipient scoping is in the server query, so there is no parameter through
 * which another account's inbox could be requested.
 */
export function listNotifications(
  options: { cursor?: string | null; limit?: number; unreadOnly?: boolean } = {},
): Promise<NotificationPage> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  // Only sent when true, so the default page is not marked with a redundant flag.
  if (options.unreadOnly) params.set('unread_only', 'true');
  const query = params.toString();
  return apiClient.get<NotificationPage>(`/notifications${query ? `?${query}` : ''}`);
}

/**
 * The number a badge draws — §13, built by the server before any badge exists.
 *
 * A bare `{count}`, so a screen refreshes the badge without re-reading the list.
 */
export function unreadCount(): Promise<UnreadCountResponse> {
  return apiClient.get<UnreadCountResponse>('/notifications/unread-count');
}

/**
 * Mark one notification read. The caller's own, or 404.
 *
 * Repeating it is a no-op rather than an error, so a tap whose response was lost
 * can be retried safely. Read state is monotonic — there is no un-read verb.
 */
export function markNotificationRead(notificationId: string): Promise<void> {
  return apiClient.post<void>(`/notifications/${notificationId}/read`);
}

/** Mark every notification of the caller's read. 204, no body. */
export function markAllNotificationsRead(): Promise<void> {
  return apiClient.post<void>('/notifications/read-all');
}

/**
 * The connection row a notification points at, or null.
 *
 * `data` is ids only, and this reads the one key a connection event carries. It
 * is defensive on purpose: a notification type this build does not know about
 * returns null rather than pretending to have a connection to act on.
 */
export function connectionIdFromNotification(notification: Notification): string | null {
  const raw = notification.data?.connection_id;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}
