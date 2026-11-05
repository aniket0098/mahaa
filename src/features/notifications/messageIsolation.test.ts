/** Chat messages stay out of the Notifications inbox.

The Notifications inbox shows connection requests and other account events —
never individual chat messages. This file pins the wiring that enforces it:
the model's predicate, the hook's filter, and the screen's category tabs.
*/

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('chat messages stay out of the Notifications inbox', () => {
  const hook = read('../notifications/useNotifications.ts');
  const model = read('./notificationModel.ts');
  const screen = read('../../app/(candidate)/notifications.tsx');

  it('the model flags every non-chat row as an inbox row', () => {
    expect(model).toContain("export function isAppNotification(");
    expect(model).toContain("return notification.type !== 'message';");
    expect(model).toMatch(/isAppNotification\(notification: Notification\): boolean/);
  });

  it('the hook filters message notifications out before the list, any tab bucket, or the empty state is computed', () => {
    expect(hook).toContain('.filter(isAppNotification)');
  });

  it('the screen declares no Messages category tab', () => {
    expect(screen).not.toContain("{ id: 'messages', label: 'Messages' }");
    expect(screen).toContain("{ id: 'all', label: 'All' }");
    expect(screen).toContain("{ id: 'requests', label: 'Requests' }");
    expect(screen).toContain("{ id: 'activity', label: 'Activity' }");
  });

  it('the category doc keeps chat out of the inbox by name', () => {
    expect(model).toContain('Chat `message` notifications never reach this');
  });
});
