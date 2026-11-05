import { describe, expect, it } from 'vitest';

import type { Conversation } from '@/api/messages';
import {
  conversationPreview,
  filterConversations,
  formatRequestTime,
  isConversationUnread,
  paneFor,
  requestContextLine,
  sectionLabel,
  MESSAGE_SECTIONS,
} from '@/features/messages/messageSections';

describe('requestContextLine', () => {
  it('renders the designation the server returned', () => {
    expect(requestContextLine('Product Designer')).toBe('Product Designer');
  });

  it('renders nothing when the server sent nothing', () => {
    expect(requestContextLine(null)).toBe('');
    expect(requestContextLine(undefined)).toBe('');
    expect(requestContextLine('   ')).toBe('');
  });
});

describe('formatRequestTime', () => {
  const now = Date.parse('2026-01-10T12:00:00.000Z');

  it('collapses the first minute to "just now"', () => {
    expect(formatRequestTime('2026-01-10T11:59:40.000Z', now)).toBe('just now');
  });

  it('reports minutes under an hour', () => {
    expect(formatRequestTime('2026-01-10T11:55:00.000Z', now)).toBe('5m');
  });

  it('reports hours under a day', () => {
    expect(formatRequestTime('2026-01-10T09:00:00.000Z', now)).toBe('3h');
  });

  it('reports days beyond a day', () => {
    expect(formatRequestTime('2026-01-08T12:00:00.000Z', now)).toBe('2d');
  });

  it('clamps clock skew to "just now" instead of a negative age', () => {
    expect(formatRequestTime('2026-01-10T12:05:00.000Z', now)).toBe('just now');
  });

  it('returns empty string for an unparseable timestamp', () => {
    expect(formatRequestTime('not-a-date', now)).toBe('');
  });
});

describe('sectionLabel', () => {
  const requests = MESSAGE_SECTIONS.find((section) => section.id === 'requests')!;
  const all = MESSAGE_SECTIONS.find((section) => section.id === 'all')!;

  it('carries the server count on Requests', () => {
    expect(sectionLabel(requests, 3)).toBe('Requests (3)');
  });

  it('shows plain Requests when nothing is pending', () => {
    expect(sectionLabel(requests, 0)).toBe('Requests');
    expect(sectionLabel(requests, undefined)).toBe('Requests');
  });

  it('never counts a non-requests section', () => {
    expect(sectionLabel(all, 3)).toBe('All');
  });
});

describe('paneFor', () => {
  it('returns a pane for every section — this screen has no destinations', () => {
    expect(paneFor('all')).toBe('all');
    expect(paneFor('unread')).toBe('unread');
    expect(paneFor('requests')).toBe('requests');
  });

  it('keeps the three sections and only those three', () => {
    // The connection-request surface moved to /notifications; Mentors and
    // Groups have no server rule behind them, so they must not exist here.
    expect(MESSAGE_SECTIONS.map((section) => section.id)).toEqual(['all', 'unread', 'requests']);
  });
});

describe('isConversationUnread', () => {
  it('is true only for a server-reported count above zero', () => {
    expect(isConversationUnread(thread({ unread_count: 2 }))).toBe(true);
    expect(isConversationUnread(thread({ unread_count: 0 }))).toBe(false);
  });
});

function thread(overrides: Partial<Conversation>): Conversation {
  return {
    id: 'c1',
    created_by: 'u1',
    created_at: '2026-01-10T12:00:00.000Z',
    last_message_at: '2026-01-10T12:00:00.000Z',
    last_message: null,
    members: [
      {
        user_id: 'u2',
        public_id: 'p2',
        username: 'bob',
        name: 'Bob Smith',
        role: 'candidate',
        avatar_url: null,
      },
    ],
    unread_count: 0,
    muted: false,
    archived: false,
    ...overrides,
  };
}

describe('conversationPreview', () => {
  it('returns the last message body', () => {
    const conversation = thread({
      last_message: {
        id: 'm1',
        conversation_id: 'c1',
        sender: {
          user_id: 'u2',
          public_id: 'p2',
          username: 'bob',
          name: 'Bob Smith',
          role: 'candidate',
          avatar_url: null,
        },
        body: 'See you Monday',
        client_message_id: null,
        created_at: '2026-01-10T12:00:00.000Z',
        edited_at: null,
        deleted_at: null,
        media: null,
      },
    });
    expect(conversationPreview(conversation)).toBe('See you Monday');
  });

  it('names a tombstone honestly and never renders a missing thread', () => {
    const deleted = thread({
      last_message: {
        id: 'm1',
        conversation_id: 'c1',
        sender: {
          user_id: 'u2',
          public_id: 'p2',
          username: 'bob',
          name: 'Bob Smith',
          role: 'candidate',
          avatar_url: null,
        },
        body: null,
        client_message_id: null,
        created_at: '2026-01-10T12:00:00.000Z',
        edited_at: null,
        deleted_at: '2026-01-10T12:01:00.000Z',
        media: null,
      },
    });
    expect(conversationPreview(deleted)).toBe('Message deleted');
    expect(conversationPreview(thread({}))).toBe('');
  });

  it('names a live attachment rather than calling it deleted', () => {
    // A photo or video with no caption is real content — the preview must not
    // claim the message was deleted while its attachment is still visible.
    const base = {
      id: 'm1',
      conversation_id: 'c1',
      sender: {
        user_id: 'u2',
        public_id: 'p2',
        username: 'bob',
        name: 'Bob Smith',
        role: 'candidate',
        avatar_url: null,
      },
      body: null,
      client_message_id: null,
      created_at: '2026-01-10T12:00:00.000Z',
      edited_at: null,
      deleted_at: null,
    };
    const photo = thread({
      last_message: {
        ...base,
        media: {
          id: 'att-1',
          kind: 'image',
          mime_type: 'image/jpeg',
          width: 800,
          height: 600,
          size_bytes: 1024,
          served_at: '/api/v1/media/att-1',
        },
      },
    });
    const video = thread({
      last_message: {
        ...base,
        media: {
          id: 'att-2',
          kind: 'video',
          mime_type: 'video/mp4',
          width: null,
          height: null,
          size_bytes: 2048,
          served_at: '/api/v1/media/att-2',
        },
      },
    });
    expect(conversationPreview(photo)).toBe('Photo');
    expect(conversationPreview(video)).toBe('Video');
  });
});

describe('filterConversations', () => {
  const rows = [
    thread({ id: 'c1' }),
    thread({
      id: 'c2',
      members: [
        {
          user_id: 'u3',
          public_id: 'p3',
          username: 'cara',
          name: 'Cara Diaz',
          role: 'candidate',
          avatar_url: null,
        },
      ],
    }),
  ];

  it('returns every thread for an empty query', () => {
    expect(filterConversations(rows, '')).toHaveLength(2);
  });

  it('matches a member name case-insensitively', () => {
    expect(filterConversations(rows, 'cara').map((row) => row.id)).toEqual(['c2']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterConversations(rows, 'zzz')).toHaveLength(0);
  });
});
