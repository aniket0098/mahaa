/**
 * The wiring that keeps connection-request acceptance honest.
 *
 * `notificationModel.test.ts` proves the pure action rules; `connections.test.ts`
 * pins the HTTP bindings. This file pins the *connections* between them: the
 * inbox only offers Accept when the server's own `data.connection_id` is
 * present, one action at a time, and a confirmed acceptance refreshes every
 * query whose rendered output the decision changes — notifications list, badge,
 * connections, and the messaging inbox. A subset of those invalidations is how
 * one screen ends up telling the truth while three others keep a lie.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Accept only exists when the server names a connection to resolve', () => {
  const screen = read('../../app/(candidate)/notifications.tsx');

  it('the row renders the buttons only for an actionable connection_request', () => {
    expect(screen).toContain("action.kind === 'accept' && action.connectionId");
    expect(screen).toContain('onPress={() => view.accept(notification)}');
    expect(screen).toContain('onPress={() => view.reject(notification)}');
  });

  it('both buttons are disabled while the action is on the wire', () => {
    expect(screen).toContain('loading={busy}');
    expect(screen).toContain('disabled={busy}');
  });
});

describe('acceptance sends the real mutation, once, and reconciles from the server', () => {
  const hook = read('../notifications/useNotifications.ts');

  it('the mutation resolves the request through the real connection bindings', () => {
    expect(hook).toContain('acceptConnection, declineConnection');
    // Whitespace-tolerant: line endings differ across checkouts.
    expect(hook).toMatch(/mutationFn: \(\{\s*connectionId,\s*action,\s*\}:/);
    expect(hook).toContain(
      "action === 'accept' ? acceptConnection(connectionId) : declineConnection(connectionId)",
    );
  });

  it('a second tap while one is in flight is a no-op, not a duplicate request', () => {
    expect(hook).toContain('if (!action.enabled || !action.connectionId || resolve.isPending) return;');
    // The busy id comes from the mutation's own variables — the row the server
    // is currently answering for, never a client-side guess.
    expect(hook).toContain('busyId: resolve.isPending ? (resolve.variables?.connectionId ?? null) : null');
  });

  it('success refreshes notifications, badge, connections AND the messaging inbox', () => {
    // All four, together, from one helper: the bell, this inbox, the
    // Connections screen and Messages → All must all re-read the same truth.
    expect(hook).toContain('function useInvalidateNotifications()');
    expect(hook).toMatch(/invalidateQueries\(\{ queryKey: notificationQueryKeys\.list \}\)/);
    expect(hook).toMatch(/invalidateQueries\(\{ queryKey: notificationQueryKeys\.unreadCount \}\)/);
    expect(hook).toMatch(/invalidateQueries\(\{ queryKey: queryKeys\.connectionsRoot \}\)/);
    expect(hook).toMatch(
      /invalidateQueries\(\{ queryKey: messagingQueryKeys\.conversations \}\)/,
    );
    // Nothing is optimistically removed: the row leaves through the refetch.
    expect(hook).not.toContain('onMutate');
  });

  it('a failure keeps the row and shows the server’s message — no false success', () => {
    expect(hook).toContain('onError: (error, variables) => {');
    expect(hook).toContain('setActionErrorId(variables.connectionId)');
    expect(hook).toContain("'That request could not be updated. Please try again.'");
    // A 409 means settled elsewhere: reconcile from the server, don't retry.
    expect(hook).toContain('if (error instanceof ApiError && error.isConflict) {');
    expect(hook).toContain("'That request was already handled. Refreshing…'");
  });
});
