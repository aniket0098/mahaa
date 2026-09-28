/**
 * Draft codec tests.
 *
 * The composer promises that an unfinished post is never lost, and that one
 * person's draft can never be restored into another's session. These assertions
 * cover the failure modes that would break both promises:
 *
 *  - a round trip returns exactly what was saved, including picked image
 *    **references** (never bytes);
 *  - a draft belonging to a different user is refused, not half-restored;
 *  - corrupt, truncated, or future-versioned content opens the composer empty
 *    rather than throwing into the screen.
 */

import { describe, expect, it } from 'vitest';

import { DRAFT_VERSION, parseDraft, serializeDraft } from './draftCodec';
import { emptyDraft, type Draft, type DraftMedia } from '@/features/composer/composerModel';

const USER = 'user-1';
const NOW = '2026-06-01T12:00:00.000Z';

function media(localUri: string): DraftMedia {
  return {
    localUri,
    fileName: `${localUri}.png`,
    mimeType: 'image/png',
    sizeBytes: 2048,
    width: 1200,
    height: 800,
  };
}

function fullDraft(): Draft {
  return {
    type: 'image',
    body: 'Workshop photos',
    project: {
      title: 'Campus Events',
      description: 'Seats and check-in',
      technologies: 'React, FastAPI',
      category: 'Web Development',
      status: 'Academic',
      team: 'Four students',
      sourceUrl: 'https://github.com/example/repo',
      liveUrl: 'https://example.com',
    },
    achievement: {
      title: 'Cloud Fundamentals',
      issuer: 'Example Institute',
      achievedOn: '2026-02-10',
      description: 'Six month course',
      verificationUrl: 'https://example.com/verify',
    },
    media: [media('file://a.png'), media('file://b.png')],
  };
}

describe('serializeDraft', () => {
  it('stamps the version, the owner, and the save time', () => {
    const parsed = JSON.parse(serializeDraft(USER, emptyDraft(), NOW));
    expect(parsed.version).toBe(DRAFT_VERSION);
    expect(parsed.userId).toBe(USER);
    expect(parsed.savedAt).toBe(NOW);
  });

  it('stores image references, never bytes', () => {
    const text = serializeDraft(USER, fullDraft(), NOW);
    expect(text).toContain('file://a.png');
    // A data uri or a long base64 blob would mean media was inlined in the file.
    expect(text).not.toContain('base64');
    expect(text.length).toBeLessThan(4000);
  });
});

describe('parseDraft', () => {
  it('round-trips a complete draft', () => {
    const restored = parseDraft(serializeDraft(USER, fullDraft(), NOW), USER);
    expect(restored).toEqual(fullDraft());
  });

  it('refuses a draft written by another user', () => {
    const text = serializeDraft('someone-else', fullDraft(), NOW);
    expect(parseDraft(text, USER)).toBeNull();
  });

  it('returns null for content that is not usable', () => {
    expect(parseDraft('not json at all', USER)).toBeNull();
    expect(parseDraft('[]', USER)).toBeNull();
    expect(parseDraft('null', USER)).toBeNull();
    expect(parseDraft('{}', USER)).toBeNull();
  });

  it('ignores a draft written by a different version of the app', () => {
    const text = JSON.stringify({
      version: DRAFT_VERSION + 1,
      userId: USER,
      savedAt: NOW,
      draft: fullDraft(),
    });
    expect(parseDraft(text, USER)).toBeNull();
  });

  it('fills missing fields rather than restoring undefined', () => {
    const text = JSON.stringify({
      version: DRAFT_VERSION,
      userId: USER,
      savedAt: NOW,
      draft: { type: 'text', body: 'Hello' },
    });
    const restored = parseDraft(text, USER);
    expect(restored?.type).toBe('text');
    expect(restored?.body).toBe('Hello');
    expect(restored?.project.title).toBe('');
    expect(restored?.media).toEqual([]);
  });

  it('falls back to a known type when the stored one is unknown', () => {
    const text = JSON.stringify({
      version: DRAFT_VERSION,
      userId: USER,
      savedAt: NOW,
      draft: { type: 'hologram', body: 'x' },
    });
    expect(parseDraft(text, USER)?.type).toBe('text');
  });

  it('drops a media entry with no uri rather than restoring a broken one', () => {
    const text = JSON.stringify({
      version: DRAFT_VERSION,
      userId: USER,
      savedAt: NOW,
      draft: { type: 'image', body: '', media: [{ fileName: 'x.png' }, media('file://ok.png')] },
    });
    expect(parseDraft(text, USER)?.media).toHaveLength(1);
  });
});
