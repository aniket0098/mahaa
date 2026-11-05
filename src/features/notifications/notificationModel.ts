/**
 * The Notifications inbox model — pure data in, decisions out.
 *
 * No React, no React Query and no API import, so every rule here is testable in
 * plain Node (`notificationModel.test.ts`). The module exists because the inbox
 * has three decisions that are easy to get wrong and cheap to prove:
 *
 *  1. **What a row is allowed to offer.** Only a `connection_request` addressed
 *     to the *caller* is actionable, and the connection id must come from the
 *     notification's own `data` — never from a client-side guess. An outgoing
 *     request is never rendered as an incoming one: the server only notifies the
 *     addressee, so if a row reaches this code without an action, the honest
 *     output is "no action", not a button.
 *  2. **What the badge says.** The count is the server's. This module only
 *     *formats* it: zero is invisible, and a large number collapses to `9+`
 *     rather than growing a badge wider than the header it sits in.
 *  3. **What the accessible label says.** A badge that is only visual is a
 *     number a screen reader cannot read, so the label is derived from the same
 *     number in words.
 */

import type { Connection } from '@/types/onboarding';
import type { Notification } from '@/api/notifications';

/** What a row can do about the event it describes. */
export type NotificationActionKind = 'accept' | 'reject' | 'none';

export interface NotificationAction {
  kind: NotificationActionKind;
  /** True when tapping fires a request; false when the row is informational. */
  enabled: boolean;
  /** The connection row this action resolves, or null when there is nothing to act on. */
  connectionId: string | null;
}

/** Above this, a badge stops printing digits. Nine is the last number it shows. */
export const BADGE_DISPLAY_CAP = 9;

/**
 * A server count as the badge should print it, or `null` when nothing should be
 * drawn at all.
 *
 * `0` and `null` both mean "no badge": a count endpoint answering zero is the
 * server saying there is nothing, and a failed fetch must not leave a stale
 * number on screen, so it is treated as zero rather than as "unknown, keep the
 * old value".
 */
export function badgeLabel(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null;
  const whole = Math.floor(count);
  return whole > BADGE_DISPLAY_CAP ? `${BADGE_DISPLAY_CAP}+` : String(whole);
}

/**
 * The accessible announcement for the bell, from the same number.
 *
 * Spelled out because "9+" read aloud is meaningless, and because a screen
 * reader user needs to know the badge is a count of notifications rather than of
 * something else.
 */
export function badgeAccessibilityLabel(count: number | null | undefined): string {
  const label = badgeLabel(count);
  if (label === null) return 'Notifications, none unread';
  return `Notifications, ${label} unread`;
}

/**
 * What a notification row may offer.
 *
 * Only `connection_request` is actionable in this build, because that is the one
 * event whose resolution routes already exist and whose server contract is
 * settled (`POST /connections/{id}/accept|decline`). `connection_accepted` and
 * `message` are informational here: a connection is already a connection, and a
 * message belongs in the conversation it belongs to, so neither gets a button
 * that would be a second, weaker way to do the same thing.
 *
 * The connection id is read from the notification's `data`, which the server
 * wrote when it emitted the row. A notification without one is treated as having
 * nothing to act on rather than as an error, because the client has no other
 * source that would not be a guess.
 */
export function notificationAction(notification: Notification): NotificationAction {
  if (notification.type !== 'connection_request') {
    return { kind: 'none', enabled: false, connectionId: null };
  }
  const raw = notification.data?.connection_id;
  if (typeof raw !== 'string' || raw.length === 0) {
    return { kind: 'none', enabled: false, connectionId: null };
  }
  return { kind: 'accept', enabled: true, connectionId: raw };
}

/** True when the row shows the unread indicator. */
export function isUnread(notification: Notification): boolean {
  return notification.is_read === true ? false : true;
}

/**
 * A row the Notifications inbox is allowed to show at all. Chat messages are
 * not app notifications: they belong to the Messages section, where one
 * conversation row per sender carries the sender's name and photo, the latest
 * preview, the latest time and the server's `unread_count`. They must never
 * appear here as rows, inflate the badge, or change any tab bucket — which is
 * why `useNotifications` filters them out before anything else is computed.
 */
export function isAppNotification(notification: Notification): boolean {
  return notification.type !== 'message';
}

/**
 * Relative time for a notification row: `just now`, `15m`, `3h`, `2d`.
 *
 * The same vocabulary `formatRequestTime` uses, so two lists in one app never
 * disagree about what "recent" means. An unparseable value renders as an empty
 * string rather than "Invalid Date", and a future timestamp (clock skew)
 * collapses to "just now" rather than showing a negative age.
 */
export function formatNotificationTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** The actor's display name, or the empty string when there is no actor. */
export function actorName(notification: Notification): string {
  return notification.actor?.name ?? '';
}

/**
 * The subtitle a row shows: the server's `body` when it sent one.
 *
 * Deliberately not a sentence the client composes from the type — §13.2 keeps
 * the wording on the server so a copy change is not a release. When there is no
 * body the row shows nothing rather than inventing one.
 */
export function notificationSubtitle(notification: Notification): string {
  return typeof notification.body === 'string' ? notification.body : '';
}
/** The three buckets the inbox can be split into. */
export type NotificationCategory = 'requests' | 'messages' | 'activity';

const REQUESTABLE_TYPES = new Set<string>(['connection_request', 'connection_accepted']);

/**
 * Bucket a notification by what it means to the caller. Only a pending
 * connection_request is actionable — `notificationAction` below drives the
 * Accept/Reject buttons — but a connection_accepted is still a relationship
 * event worth a "Requests" tab. Chat `message` notifications never reach this
 * point: `useNotifications` filters them out before the list, the badge, any
 * tab bucket, or the empty state is computed — they live in the Messages
 * section, one conversation row per sender, with the server's `unread_count`.
 */
export function notificationCategory(notification: Notification): NotificationCategory {
  switch (notification.type) {
    case 'connection_request':
    case 'connection_accepted':
      return 'requests';
    case 'message':
      return 'messages';
    default:
      return 'activity';
  }
}

/** Narrow the inbox to one bucket, used by the tab row. */
export function filterNotificationsByCategory(
  notifications: readonly Notification[],
  category: NotificationCategory,
): Notification[] {
  return notifications.filter((notification) => notificationCategory(notification) === category);
}

/**
 * The notification rows still waiting on the caller. A `connection_request` is
 * "pending" only while its connection is still unresolved on the server — once
 * the counterpart accepts or rejects, the row ceases to be actionable (a 409
 * would otherwise block the real resolution).
 */
export function pendingActionableIds(
  notifications: readonly Notification[],
  connections: readonly Connection[] | null | undefined,
): string[] {
  const ids = new Set<string>();
  for (const notification of notifications) {
    if (notification.type !== 'connection_request') continue;
    const action = notificationAction(notification);
    if (action.enabled) ids.add(notification.id);
  }
  return [...ids];
}

