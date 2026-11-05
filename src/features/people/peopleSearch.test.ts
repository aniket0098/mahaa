/**
 * `peopleSearch` — the pure rules behind Home's people lookup and the Connect
 * affordance on a public profile.
 *
 * The cases that matter are the ones a UI gets wrong: the caller leaking into
 * their own results, a record the app cannot route to being rendered anyway, a
 * dead connection row pinning a person to Connect when the server would accept
 * a fresh request, and a pending row's direction being flattened so a profile
 * offers Cancel where it should offer Respond (or a Connect button to a person
 * who is really the caller). Plain Node, no renderer — every function is pure.
 */

import { describe, expect, it } from 'vitest';

import type { Connection, UserSummary } from '@/types/onboarding';
import {
  derivePersonConnectionState,
  excludeSelf,
  isSelf,
  personAction,
  personActionFor,
  sanitizeLookupResults,
} from '@/features/people/peopleSearch';

function user(publicId: string, overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    user_id: `internal-${publicId}`,
    public_id: publicId,
    username: 'someone',
    name: 'Someone',
    role: 'candidate',
    avatar_url: null,
    ...overrides,
  };
}

function row(publicId: string, status: Connection['status'], isOutgoing = true): Connection {
  return {
    id: `row-${publicId}-${status}`,
    status,
    is_outgoing: isOutgoing,
    user: user(publicId),
    created_at: '2026-03-01T00:00:00Z',
    responded_at: null,
  };
}

describe('isSelf', () => {
  it('is true only when both ids are present and equal', () => {
    expect(isSelf('MJ-ABCDE12345', 'MJ-ABCDE12345')).toBe(true);
  });

  it('is false when either id is missing, null, or empty', () => {
    expect(isSelf('MJ-ABCDE12345', null)).toBe(false);
    expect(isSelf(null, 'MJ-ABCDE12345')).toBe(false);
    expect(isSelf('', 'MJ-ABCDE12345')).toBe(false);
    expect(isSelf('MJ-ABCDE12345', '')).toBe(false);
    expect(isSelf(undefined, undefined)).toBe(false);
  });

  it('compares by public id, never by name', () => {
    expect(isSelf('MJ-ABCDE12345', 'MJ-ZZZZZ99999')).toBe(false);
  });
});

describe('sanitizeLookupResults', () => {
  it('returns an empty list for null/undefined input', () => {
    expect(sanitizeLookupResults(null)).toEqual([]);
    expect(sanitizeLookupResults(undefined)).toEqual([]);
  });

  it('drops rows missing a routable id or a name', () => {
    const good = user('MJ-ABCDE12345');
    const noPublicId = { ...user('x'), public_id: '' };
    const noUserId = { ...user('y'), user_id: '' };
    const noName = { ...user('z'), name: '' };
    const nullRow = null as unknown as UserSummary;
    expect(sanitizeLookupResults([good, noPublicId, noUserId, noName, nullRow])).toEqual([good]);
  });

  it('keeps every well-formed row', () => {
    const rows = [user('MJ-AAAAA00001'), user('MJ-BBBBB00002')];
    expect(sanitizeLookupResults(rows)).toEqual(rows);
  });
});

