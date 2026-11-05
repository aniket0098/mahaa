import { describe, expect, it } from 'vitest';

import type { MessageRequest } from '@/api/messageRequests';
import { filterRequests } from './messageSections';

function row(overrides: Partial<MessageRequest>): MessageRequest {
  return {
    id: 'x',
    status: 'pending',
    note: null,
    created_at: '2026-01-10T12:00:00.000Z',
    responded_at: null,
    sender: {
      user_id: 'u-x',
      public_id: 'p-x',
      username: 'ada',
      name: 'Ada Lovelace',
      role: 'candidate',
      designation: null,
      avatar_url: null,
    },
    ...overrides,
  };
}

function senderRow(
  id: string,
  name: string,
  designation: string | null,
  note: string | null,
): MessageRequest {
  return row({
    id,
    note,
    sender: {
      user_id: `u-${id}`,
      public_id: `p-${id}`,
      username: name.toLowerCase().replace(/\s+/g, ''),
      name,
      role: 'candidate',
      designation,
      avatar_url: null,
    },
  });
}

describe('filterRequests', () => {
  const rows: MessageRequest[] = [
    senderRow('1', 'Ada Lovelace', 'Engineer at Acme', 'Hi'),
    senderRow('2', 'Bob Smith', 'Designer at Globex', null),
    senderRow('3', 'Cara Diaz', null, 'mutual: Ada'),
  ];

  it('returns every row for an empty or whitespace query', () => {
    expect(filterRequests(rows, '')).toHaveLength(3);
    expect(filterRequests(rows, '   ')).toHaveLength(3);
  });

  it('matches the sender name case-insensitively', () => {
    expect(filterRequests(rows, 'ada').map((r) => r.id)).toEqual(['1', '3']);
    expect(filterRequests(rows, 'BOB').map((r) => r.id)).toEqual(['2']);
  });

  it('matches the professional detail line', () => {
    expect(filterRequests(rows, 'globex').map((r) => r.id)).toEqual(['2']);
  });

  it('matches the note text', () => {
    expect(filterRequests(rows, 'mutual').map((r) => r.id)).toEqual(['3']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterRequests(rows, 'zzz')).toHaveLength(0);
  });

  it('does not mutate the input array', () => {
    const copy = [...rows];
    filterRequests(rows, 'ada');
    expect(rows).toEqual(copy);
  });
});
