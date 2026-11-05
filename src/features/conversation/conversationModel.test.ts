/**
 * The conversation model's rules, in plain Node.
 *
 * What matters here is exactly what a chat can misrender silently: bubbles on
 * the wrong side, separators under the wrong label, and a composer that fires
 * on whitespace. Each case below names the failure it prevents.
 */

import { describe, expect, it } from 'vitest';

import {
  attachmentLabel,
  bubbleText,
  buildConversationRows,
  canDelete,
  canEdit,
  canSend,
  dayLabel,
  hasMedia,
  isDeleted,
  isEdited,
  isImage,
  isOutgoing,
  isVideo,
  messageDay,
  otherParticipant,
} from '@/features/conversation/conversationModel';
import type { MessageAttachment, ThreadMessage } from '@/api/messages';

/** A minimal attachment row, as the server serializes one. */
function attachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: 'att-1',
    kind: 'image',
    mime_type: 'image/jpeg',
    width: 800,
    height: 600,
    size_bytes: 1024,
    served_at: '/api/v1/media/att-1',
    ...overrides,
  };
}

function msg(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'm1',
    conversation_id: 'c1',
    sender: {
      user_id: 'u-other',
      public_id: 'MJ-OTHER',
      username: 'other',
      name: 'Other Person',
      role: 'candidate',
      avatar_url: null,
    },
    body: 'Hello',
    client_message_id: null,
    created_at: '2026-01-10T10:00:00.000Z',
    edited_at: null,
    deleted_at: null,
    media: null,
    ...overrides,
  };
}

describe('otherParticipant', () => {
  it('excludes the caller and returns the other person', () => {
    const other = msg().sender;
    const members = [
      { ...other, user_id: 'u-me', name: 'Me' },
      other,
    ];
    expect(otherParticipant(members, 'u-me')).toBe(other);
  });

  it('falls back to the first member when the caller is not among them', () => {
    const members = [msg().sender];
    expect(otherParticipant(members, 'u-stranger')).toBe(members[0]);
  });

  it('returns null for an empty member list', () => {
    expect(otherParticipant([], 'u-me')).toBeNull();
  });
});

describe('isOutgoing', () => {
  it('is outgoing only when the sender is the signed-in caller', () => {
    expect(isOutgoing(msg(), 'u-other')).toBe(true);
    expect(isOutgoing(msg(), 'u-somebody-else')).toBe(false);
  });

  it('is never outgoing without a known caller id', () => {
    expect(isOutgoing(msg(), null)).toBe(false);
  });
});

describe('bubbleText and isDeleted', () => {
  it('shows the server text for an ordinary message', () => {
    const m = msg({ body: 'Hello' });
    expect(bubbleText(m)).toBe('Hello');
    expect(isDeleted(m)).toBe(false);
  });

  it('a deleted row is a tombstone, not an empty bubble', () => {
    const m = msg({ body: null, deleted_at: '2026-01-10T10:01:00.000Z' });
    expect(isDeleted(m)).toBe(true);
    expect(bubbleText(m)).toBe('This message was deleted.');
  });

  it('a null body is a tombstone even without an explicit deleted stamp', () => {
    expect(isDeleted(msg({ body: null }))).toBe(true);
  });

  it('a photo-only message is live content, not a tombstone', () => {
    // The server allows text, an attachment, or both. A photo with no caption
    // has a null body but is a real message — reading it as "deleted" would
    // hide the picture behind a lie.
    const m = msg({ body: null, media: attachment() });
    expect(isDeleted(m)).toBe(false);
    // Its bubble shows no caption line — the attachment is the content.
    expect(bubbleText(m)).toBe('');
  });

  it('a captioned photo shows its text like any other message', () => {
    const m = msg({ body: 'Signed, sealed', media: attachment() });
    expect(isDeleted(m)).toBe(false);
    expect(bubbleText(m)).toBe('Signed, sealed');
  });

  it('a tombstone hides its attachment along with its text', () => {
    // The server nulls `media` on delete, but a stale row that still carried
    // one must not render it: the delete stamp wins over everything.
    const m = msg({
      body: null,
      media: attachment(),
      deleted_at: '2026-01-10T10:01:00.000Z',
    });
    expect(isDeleted(m)).toBe(true);
    expect(hasMedia(m)).toBe(false);
    expect(bubbleText(m)).toBe('This message was deleted.');
  });
});

describe('hasMedia, isImage, isVideo, attachmentLabel', () => {
  it('names a photo and a video, and nothing on a text message', () => {
    const photo = msg({ body: null, media: attachment() });
    const video = msg({
      body: null,
      media: attachment({ kind: 'video', mime_type: 'video/mp4', width: null, height: null }),
    });
    const text = msg();

    expect(hasMedia(photo)).toBe(true);
    expect(isImage(photo)).toBe(true);
    expect(isVideo(photo)).toBe(false);
    expect(attachmentLabel(photo)).toBe('Photo');

    expect(hasMedia(video)).toBe(true);
    expect(isImage(video)).toBe(false);
    expect(isVideo(video)).toBe(true);
    expect(attachmentLabel(video)).toBe('Video');

    expect(hasMedia(text)).toBe(false);
    expect(attachmentLabel(text)).toBeNull();
  });
});

