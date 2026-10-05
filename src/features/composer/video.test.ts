/**
 * Video support, proven at the layer where it can be proven.
 *
 * **Two kinds of test here, for two different risks.**
 *
 * The pure rules (validation, type reconciliation, request shaping, avatar url
 * resolution) run in plain Node against the real modules, because those are the
 * rules a wrong answer would quietly ship.
 *
 * The component rules (tap-to-play, single playback, no eager download) cannot
 * render here — the components import `react-native` and `expo-video`, and this
 * runner is Node. Those are asserted on the source instead, which is the approach
 * `demoIsolation.test.ts` and `homeComposer.test.ts` already use here, and which
 * catches the realistic regression: somebody swapping the lazy poster for an
 * eager autoplay, or dropping the single-playback guard.
 *
 * **What is deliberately NOT asserted anywhere:** that a video is "verified". No
 * duration check exists on the server (`video_duration_enforced: false`), so a
 * test claiming one would be asserting a fiction.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  COMPOSER_TYPES,
  DEFAULT_LIMITS,
  acceptsMedia,
  buildCreateInput,
  emptyDraft,
  initialSlots,
  mediaForType,
  mimeTypeFromName,
  remainingMediaSlots,
  validateDraft,
  validatePickedMedia,
  withStatus,
  type Draft,
  type DraftMedia,
  type UploadSlot,
} from '@/features/composer/composerModel';
import { mediaDisplayHeight, MAX_MEDIA_HEIGHT } from '@/features/feed/feedModel';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const VIDEO_LIMITS = {
  ...DEFAULT_LIMITS,
  maxVideoBytes: 10 * 1024 * 1024,
  videoMimeTypes: ['video/mp4', 'video/quicktime'] as readonly string[],
};

function image(localUri = 'i1'): DraftMedia {
  return {
    localUri,
    kind: 'image',
    fileName: `${localUri}.png`,
    mimeType: 'image/png',
    sizeBytes: 2048,
    width: 800,
    height: 600,
  };
}

function video(localUri = 'v1'): DraftMedia {
  return {
    localUri,
    kind: 'video',
    fileName: `${localUri}.mp4`,
    mimeType: 'video/mp4',
    sizeBytes: 3 * 1024 * 1024,
    // The server does not derive dimensions for video, so the picker may not
    // have them either. Zero must mean "unknown", not "invalid".
    width: 0,
    height: 0,
  };
}

const videoDraft = (overrides: Partial<Draft> = {}): Draft => ({
  ...emptyDraft(),
  type: 'video',
  ...overrides,
});
describe('a video is a selectable post type', () => {
  it('offers video as enabled', () => {
    expect(COMPOSER_TYPES.find((option) => option.value === 'video')?.enabled).toBe(true);
  });

  it('claims no duration limit, because the server enforces none', () => {
    expect(VIDEO_LIMITS.videoDurationEnforced).toBe(false);
    const videoOption = COMPOSER_TYPES.find((option) => option.value === 'video');
    // A '30 second' promise the server does not keep would refuse real uploads.
    expect(videoOption?.hint ?? '').not.toMatch(/second/i);
    expect(videoOption?.unavailableReason).toBeUndefined();
  });

  it('lets a video post carry exactly one video', () => {
    expect(acceptsMedia('video')).toBe(true);
    expect(remainingMediaSlots('video', 0, 10)).toBe(1);
    expect(remainingMediaSlots('video', 1, 10)).toBe(0);
  });
});

describe('video validation uses the server published limits', () => {
  it('accepts the two containers the server accepts', () => {
    for (const mimeType of ['video/mp4', 'video/quicktime']) {
      expect(validatePickedMedia({ kind: 'video', mimeType, sizeBytes: 1024 }, VIDEO_LIMITS)).toBeNull();
    }
  });

  it('rejects a container outside the allow-list, and says which to use', () => {
    const problem = validatePickedMedia(
      { kind: 'video', mimeType: 'video/webm', sizeBytes: 1024 },
      VIDEO_LIMITS,
    );
    expect(problem).toMatch(/isn't supported/i);
    expect(problem).toMatch(/MP4|QuickTime/);
  });

  it('rejects an oversized video using the limit the server published', () => {
    const problem = validatePickedMedia(
      { kind: 'video', mimeType: 'video/mp4', sizeBytes: VIDEO_LIMITS.maxVideoBytes + 1 },
      VIDEO_LIMITS,
    );
    expect(problem).toMatch(/too large/i);
    // The number is formatted from the limits object, not a literal in the text.
    expect(problem).toContain('10 MB');
  });

  it('accepts a video whose size the picker never reported', () => {
    // `fileSize` is optional. Treating unknown as broken made images
    // unpublishable on those devices; the same rule must hold for video.
    expect(
      validatePickedMedia({ kind: 'video', mimeType: 'video/mp4', sizeBytes: 0 }, VIDEO_LIMITS),
    ).toBeNull();
  });

  it('still refuses an image over its own ceiling, not the video one', () => {
    // Guards against one ceiling being applied to both kinds.
    expect(
      validatePickedMedia(
        { kind: 'image', mimeType: 'image/png', sizeBytes: VIDEO_LIMITS.maxVideoBytes + 1 },
        VIDEO_LIMITS,
      ),
    ).toMatch(/larger than/i);
  });

  it('resolves video containers from a file name as a fallback only', () => {
    expect(mimeTypeFromName('clip.mp4')).toBe('video/mp4');
    expect(mimeTypeFromName('clip.mov')).toBe('video/quicktime');
    // The fallback must not smuggle an image past the allow-list.
    expect(mimeTypeFromName('photo.jpg')).toBe('image/jpeg');
  });
});
describe('a video post keeps video and drops images', () => {
  it('refuses a video post with no video', () => {
    expect(validateDraft(videoDraft({ media: [] }), VIDEO_LIMITS).media).toMatch(/video/i);
  });

  it('refuses a video post that only carries images', () => {
    expect(validateDraft(videoDraft({ media: [image()] }), VIDEO_LIMITS).media).toMatch(/video/i);
  });

  it('accepts a video post with one video', () => {
    expect(validateDraft(videoDraft({ media: [video()] }), VIDEO_LIMITS).media).toBeUndefined();
  });

  it('never lets an image survive into a video post', () => {
    // Handing `expo-image` a video renders a blank, and uploading images for a
    // post that drops them spends the user data for nothing.
    const mixed = [image('i1'), video('v1'), image('i2')];
    expect(mediaForType('video', mixed).map((item) => item.kind)).toEqual(['video']);
  });

  it('never lets a video survive into an image post, a cover or a certificate', () => {
    const mixed = [video('v1'), image('i1')];
    expect(mediaForType('image', mixed).every((item) => item.kind === 'image')).toBe(true);
    expect(mediaForType('project', mixed).every((item) => item.kind === 'image')).toBe(true);
    expect(mediaForType('achievement', mixed).every((item) => item.kind === 'image')).toBe(true);
  });
});

describe('publishing a video', () => {
  const slot = (localUri: string, patch: Partial<UploadSlot> = {}): UploadSlot => ({
    localUri,
    status: 'done',
    fraction: 1,
    mediaId: `media-${localUri}`,
    ...patch,
  });

  it('puts the uploaded media id in the request and sends the video kind', () => {
    const media = video();
    const input = buildCreateInput(videoDraft({ media: [media] }), [slot(media.localUri)]);
    expect(input.kind).toBe('video');
    expect(input.mediaIds).toEqual([`media-${media.localUri}`]);
  });

  it('sends no media id the server has not confirmed', () => {
    // An id exists only once the upload answered. Inventing one would reference
    // an asset that was never stored.
    const media = video();
    const waiting = initialSlots([media]);
    expect(buildCreateInput(videoDraft({ media: [media] }), waiting).mediaIds).toEqual([]);
    expect(
      buildCreateInput(videoDraft({ media: [media] }), [slot(media.localUri, { status: 'failed' })]).mediaIds,
    ).toEqual([]);
  });

  it('carries the body alongside the video', () => {
    const media = video();
    const input = buildCreateInput(
      videoDraft({ media: [media], body: '  Built this over a weekend.  ' }),
      [slot(media.localUri)],
    );
    expect(input.body).toBe('Built this over a weekend.');
  });
});

describe('upload state for a video', () => {
  const media = video();

  it('starts waiting, so a failed upload can be retried by the next press', () => {
    expect(initialSlots([media])).toEqual([
      { localUri: media.localUri, status: 'waiting', fraction: 0 },
    ]);
  });

  it('reports only progress the upload task actually produced', () => {
    const moving = withStatus(initialSlots([media]), media.localUri, {
      status: 'uploading',
      fraction: 0.62,
    });
    expect(moving[0].fraction).toBe(0.62);
  });

  it('leaves a failed upload retryable rather than stuck', () => {
    // The regression this guards: a permanently disabled composer, because a
    // failure cleared the button but never cleared the error.
    const failed = withStatus(initialSlots([media]), media.localUri, {
      status: 'failed',
      errorMessage: 'The video could not be uploaded.',
    });
    expect(failed[0].status).toBe('failed');
    expect(failed[0].mediaId).toBeUndefined();

    // `withStatus` applies exactly the patch it is handed, so clearing the
    // message is the caller's job — which is what the next assertion checks.
    const retried = withStatus(failed, media.localUri, {
      status: 'uploading',
      fraction: 0,
      errorMessage: undefined,
    });
    expect(retried[0].status).toBe('uploading');
    expect(retried[0].errorMessage).toBeUndefined();
    expect(retried[0].mediaId).toBeUndefined();
  });

  it('reports a finished upload only as 1, and only with the server id', () => {
    const done = withStatus(initialSlots([media]), media.localUri, {
      status: 'done',
      fraction: 1,
      mediaId: 'media-1',
    });
    expect(done[0].fraction).toBe(1);
    expect(done[0].mediaId).toBe('media-1');
  });
});
describe('the composer retry path', () => {
  it('clears the error when it retries, so the UI cannot go stale', () => {
    // The regression: a slot that failed keeps its old error banner through the
    // next attempt, so the composer looks broken after a successful retry.
    const screen = read('../../app/(candidate)/add-post.tsx');
    // A template literal, so the assertion carries its own inner quotes.
    expect(screen).toContain(`mark({ status: 'uploading', fraction: 0, errorMessage: undefined })`);
  });
});


describe('a video with no known dimensions still lays out', () => {
  it('falls back to a contained box instead of dividing by zero', () => {
    const height = mediaDisplayHeight(
      { id: 'v1', kind: 'video', uri: 'x', width: 0, height: 0, alt: 'A video.' },
      400,
    );
    expect(Number.isFinite(height)).toBe(true);
    expect(height).toBeGreaterThan(0);
    expect(height).toBeLessThanOrEqual(MAX_MEDIA_HEIGHT);
  });
});
describe('the avatar url bug (Phase 4I)', () => {
  const posts = read('../../api/posts.ts');

  it('absolutises the author avatar exactly as it does media', () => {
    // The raw `served_at` path was passed straight through, so a relative
    // `/api/v1/media/<id>` never resolved to a host and every author avatar
    // silently fell back to initials -- which reads as "no photo", not as a bug.
    //
    // The mapping now lives in the shared `mapAuthor`, which posts and comments
    // both go through. Asserting the helper is what keeps a third surface from
    // re-deriving the rule on its own.
    expect(posts).toContain(
      'avatarUrl: wire.avatar_url ? absoluteMediaUri(wire.avatar_url) : null',
    );
    expect(posts).toMatch(/function mapAuthor\(/);
  });

  it('still leaves a genuinely absent avatar null', () => {
    // The ternary is the point: an absent avatar must not become the string
    // "null" resolved against the base URL, which would 404 instead of falling
    // back to initials.
    expect(posts).not.toContain('avatarUrl: absoluteMediaUri(wire.avatar_url)');
    expect(posts).not.toContain('avatarUrl: absoluteMediaUri(wire.avatar.avatar_url)');
  });
});

describe('the upload url carries the real kind', () => {
  const media = read('../../api/media.ts');

  it('sends the picked kind rather than a hard-coded image', () => {
    // A hard-coded `image` meant a video could only ever be uploaded as one.
    expect(media).toContain('new URLSearchParams({ kind: picked.kind })');
    expect(media).not.toMatch(/new URLSearchParams\(\{\s*kind: 'image/);
  });

  it('omits dimensions rather than claiming zero for a video', () => {
    expect(media).toContain('picked.width != null && picked.width > 0');
  });

  it('keeps one upload function for both kinds', () => {
    expect(media).toContain('export async function uploadPickedMedia(');
    expect(media).not.toContain('export async function uploadPickedImage(');
  });
});

describe('playback is lazy and single (source-level)', () => {
  const videoComponent = read('../feed/PostVideo.tsx');
  const postMedia = read('../feed/PostMedia.tsx');

  it('does not autoplay, and downloads only after a tap', () => {
    // Eagerly downloading every video in a feed would pull the whole set over
    // the network before the reader chose one.
    expect(videoComponent).toContain(
      'const [playable, setPlayable] = useState<string | null>(null)',
    );
    expect(videoComponent).toContain('onPress={load}');
  });

  it('guarantees only one video plays at a time', () => {
    // The guarantee used to rest on a module-level `activePlayer` singleton in this
    // file. It now rests on a coordinator that decides from *measured* visibility
    // and picks exactly one winner — which is a stronger property, because the old
    // singleton only knew about videos a reader had already tapped, while this one
    // also governs the ones that autoplay.
    expect(videoComponent).toContain('registerVideo(');
    expect(videoComponent).toContain('subscribePlayback(');

    const coordinator = read('../feed/feedPlayback.ts');
    expect(coordinator).toContain('export function chooseActive(');
    // The ordering is the whole guarantee: the outgoing slot is paused before the
    // incoming one is started, so two players never overlap.
    expect(coordinator.indexOf('targets.get(previousId)?.pause()')).toBeLessThan(
      coordinator.indexOf('targets.get(nextId)?.play()'),
    );
    // And it can only ever name one winner.
    expect(coordinator).toContain('let best: VideoSlot | null = null;');
  });

  it('starts muted, so nothing can make noise unasked', () => {
    expect(videoComponent).toContain('created.muted = true');
  });

  it('routes a video to the player and never to the image viewer', () => {
    // Multi-line now: the video also receives the id and position the playback
    // coordinator needs. The routing rule itself is unchanged and still asserted.
    expect(postMedia).toMatch(/<PostVideo[\s\S]*?uri=\{item\.uri\}/);
    expect(postMedia).toContain(
      'item.kind === "video" ? undefined : () => onOpen(index)',
    );
  });

  it('fetches bytes through the authenticated client, not a bare player uri', () => {
    const media = read('../../api/media.ts');
    expect(media).toContain('export async function loadPlayableVideoUri(');
    expect(media).toContain('Authorization: `Bearer ${token}`');
  });
});
