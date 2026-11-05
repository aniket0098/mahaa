/**
 * The inbox model's rules, in plain Node.
 *
 * The three cases worth proving are the ones a screen could get subtly wrong:
 * a badge that invents a number, a row that offers an action it cannot perform,
 * and a timestamp that shows garbage for an unusual value.
 */

import { describe, expect, it } from 'vitest';

import {
  BADGE_DISPLAY_CAP,
  actorName,
  badgeAccessibilityLabel,
  badgeLabel,
  formatNotificationTime,
  isAppNotification,
  isUnread,
  notificationAction,
  notificationSubtitle,
} from '@/features/notifications/notificationModel';
import type { Notification } from '@/api/notifications';

const NOW = Date.parse('2026-01-10T12:00:00.000Z');

function row(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    type: 'connection_request',
    actor: { user_id: 'u1', name: 'Aniket', avatar_url: null },
    target_type: 'connection',
    target_id: 'c1',
    title: 'Aniket sent you a connection request.',
    body: null,
    data: { connection_id: 'c1' },
    is_read: false,
    created_at: '2026-01-10T11:45:00.000Z',
    ...overrides,
  };
}

describe('badgeLabel', () => {
  it('draws nothing for zero — a badge saying zero is noise', () => {
    expect(badgeLabel(0)).toBeNull();
  });

  it('draws nothing when the server could not answer', () => {
    // A failed fetch must not leave a stale number on the bell.
    expect(badgeLabel(null)).toBeNull();
    expect(badgeLabel(undefined)).toBeNull();
  });

  it('draws the number up to the cap', () => {
    expect(badgeLabel(1)).toBe('1');
    expect(badgeLabel(9)).toBe('9');
    expect(badgeLabel(BADGE_DISPLAY_CAP)).toBe('9');
  });

  it('collapses anything above the cap rather than widening the header', () => {
    expect(badgeLabel(10)).toBe('9+');
    expect(badgeLabel(1204)).toBe('9+');
  });

  it('never draws a negative count', () => {
    expect(badgeLabel(-3)).toBeNull();
  });
});

describe('badgeAccessibilityLabel', () => {
  it('says there are none when the badge is hidden', () => {
    expect(badgeAccessibilityLabel(0)).toBe('Notifications, none unread');
  });

  it('states the number when one is shown', () => {
    expect(badgeAccessibilityLabel(3)).toBe('Notifications, 3 unread');
  });
});

describe('notificationAction', () => {
  it('offers an action for an incoming connection request with an id', () => {
    const action = notificationAction(row());
    expect(action.kind).toBe('accept');
    expect(action.enabled).toBe(true);
    expect(action.connectionId).toBe('c1');
  });

  it('offers nothing when the notification carries no connection id', () => {
    // No client guess is substituted: nothing to act on is honest, an error is not.
    const action = notificationAction(row({ data: {} }));
    expect(action.kind).toBe('none');
    expect(action.enabled).toBe(false);
    expect(action.connectionId).toBeNull();
  });

  it('offers nothing for an accepted connection — it is already a connection', () => {
    const action = notificationAction(row({ type: 'connection_accepted' }));
    expect(action.kind).toBe('none');
    expect(action.enabled).toBe(false);
  });

  it('offers nothing for a message — it belongs in its own conversation', () => {
    const action = notificationAction(row({ type: 'message' }));
    expect(action.kind).toBe('none');
    expect(action.enabled).toBe(false);
  });

  it('offers nothing for a type this build does not know', () => {
    const action = notificationAction(row({ type: 'something_new' }));
    expect(action.kind).toBe('none');
    expect(action.enabled).toBe(false);
  });

  it('ignores a non-string connection id', () => {
    const action = notificationAction(row({ data: { connection_id: 12 } as never }));
    expect(action.kind).toBe('none');
    expect(action.connectionId).toBeNull();
  });
});

describe('isUnread', () => {
  it('is true only when the server says the row is unread', () => {
    expect(isUnread(row({ is_read: false }))).toBe(true);
    expect(isUnread(row({ is_read: true }))).toBe(false);
  });
});

describe('isAppNotification', () => {
  it('keeps connection events — they are the inbox rows', () => {
    expect(isAppNotification(row({ type: 'connection_request' }))).toBe(true);
    expect(isAppNotification(row({ type: 'connection_accepted' }))).toBe(true);
    expect(isAppNotification(row({ type: 'system' as never }))).toBe(true);
  });

  it('excludes chat messages — they belong to the Messages section', () => {
    expect(isAppNotification(row({ type: 'message' }))).toBe(false);
  });

  it('keeps types this build does not know — nothing unfamiliar is hidden', () => {
    expect(isAppNotification(row({ type: 'something_new' as never }))).toBe(true);
  });
});

describe('formatNotificationTime', () => {
  it('uses the app-wide relative vocabulary', () => {
    expect(formatNotificationTime('2026-01-10T11:59:30.000Z', NOW)).toBe('just now');
    expect(formatNotificationTime('2026-01-10T11:45:00.000Z', NOW)).toBe('15m');
    expect(formatNotificationTime('2026-01-10T09:00:00.000Z', NOW)).toBe('3h');
    expect(formatNotificationTime('2026-01-08T12:00:00.000Z', NOW)).toBe('2d');
  });

  it('renders an unparseable value as nothing, not as Invalid Date', () => {
    expect(formatNotificationTime('not-a-date', NOW)).toBe('');
  });

  it('collapses a future timestamp to just now rather than a negative age', () => {
    expect(formatNotificationTime('2026-01-10T12:30:00.000Z', NOW)).toBe('just now');
  });
});

describe('actorName and notificationSubtitle', () => {
  it('reads the actor name, and nothing when there is no actor', () => {
    expect(actorName(row())).toBe('Aniket');
    expect(actorName(row({ actor: null }))).toBe('');
  });

  it('renders the server body and never composes its own sentence', () => {
    expect(notificationSubtitle(row({ body: 'Said hello' }))).toBe('Said hello');
    expect(notificationSubtitle(row({ body: null }))).toBe('');
  });
});