describe('messageDay and dayLabel', () => {
  it('a day key is a zero-padded calendar date', () => {
    // Padded, so lexicographic order is chronological order.
    const day = messageDay('2026-01-05T02:03:04.000Z');
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('an unparseable timestamp drops the day, not the message', () => {
    expect(messageDay('not-a-date')).toBeNull();
  });

  it('labels today and yesterday in words', () => {
    const now = Date.parse('2026-01-10T12:00:00.000Z');
    expect(dayLabel('2026-01-10', now)).toBe('Today');
    expect(dayLabel('2026-01-09', now)).toBe('Yesterday');
  });

  it('labels any older day with a readable date', () => {
    const label = dayLabel('2026-01-03', Date.parse('2026-01-10T12:00:00.000Z'));
    expect(label).not.toBe('Today');
    expect(label).not.toBe('Yesterday');
    expect(label.length).toBeGreaterThan(0);
  });
});

describe('buildConversationRows', () => {
  it('inserts one separator per day and annotates sides', () => {
    const rows = buildConversationRows(
      [
        msg({ id: 'a', created_at: '2026-01-09T10:00:00.000Z' }),
        msg({
          id: 'b',
          created_at: '2026-01-10T10:00:00.000Z',
          sender: { ...msg().sender, user_id: 'u-me' },
        }),
      ],
      'u-me',
    );
    expect(rows.length).toBe(4);
    expect(rows[0]).toMatchObject({ kind: 'separator', label: expect.any(String) });
    expect(rows[1]).toMatchObject({ kind: 'message', entry: { side: 'incoming' } });
    expect(rows[2]).toMatchObject({ kind: 'separator', label: expect.any(String) });
    expect(rows[3]).toMatchObject({ kind: 'message', entry: { side: 'outgoing' } });
  });

  it('clusters consecutive messages from the same sender', () => {
    const rows = buildConversationRows(
      [msg({ id: 'a' }), msg({ id: 'b' }), msg({ id: 'c', sender: { ...msg().sender, user_id: 'u-me' } })],
      'u-me',
    );
    const flags = rows
      .filter((r) => r.kind === 'message')
      .map((r) => (r.kind === 'message' ? r.entry.startsCluster : null));
    expect(flags).toEqual([true, false, true]);
  });

  it('keeps a message whose timestamp is unparseable — only its separator is dropped', () => {
    const rows = buildConversationRows([msg({ id: 'a', created_at: 'garbage' })], null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'message' });
  });

  it('builds two rows for an empty thread — a non-issue for an empty state to own', () => {
    expect(buildConversationRows([], null)).toEqual([]);
  });
});

describe('canSend', () => {
  it('sends only with text, and only while idle', () => {
    expect(canSend('Hello', false)).toBe(true);
    expect(canSend('   ', false)).toBe(false);
    expect(canSend('', false)).toBe(false);
    expect(canSend('Hello', true)).toBe(false);
  });

  it('an uploaded attachment satisfies the gate on its own — a photo is a message', () => {
    expect(canSend('', false, true)).toBe(true);
    expect(canSend('   ', false, true)).toBe(true);
    // Still gated on idle: a second tap during flight must not append a row.
    expect(canSend('', true, true)).toBe(false);
    expect(canSend('Caption', true, true)).toBe(false);
  });
});

describe('canDelete', () => {
  const asSelf = { user_id: 'u-self', public_id: 'MJ-SELF', username: 'self', name: 'Self', role: 'candidate', avatar_url: null };
  const asOther = { user_id: 'u-other', public_id: 'MJ-OTHER', username: 'other', name: 'Other', role: 'candidate', avatar_url: null };
  const mine = msg({ sender: asSelf });
  const theirs = msg({ sender: asOther });
  const tombstone = msg({ sender: asSelf, body: null, deleted_at: '2026-01-02T10:00:00Z' });

  it('offers delete on my own live message only', () => {
    expect(canDelete(mine, 'u-self')).toBe(true);
    expect(canDelete(theirs, 'u-self')).toBe(false);
  });

  it('never offers delete on a message that is already a tombstone', () => {
    expect(canDelete(tombstone, 'u-self')).toBe(false);
  });

  it('offers nothing when the caller identity is not known yet', () => {
    expect(canDelete(mine, null)).toBe(false);
    expect(canDelete(theirs, null)).toBe(false);
  });

  it('treats a null body as deleted even without the deleted_at stamp', () => {
    expect(canDelete(msg({ body: null }), 'u-other')).toBe(false);
  });
});

describe('canEdit', () => {
  const asSelf = { user_id: 'u-self', public_id: 'MJ-SELF', username: 'self', name: 'Self', role: 'candidate', avatar_url: null };
  const asOther = { user_id: 'u-other', public_id: 'MJ-OTHER', username: 'other', name: 'Other', role: 'candidate', avatar_url: null };

  it('mirrors canDelete — edit is sender-only, live-only, and needs a known caller', () => {
    // Edit and delete share one rule on the server (`PATCH`/`DELETE /messages/{id}`
    // are both sender-only and 404 on a tombstone), so the predicates agree. If they
    // ever drift, this is the line that catches it before the UI offers a doomed tap.
    expect(canEdit(msg({ sender: asSelf }), 'u-self')).toBe(true);
    expect(canEdit(msg({ sender: asOther }), 'u-self')).toBe(false);
    expect(canEdit(msg({ sender: asSelf, body: null, deleted_at: '2026-01-02T10:00:00Z' }), 'u-self')).toBe(false);
    expect(canEdit(msg({ sender: asSelf }), null)).toBe(false);
  });
});

describe('isEdited', () => {
  it('is edited only when the server stamped edited_at on a live message', () => {
    // The marker is the server's field, never a local guess — so it is false
    // without an edit stamp, and stays false on a tombstone even if a stamp
    // somehow lingered (the body is null there; there is nothing to describe).
    expect(isEdited(msg({ edited_at: '2026-01-11T10:00:00Z' }))).toBe(true);
    expect(isEdited(msg({ edited_at: null }))).toBe(false);
    expect(isEdited(msg({ edited_at: '2026-01-11T10:00:00Z', body: null, deleted_at: '2026-01-02T10:00:00Z' }))).toBe(false);
  });
});
