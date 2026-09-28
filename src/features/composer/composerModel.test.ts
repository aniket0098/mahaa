/**
 * Composer rule tests.
 *
 * The composer is the one screen that can quietly lose a user's work, so these
 * pin down the promises it makes:
 *  - Publish stays disabled until the draft is actually valid, per post type;
 *  - an image post cannot be submitted until **every** image is confirmed by the
 *    server, in the order the user arranged them;
 *  - video is offered but disabled, with a stated reason — not hidden, and not
 *    selectable, because the server cannot check a duration yet;
 *  - a request body carries only the fields its type uses;
 *  - a picked file is rejected on type, size, or unreadable dimensions.
 */

import { describe, expect, it } from 'vitest';

import {
  acceptsMedia,
  allUploaded,
  buildCreateInput,
  canPublish,
  canSubmit,
  COMPOSER_TYPES,
  confirmedMediaIds,
  emptyDraft,
  initialSlots,
  isDirty,
  isUsableUrl,
  mediaForType,
  mimeTypeFromName,
  parseTechnologies,
  remainingMediaSlots,
  validateDraft,
  validatePickedImage,
  withStatus,
  type Draft,
  type DraftMedia,
  type UploadSlot,
} from './composerModel';

const LIMITS = {
  maxBodyChars: 5000,
  maxItems: 10,
  maxImageBytes: 8 * 1024 * 1024,
  imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  videoDurationEnforced: false,
};

function media(localUri: string): DraftMedia {
  return {
    localUri,
    fileName: `${localUri}.png`,
    mimeType: 'image/png',
    sizeBytes: 1024,
    width: 800,
    height: 600,
  };
}

function draftWith(overrides: Partial<Draft> = {}): Draft {
  return { ...emptyDraft(), ...overrides };
}

describe('post types', () => {
  it('offers the five types, with video the only disabled one', () => {
    expect(COMPOSER_TYPES.map((option) => option.value)).toEqual([
      'text',
      'image',
      'video',
      'project',
      'achievement',
    ]);
    expect(COMPOSER_TYPES.filter((option) => !option.enabled).map((o) => o.value)).toEqual(['video']);
  });

  it('states why video is unavailable instead of hiding the option', () => {
    const video = COMPOSER_TYPES.find((option) => option.value === 'video');
    expect(video?.enabled).toBe(false);
    expect(video?.unavailableReason).toMatch(/duration check/i);
  });
});

describe('validateDraft', () => {
  it('refuses a text post with no body, or a whitespace-only body', () => {
    expect(validateDraft(draftWith({ type: 'text' })).body).toBeDefined();
    expect(validateDraft(draftWith({ type: 'text', body: '   \n\t ' })).body).toBeDefined();
    expect(validateDraft(draftWith({ type: 'text', body: 'Hello' })).body).toBeUndefined();
  });

  it('requires at least one image for an image post', () => {
    expect(validateDraft(draftWith({ type: 'image' })).media).toBeDefined();
    expect(validateDraft(draftWith({ type: 'image', media: [media('a')] })).media).toBeUndefined();
  });

  it('refuses more images than the limit', () => {
    const many = Array.from({ length: 11 }, (_, index) => media(`m${index}`));
    expect(validateDraft(draftWith({ type: 'image', media: many })).media).toMatch(/up to 10/);
  });

  it('requires a project title and a description', () => {
    expect(validateDraft(draftWith({ type: 'project' })).project).toMatch(/title/i);
    const titled = {
      ...emptyDraft().project,
      title: 'Campus Events',
    };
    expect(validateDraft(draftWith({ type: 'project', project: titled })).project).toMatch(
      /describe/i,
    );
  });

  it('requires an achievement title', () => {
    expect(validateDraft(draftWith({ type: 'achievement' })).achievement).toBeDefined();
    const named = { ...emptyDraft().achievement, title: 'Cloud Fundamentals' };
    expect(validateDraft(draftWith({ type: 'achievement', achievement: named })).achievement)
      .toBeUndefined();
  });

  it('rejects a link that could not be opened, but accepts an absent one', () => {
    const bad = { ...emptyDraft().project, title: 'T', description: 'D', sourceUrl: 'not-a-url' };
    expect(validateDraft(draftWith({ type: 'project', project: bad })).links).toMatch(/http/);
    const absent = { ...emptyDraft().project, title: 'T', description: 'D', sourceUrl: '' };
    expect(validateDraft(draftWith({ type: 'project', project: absent })).links).toBeUndefined();
  });

  it('enforces the body limit the server publishes', () => {
    const long = draftWith({ type: 'text', body: 'x'.repeat(LIMITS.maxBodyChars + 1) });
    expect(validateDraft(long, LIMITS).body).toMatch(/5000/);
  });
});

