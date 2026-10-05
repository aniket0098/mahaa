/**
 * The story draft rules (Phase 12).
 *
 * These exist because `POST /stories` gained its first mobile caller. Before
 * that the route was unreachable from the app, so nothing here had a reason to
 * exist — and the failure this guards is a 422 the user cannot act on, which is
 * why the caption rule, the type vocabulary and the request shape are all pinned
 * rather than left to the server.
 *
 * **Separate from `storyModel.test.ts`**, which covers the reading side (rings,
 * labels, relative time). The split is by concern: those are about how a story
 * is displayed, these are about whether one may be written.
 */
import { describe, expect, it } from 'vitest';

import {
  buildStoryInput,
  canPublishStory,
  emptyStoryDraft,
  MAX_STORY_CAPTION_CHARS,
  STORY_CONTENT_TYPES,
  storyCaptionLength,
  storyMediaKindFor,
  STORY_TTL_HOURS,
  validateStoryDraft,
  type StoryDraft,
} from './storyModel';

function draft(overrides: Partial<StoryDraft> = {}): StoryDraft {
  return { ...emptyStoryDraft(), caption: 'Hello', ...overrides };
}

describe('emptyStoryDraft', () => {
  it('starts empty, with no media, and unpublishable', () => {
    // The gate must start shut: a screen that mounts with a valid draft would
    // let an empty tap publish a blank story.
    expect(emptyStoryDraft().caption).toBe('');
    expect(emptyStoryDraft().media).toBeNull();
    expect(canPublishStory(emptyStoryDraft())).toBe(false);
  });

  it('defaults to the category that fits anything', () => {
    // `announcement` is the only value that is never *wrong*; defaulting to
    // `job` would mislabel every other kind of story.
    expect(emptyStoryDraft().contentType).toBe('announcement');
  });
});

describe('validateStoryDraft', () => {
  it('refuses an empty caption, because the server requires one', () => {
    // `StoryCreate.caption` has min_length=1, so an empty caption is a 422.
    expect(validateStoryDraft(draft({ caption: '' })).caption).toBeTruthy();
    expect(canPublishStory(draft({ caption: '' }))).toBe(false);
  });

  it('treats a whitespace-only caption as empty', () => {
    // The server counts the stored string, and a trim would leave it empty.
    expect(validateStoryDraft(draft({ caption: '   \n  ' })).caption).toBeTruthy();
  });

  it('accepts a caption that is only whitespace around real text', () => {
    expect(validateStoryDraft(draft({ caption: '  hello  ' })).caption).toBeUndefined();
  });

  it('refuses a caption past the server ceiling', () => {
    const tooLong = 'a'.repeat(MAX_STORY_CAPTION_CHARS + 1);
    expect(validateStoryDraft(draft({ caption: tooLong })).caption).toBeTruthy();
    const atLimit = 'a'.repeat(MAX_STORY_CAPTION_CHARS);
    expect(validateStoryDraft(draft({ caption: atLimit })).caption).toBeUndefined();
  });

  it('refuses a content type the server does not accept', () => {
    // Unreachable through the picker; it is the guard for a value from anywhere
    // else (a restored draft, a future refactor).
    const bogus = draft({ contentType: 'image' as StoryDraft['contentType'] });
    expect(validateStoryDraft(bogus).contentType).toBeTruthy();
    expect(canPublishStory(bogus)).toBe(false);
  });

  it('accepts every type it offers', () => {
    // The offered list and the accepted list are the same set. If they drift,
    // the picker offers something that 422s on publish.
    for (const option of STORY_CONTENT_TYPES) {
      expect(validateStoryDraft(draft({ contentType: option.value }))).toEqual({});
    }
  });
});

describe('the offered story types', () => {
  it('is exactly the server vocabulary — no invented category', () => {
    // §10.1's `StoryContentType`. A fifth chip would be a guaranteed 422.
    expect(STORY_CONTENT_TYPES.map((o) => o.value).sort()).toEqual([
      'announcement',
      'event',
      'internship',
      'job',
    ]);
  });

  it('gives every option a label and a hint, so no chip is blank', () => {
    for (const option of STORY_CONTENT_TYPES) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('buildStoryInput', () => {
  it('returns null for an unpublishable draft rather than a partial body', () => {
    // A half-built request is a 422 the user has to interpret; returning null is
    // what lets the screen keep the button disabled instead.
    expect(buildStoryInput(draft({ caption: '' }))).toBeNull();
  });

  it('carries the caption trimmed, because the server counts what it stores', () => {
    expect(buildStoryInput(draft({ caption: '  hi  ' }))?.caption).toBe('hi');
  });

  it('carries the chosen category, not a media kind', () => {
    // The server's field is a category. Sending `image` here is a 422, which is
    // the trap this type exists to make unmissable.
    expect(buildStoryInput(draft({ contentType: 'event' }))?.contentType).toBe('event');
  });

  it('sends no media id for a text-only story', () => {
    expect(buildStoryInput(draft())?.mediaId).toBeNull();
  });

  it('carries the uploaded media id when there is one', () => {
    expect(buildStoryInput(draft(), 'media-1')?.mediaId).toBe('media-1');
  });
});

describe('storyMediaKindFor', () => {
  it('reads a video mime as a video', () => {
    // Sending a video as `?kind=image` fails the server's magic-byte check,
    // which reads to the user as a broken upload.
    expect(storyMediaKindFor('video/mp4')).toBe('video');
    expect(storyMediaKindFor('video/quicktime')).toBe('video');
  });

  it('treats an image or an unknown mime as an image', () => {
    // The picker often omits the type; the server's sniffing is the real
    // authority, and `image` is the safe default.
    expect(storyMediaKindFor('image/png')).toBe('image');
    expect(storyMediaKindFor(null)).toBe('image');
    expect(storyMediaKindFor(undefined)).toBe('image');
  });
});

describe('storyCaptionLength', () => {
  it('counts the trimmed caption, matching what is validated', () => {
    // The counter and the rule must read the same string, or the number turns
    // red while the story is still publishable.
    expect(storyCaptionLength(draft({ caption: '   abc  ' }))).toBe(3);
    expect(storyCaptionLength(draft({ caption: '   ' }))).toBe(0);
  });
});

describe('STORY_TTL_HOURS', () => {
  it('is the server default window', () => {
    // §10.2's `created_at + interval '24h'`. The screen states it to the user,
    // so a value that disagreed with the server would be a broken promise.
    expect(STORY_TTL_HOURS).toBe(24);
  });
});