describe('excludeSelf', () => {
  it('removes the caller from their own suggestions', () => {
    const rows = [
      user('MJ-ABCDE12345', { name: 'Me' }),
      user('MJ-OTHER00001', { name: 'Other' }),
    ];
    expect(excludeSelf(rows, 'MJ-ABCDE12345').map((r) => r.public_id)).toEqual(['MJ-OTHER00001']);
  });

  it('sanitizes before excluding, so a malformed row is still dropped', () => {
    const rows = [user('MJ-ABCDE12345'), { ...user('bad'), public_id: '' }];
    expect(excludeSelf(rows, 'MJ-ABCDE12345')).toEqual([]);
  });

  it('keeps everyone when there is no self id to exclude', () => {
    const rows = [user('MJ-AAAAA00001'), user('MJ-BBBBB00002')];
    expect(excludeSelf(rows, null)).toEqual(rows);
  });

describe('derivePersonConnectionState', () => {
  it('is none when there is no matching row', () => {
    expect(derivePersonConnectionState([row('MJ-OTHER00001', 'pending')], 'MJ-ABCDE12345')).toBe(
      'none',
    );
  });

  it('is none for a null or empty row set', () => {
    expect(derivePersonConnectionState(null, 'MJ-ABCDE12345')).toBe('none');
    expect(derivePersonConnectionState([], 'MJ-ABCDE12345')).toBe('none');
  });

  it('is none when there is no public id to match on', () => {
    expect(derivePersonConnectionState([row('MJ-ABCDE12345', 'pending')], null)).toBe('none');
  });

  it('keeps the direction of a pending row', () => {
    expect(derivePersonConnectionState([row('MJ-ABCDE12345', 'pending', true)], 'MJ-ABCDE12345')).toBe(
      'outgoing_pending',
    );
    expect(
      derivePersonConnectionState([row('MJ-ABCDE12345', 'pending', false)], 'MJ-ABCDE12345'),
    ).toBe('incoming_pending');
  });

  it('is connected for an accepted row', () => {
    expect(
      derivePersonConnectionState([row('MJ-ABCDE12345', 'accepted', true)], 'MJ-ABCDE12345'),
    ).toBe('connected');
  });

  it('treats declined, canceled and removed rows as history', () => {
    for (const status of ['declined', 'canceled', 'removed'] as const) {
      expect(derivePersonConnectionState([row('MJ-ABCDE12345', status)], 'MJ-ABCDE12345')).toBe(
        'none',
      );
    }
  });

  it('prefers a live row over a historical one for the same person', () => {
    const rows = [
      row('MJ-ABCDE12345', 'canceled', true),
      row('MJ-ABCDE12345', 'accepted', true),
    ];
    expect(derivePersonConnectionState(rows, 'MJ-ABCDE12345')).toBe('connected');
  });

  it('ignores rows belonging to other people', () => {
    const rows = [row('MJ-OTHER00001', 'accepted', true), row('MJ-ABCDE12345', 'pending', true)];
    expect(derivePersonConnectionState(rows, 'MJ-ABCDE12345')).toBe('outgoing_pending');
  });
});

describe('personAction', () => {
  it('offers nothing on your own profile', () => {
    const action = personAction('none', true);
    expect(action).toMatchObject({ label: 'This is you', kind: 'none', enabled: false });
  });

  it('offers Connect only for the none state', () => {
    expect(personAction('none', false)).toMatchObject({
      label: 'Connect',
      kind: 'send',
      enabled: true,
    });
  });

  it('offers a cancel for an outgoing pending request', () => {
    expect(personAction('outgoing_pending', false)).toMatchObject({
      label: 'Requested',
      kind: 'cancel',
      enabled: true,
    });
  });

  it('offers a response for an incoming pending request', () => {
    expect(personAction('incoming_pending', false)).toMatchObject({
      label: 'Respond',
      kind: 'respond',
      enabled: true,
    });
  });

  it('offers no action once connected', () => {
    expect(personAction('connected', false)).toMatchObject({
      label: 'Connected',
      kind: 'none',
      enabled: false,
    });
  });
});

describe('personActionFor', () => {
  it('derives the action straight from rows and a public id', () => {
    expect(personActionFor([row('MJ-ABCDE12345', 'pending', false)], 'MJ-ABCDE12345', false)).toMatchObject(
      { kind: 'respond', enabled: true },
    );
  });

  it('overrides with "This is you" for the caller, even with rows present', () => {
    expect(personActionFor([row('MJ-ABCDE12345', 'accepted')], 'MJ-ABCDE12345', true)).toMatchObject(
      { kind: 'none', enabled: false },
    );
  });
});
});