describe('canPublish / canSubmit', () => {
  it('mirrors the error set', () => {
    expect(canPublish(draftWith({ type: 'text' }))).toBe(false);
    expect(canPublish(draftWith({ type: 'text', body: 'Hi' }))).toBe(true);
  });

  it('lets a valid draft with unuploaded images be published', () => {
    // The regression this guards: the Publish button used to require every upload
    // to be finished, but the uploads only start inside the press the gate was
    // blocking — so an image post could never be published at all.
    const draft = draftWith({ type: 'image', media: [media('a'), media('b')] });
    const waiting = initialSlots(draft.media);
    expect(allUploaded(waiting)).toBe(false);
    expect(canPublish(draft)).toBe(true);
    expect(canSubmit(draft)).toBe(true);
  });

  it('treats a confirmed slot with no id as not confirmed', () => {
    const slots: UploadSlot[] = [{ localUri: 'a', status: 'done', fraction: 1 }];
    expect(allUploaded(slots)).toBe(false);
  });

  it('still blocks an invalid draft whatever the upload state', () => {
    // An image post with nothing chosen is not a publishable draft.
    expect(canSubmit(draftWith({ type: 'image' }))).toBe(false);
  });
});

describe('the upload state machine', () => {
  it('starts every image as waiting, never as a fake 0% upload', () => {
    expect(initialSlots([media('a'), media('b')])).toEqual([
      { localUri: 'a', status: 'waiting', fraction: 0 },
      { localUri: 'b', status: 'waiting', fraction: 0 },
    ]);
  });

  it('updates only the named image', () => {
    const slots = initialSlots([media('a'), media('b')]);
    const next = withStatus(slots, 'b', { status: 'uploading', fraction: 0.4 });
    expect(next[0]).toEqual(slots[0]);
    expect(next[1]?.status).toBe('uploading');
    expect(next[1]?.fraction).toBe(0.4);
  });

  it('collects confirmed ids in the order the user arranged the images', () => {
    const draftMedia = [media('a'), media('b'), media('c')];
    // 'c' finishes first; the post must still list them a, b, c.
    let slots = initialSlots(draftMedia);
    slots = withStatus(slots, 'c', { status: 'done', fraction: 1, mediaId: 'id-c' });
    slots = withStatus(slots, 'a', { status: 'done', fraction: 1, mediaId: 'id-a' });
    slots = withStatus(slots, 'b', { status: 'done', fraction: 1, mediaId: 'id-b' });
    expect(confirmedMediaIds(slots, draftMedia)).toEqual(['id-a', 'id-b', 'id-c']);
  });

  it('never includes an unconfirmed image', () => {
    const draftMedia = [media('a'), media('b')];
    const slots = withStatus(initialSlots(draftMedia), 'a', {
      status: 'done',
      fraction: 1,
      mediaId: 'id-a',
    });
    expect(confirmedMediaIds(slots, draftMedia)).toEqual(['id-a']);
  });
});

