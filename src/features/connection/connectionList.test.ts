/**
 * `partitionConnections` — the pure split behind the Connections screen.
 *
 * The cases that matter: direction driving which action a pending row earns,
 * history being dropped rather than pinned on screen, a malformed row never
 * becoming a broken card, and the accepted group being independent of direction.
 * Plain Node, no renderer — the function is pure.
 */

import { describe, expect, it } from 'vitest';

import type { Connection, UserSummary } from '@/types/onboarding';
import {
  partitionConnections,
  pendingIncomingCount,
} from '@/features/connection/connectionList';

function user(publicId: string): UserSummary {
  return {
    user_id: `internal-${publicId}`,
    public_id: publicId,
    username: 'someone',
    name: 'Someone',
    role: 'candidate',
    avatar_url: null,
  };
}

function row(
  publicId: string,
  status: Connection['status'],
  isOutgoing = true,
): Connection {
  return {
    id: `row-${publicId}-${status}`,
    status,
    is_outgoing: isOutgoing,
    user: user(publicId),
    created_at: '2026-03-01T00:00:00Z',
    responded_at: null,
  };
}

describe('partitionConnections', () => {
  it('returns three empty lists for null/undefined/empty input', () => {
    for (const input of [null, undefined, []] as const) {
      expect(partitionConnections(input)).toEqual({ incoming: [], outgoing: [], accepted: [] });
    }
  });

  it('routes a pending row by is_outgoing', () => {
    const outgoing = row('MJ-OUTGOING01', 'pending', true);
    const incoming = row('MJ-INCOMING1', 'pending', false);
    const lists = partitionConnections([outgoing, incoming]);
    expect(lists.outgoing).toEqual([outgoing]);
    expect(lists.incoming).toEqual([incoming]);
    expect(lists.accepted).toEqual([]);
  });

  it('collects accepted rows regardless of direction', () => {
    const a = row('MJ-ACCEPTED01', 'accepted', true);
    const b = row('MJ-ACCEPTED02', 'accepted', false);
    const lists = partitionConnections([a, b]);
    expect(lists.accepted).toEqual([a, b]);
    expect(lists.incoming).toEqual([]);
    expect(lists.outgoing).toEqual([]);
  });

  it('drops declined, canceled and removed rows entirely', () => {
    const rows = [
      row('MJ-DECLINED01', 'declined', false),
      row('MJ-CANCELED1', 'canceled', true),
      row('MJ-REMOVED01', 'removed', true),
    ];
    expect(partitionConnections(rows)).toEqual({ incoming: [], outgoing: [], accepted: [] });
  });

  it('drops a row without a usable user rather than rendering a broken card', () => {
    const noUser = { ...row('MJ-NOUSER001', 'pending', false), user: null } as unknown as Connection;
    const badPublicId = {
      ...row('MJ-BADPUBLIC1', 'pending', false),
      user: { ...user('x'), public_id: '' },
    };
    const good = row('MJ-GOODUSER01', 'pending', false);
    const lists = partitionConnections([noUser, badPublicId, good]);
    expect(lists.incoming).toEqual([good]);
  });

  it('handles a mix of every status and direction in one pass', () => {
    const rows = [
      row('MJ-INCOMING1', 'pending', false),
      row('MJ-OUTGOING01', 'pending', true),
      row('MJ-ACCEPTED01', 'accepted', true),
      row('MJ-DECLINED01', 'declined', false),
    ];
    const lists = partitionConnections(rows);
    expect(lists.incoming.map((r) => r.user.public_id)).toEqual(['MJ-INCOMING1']);
    expect(lists.outgoing.map((r) => r.user.public_id)).toEqual(['MJ-OUTGOING01']);
    expect(lists.accepted.map((r) => r.user.public_id)).toEqual(['MJ-ACCEPTED01']);
  });
});

describe('pendingIncomingCount', () => {
  it('counts only pending incoming rows', () => {
    const rows = [
      row('MJ-INCOMING1', 'pending', false),
      row('MJ-INCOMING2', 'pending', false),
      // These three must not inflate the badge the recipient sees.
      row('MJ-OUTGOING01', 'pending', true),
      row('MJ-ACCEPTED01', 'accepted', true),
      row('MJ-DECLINED01', 'declined', false),
    ];
    expect(pendingIncomingCount(rows)).toBe(2);
  });

  it('is zero for empty input', () => {
    expect(pendingIncomingCount(null)).toBe(0);
    expect(pendingIncomingCount([])).toBe(0);
  });
});