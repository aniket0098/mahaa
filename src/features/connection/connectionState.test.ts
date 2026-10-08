/**
 * `deriveConnectionState` — the Connect pill's only source of truth.
 *
 * The interesting cases are the ones a UI tends to get wrong: a *dead* row
 * (declined/canceled/removed) that pins somebody to a decision the server has
 * already let go, a direction flag (`is_outgoing`) read as if it changed the
 * label, and a row for a different person matched because it happened to be
 * first. Each has a test here.
 *
 * Plain Node, no renderer — the function is pure by design.
 */

import { describe, expect, it } from 'vitest';

import type { Connection, UserSummary } from '@/types/onboarding';
import { deriveConnectionState } from '@/features/connection/connectionState';

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

describe('deriveConnectionState', () => {
  it('is none when there are no rows at all', () => {
    expect(deriveConnectionState([], 'MJ-ABCDE12345')).toBe('none');
    expect(deriveConnectionState(undefined, 'MJ-ABCDE12345')).toBe('none');
    expect(deriveConnectionState(null, 'MJ-ABCDE12345')).toBe('none');
  });

  it('is none without a public id, whatever the rows say — a demo author has no account', () => {
    expect(deriveConnectionState([row('MJ-ABCDE12345', 'accepted')], null)).toBe('none');
    expect(deriveConnectionState([row('MJ-ABCDE12345', 'accepted')], undefined)).toBe('none');
    expect(deriveConnectionState([row('MJ-ABCDE12345', 'accepted')], '')).toBe('none');
  });

  it('is pending for a live request in either direction', () => {
    // Outgoing: the reader sent it and is waiting.
    expect(deriveConnectionState([row('MJ-ABCDE12345', 'pending', true)], 'MJ-ABCDE12345')).toBe(
      'pending',
    );
    // Incoming: the flag is the server's, and the label is still Pending.
    expect(deriveConnectionState([row('MJ-ABCDE12345', 'pending', false)], 'MJ-ABCDE12345')).toBe(
      'pending',
    );
  });

  it('is accepted → connected in either direction', () => {
    expect(
      deriveConnectionState([row('MJ-ABCDE12345', 'accepted', true)], 'MJ-ABCDE12345'),
    ).toBe('connected');
    expect(
      deriveConnectionState([row('MJ-ABCDE12345', 'accepted', false)], 'MJ-ABCDE12345'),
    ).toBe('connected');
  });

  it('offers Connect again after declined, canceled, or removed — those are history', () => {
    for (const status of ['declined', 'canceled', 'removed'] as const) {
      expect(deriveConnectionState([row('MJ-ABCDE12345', status)], 'MJ-ABCDE12345')).toBe('none');
    }
  });

  it('ignores rows that belong to other people', () => {
    const rows = [
      row('MJ-OTHER00001', 'accepted'),
      row('MJ-OTHER00002', 'pending'),
    ];
    expect(deriveConnectionState(rows, 'MJ-ABCDE12345')).toBe('none');
    // The right row anywhere in the list still wins.
    expect(
      deriveConnectionState([row('MJ-ABCDE12345', 'accepted'), ...rows], 'MJ-ABCDE12345'),
    ).toBe('connected');
  });

  it('prefers the live status when both a dead row and a live row match', () => {
    // A revived relationship: the old decline stays in the list for history
    // while the new pending request is what the reader is actually waiting on.
    expect(
      deriveConnectionState(
        [row('MJ-ABCDE12345', 'declined'), row('MJ-ABCDE12345', 'pending')],
        'MJ-ABCDE12345',
      ),
    ).toBe('pending');
  });

  it('matches on the author id, never by position in the list', () => {
    // Dead row first, different person second: nothing live matches.
    expect(
      deriveConnectionState(
        [row('MJ-ABCDE12345', 'removed'), row('MJ-OTHER00001', 'accepted')],
        'MJ-ABCDE12345',
      ),
    ).toBe('none');
  });
});