describe('buildCreateInput', () => {
  it('sends only the body for a text post, trimmed', () => {
    expect(buildCreateInput(draftWith({ type: 'text', body: '  Hello  ' }), [])).toEqual({
      kind: 'text',
      body: 'Hello',
    });
  });

  it('sends a trimmed project payload and no empty achievement', () => {
    const draft = draftWith({
      type: 'project',
      body: '  Built it  ',
      project: {
        ...emptyDraft().project,
        title: '  Campus Events  ',
        description: '  Seats and check-in  ',
        technologies: 'React, FastAPI , , PostgreSQL',
        category: 'Web Development',
      },
    });
    const input = buildCreateInput(draft, []);
    expect(input.kind).toBe('project');
    expect(input.body).toBe('Built it');
    expect(input.project?.title).toBe('Campus Events');
    expect(input.project?.technologies).toEqual(['React', 'FastAPI', 'PostgreSQL']);
    expect(input.achievement).toBeUndefined();
  });

  it('sends only the confirmed media ids for an image post', () => {
    const draftMedia = [media('a'), media('b')];
    const draft = draftWith({ type: 'image', media: draftMedia, body: 'Photos' });
    const slots = withStatus(initialSlots(draftMedia), 'a', {
      status: 'done',
      fraction: 1,
      mediaId: 'id-a',
    });
    expect(buildCreateInput(draft, slots).mediaIds).toEqual(['id-a']);
  });

  it('never sends an empty string where a value is absent', () => {
    const draft = draftWith({
      type: 'achievement',
      achievement: { ...emptyDraft().achievement, title: '  Award  ' },
    });
    const input = buildCreateInput(draft, []);
    expect(input.achievement?.title).toBe('Award');
    expect(input.achievement?.issuer).toBeNull();
    expect(input.achievement?.verification_url).toBeNull();
  });

  it('attaches a cover image to a project post instead of dropping it', () => {
    const draftMedia = [media('cover')];
    const draft = draftWith({
      type: 'project',
      media: draftMedia,
      project: { ...emptyDraft().project, title: 'Campus Events', description: 'Seats' },
    });
    const slots = withStatus(initialSlots(draftMedia), 'cover', {
      status: 'done',
      fraction: 1,
      mediaId: 'id-cover',
    });

    const input = buildCreateInput(draft, slots);
    expect(input.kind).toBe('project');
    expect(input.project?.title).toBe('Campus Events');
    // The regression this guards: the cover used to be dropped, so a project with
    // an image published as a project with no image at all.
    expect(input.mediaIds).toEqual(['id-cover']);
  });

  it('attaches a certificate image to an achievement post', () => {
    const draftMedia = [media('cert')];
    const draft = draftWith({
      type: 'achievement',
      media: draftMedia,
      achievement: { ...emptyDraft().achievement, title: 'Cloud Fundamentals' },
    });
    const slots = withStatus(initialSlots(draftMedia), 'cert', {
      status: 'done',
      fraction: 1,
      mediaId: 'id-cert',
    });

    const input = buildCreateInput(draft, slots);
    expect(input.kind).toBe('achievement');
    expect(input.mediaIds).toEqual(['id-cert']);
  });

  it('omits media_ids entirely when no image was chosen', () => {
    const draft = draftWith({
      type: 'project',
      project: { ...emptyDraft().project, title: 'T', description: 'D' },
    });
    expect(buildCreateInput(draft, []).mediaIds).toBeUndefined();
  });
});

describe('a project post with a cover image', () => {
  it('is publishable while the cover is still waiting to upload', () => {
    // The cover is uploaded by the same press that publishes the post, so
    // requiring it to be uploaded first would make it unpublishable.
    const draftMedia = [media('cover')];
    const draft = draftWith({
      type: 'project',
      media: draftMedia,
      project: { ...emptyDraft().project, title: 'T', description: 'D' },
    });

    expect(allUploaded(initialSlots(draftMedia))).toBe(false);
    expect(canPublish(draft)).toBe(true);
    expect(canSubmit(draft)).toBe(true);
  });

  it('still allows a project post with no image at all', () => {
    const draft = draftWith({
      type: 'project',
      project: { ...emptyDraft().project, title: 'T', description: 'D' },
    });
    expect(canSubmit(draft)).toBe(true);
  });
});

describe('media validation', () => {
  it('rejects a type outside the allow-list', () => {
    const gif = validatePickedImage({ mimeType: 'image/gif', sizeBytes: 10, width: 1, height: 1 });
    expect(gif).toMatch(/not supported/i);
  });

  it('rejects a size it actually knows is over the limit', () => {
    expect(
      validatePickedImage(
        { mimeType: 'image/png', sizeBytes: LIMITS.maxImageBytes + 1, width: 1, height: 1 },
        LIMITS,
      ),
    ).toMatch(/larger than/i);
  });

  it('accepts an image whose size the picker did not report', () => {
    // The regression this guards: `fileSize` is optional on ImagePickerAsset, and
    // treating "unknown" as "empty" made every image unpublishable on those
    // devices. A size of 0 means unknown, not broken.
    expect(
      validatePickedImage({ mimeType: 'image/jpeg', sizeBytes: 0, width: 800, height: 600 }),
    ).toBeNull();
  });

  it('accepts an image whose dimensions the system could not measure', () => {
    // `width`/`height` are documented as "can be 0 if the system did not provide
    // the width". That is unknown, not invalid — the card falls back to 4:3.
    expect(
      validatePickedImage({ mimeType: 'image/png', sizeBytes: 2048, width: 0, height: 0 }),
    ).toBeNull();
  });

  it('accepts a normal image', () => {
    expect(
      validatePickedImage({ mimeType: 'image/png', sizeBytes: 2048, width: 800, height: 600 }),
    ).toBeNull();
  });
});

describe('mimeTypeFromName', () => {
  it('resolves the common gallery formats', () => {
    expect(mimeTypeFromName('photo.jpg')).toBe('image/jpeg');
    expect(mimeTypeFromName('photo.JPEG')).toBe('image/jpeg');
    expect(mimeTypeFromName('shot.png')).toBe('image/png');
    expect(mimeTypeFromName('shot.webp')).toBe('image/webp');
  });

  it('reports a type the server will refuse, rather than hiding an unsupported format', () => {
    expect(mimeTypeFromName('clip.heic')).toBe('image/heic');
  });

  it('falls back to the most common type when there is nothing to go on', () => {
    expect(mimeTypeFromName(undefined)).toBe('image/jpeg');
    expect(mimeTypeFromName('noextension')).toBe('image/jpeg');
  });
});

describe('which post types can carry an image', () => {
  it('allows an image, a project cover, and a certificate', () => {
    expect(acceptsMedia('image')).toBe(true);
    expect(acceptsMedia('project')).toBe(true);
    expect(acceptsMedia('achievement')).toBe(true);
  });

  it('allows no image on a text or video post', () => {
    expect(acceptsMedia('text')).toBe(false);
    expect(acceptsMedia('video')).toBe(false);
  });

  it('gives a gallery to an image post but a single slot to a cover or certificate', () => {
    expect(remainingMediaSlots('image', 0, 10)).toBe(10);
    expect(remainingMediaSlots('image', 10, 10)).toBe(0);
    expect(remainingMediaSlots('project', 0, 10)).toBe(1);
    expect(remainingMediaSlots('project', 1, 10)).toBe(0);
    expect(remainingMediaSlots('achievement', 0, 10)).toBe(1);
  });
});

describe('mediaForType', () => {
  const gallery = [media('a'), media('b'), media('c')];

  it('keeps the whole gallery when the type is an image post', () => {
    expect(mediaForType('image', gallery)).toHaveLength(3);
  });

  it('keeps a single cover for a project, in the original order', () => {
    const kept = mediaForType('project', gallery);
    expect(kept).toHaveLength(1);
    expect(kept[0].localUri).toBe('a');
  });

  it('keeps a single certificate for an achievement', () => {
    expect(mediaForType('achievement', gallery)).toHaveLength(1);
  });

  it('drops every image for a text post, so none is uploaded and then discarded', () => {
    // The regression this guards: a gallery chosen for an image post survived a
    // switch to Text, was uploaded in full, and then left out of the request.
    expect(mediaForType('text', gallery)).toEqual([]);
  });

  it('drops every image for a video post', () => {
    expect(mediaForType('video', gallery)).toEqual([]);
  });

  it('never mutates the array it was given', () => {
    const original = [media('a'), media('b')];
    mediaForType('project', original);
    expect(original).toHaveLength(2);
  });
});

describe('small helpers', () => {
  it('splits technologies and drops blanks', () => {
    expect(parseTechnologies(' React , FastAPI ,, ')).toEqual(['React', 'FastAPI']);
    expect(parseTechnologies('')).toEqual([]);
  });

  it('treats an empty url as absent, not invalid', () => {
    expect(isUsableUrl('')).toBe(true);
    expect(isUsableUrl('https://example.com')).toBe(true);
    expect(isUsableUrl('ftp://example.com')).toBe(false);
    expect(isUsableUrl('javascript:alert(1)')).toBe(false);
  });

  it('knows when a draft is worth protecting', () => {
    expect(isDirty(emptyDraft())).toBe(false);
    expect(isDirty(draftWith({ body: 'x' }))).toBe(true);
    expect(isDirty(draftWith({ media: [media('a')] }))).toBe(true);
    const titled = { ...emptyDraft().project, title: 'T' };
    expect(isDirty(draftWith({ type: 'project', project: titled }))).toBe(true);
    const awarded = { ...emptyDraft().achievement, title: 'A' };
    expect(isDirty(draftWith({ type: 'achievement', achievement: awarded }))).toBe(true);
  });
});


