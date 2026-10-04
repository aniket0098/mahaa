/**
 * The `POST /posts` request contract.
 *
 * **The defect this exists to prevent.** `PostCreate.category` is required by the
 * server and stored verbatim rather than derived, yet `createPost` never sent it,
 * so **every publish from the app failed with a 422** — `body.category: Field
 * required`. It went unnoticed because no test ever inspected the serialised body,
 * and because the web upload blocker failed first, so no publish was even attempted.
 *
 * **These tests assert the real serialised body**, by intercepting the HTTP call,
 * not by type-checking a return value. A type test would have passed while the
 * field was missing from the request entirely, which is exactly what happened.
 */

import {
  buildCreateInput,
  emptyDraft,
  emptyAchievement,
  emptyProject,
  type Draft,
  type DraftMedia,
  type UploadSlot,
} from './composerModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `@/api/posts` reaches `@/api/media`, which reaches `expo-file-system` and then
// `react-native` ' Flow source a Node runner cannot parse. The url rule has
// its own tests; here it only has to exist for the module to load.
vi.mock('@/api/media', () => ({
  absoluteMediaUri: (servedAt: string) => servedAt,
}));


// Hoisted, so a fresh `@/api/posts` import picks it up. The binding is prefixed
// `mock` because vitest only lets a mock factory close over `mock*` names.
const mockPost = vi.fn(async () => ({
  id: 'p1',
  kind: 'text',
  category: 'community',
  title: null,
  body: 'b',
  media: [],
  project: null,
  achievement: null,
  tags: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  author: {
    name: 'A',
    headline: null,
    avatar_url: null,
    verified: false,
    is_self: true,
    public_id: 'x',
    username: 'u',
  },
}));

vi.mock('@/api/client', () => ({
  apiClient: { post: mockPost },
}));

/** Every request body the client was actually asked to send. */
const bodies = (): Record<string, unknown>[] =>
  (mockPost.mock.calls as unknown as [string, { body: Record<string, unknown> }][]).map(
    (call) => call[1].body,
  );

beforeEach(() => {
  mockPost.mockClear();
});

function media(kind: 'image' | 'video'): DraftMedia {
  return {
    localUri: kind === 'video' ? 'file://v1' : 'file://i1',
    kind,
    fileName: kind === 'video' ? 'v.mp4' : 'i.png',
    mimeType: kind === 'video' ? 'video/mp4' : 'image/png',
    sizeBytes: 2048,
    width: 800,
    height: 600,
  };
}

function uploaded(m: DraftMedia): UploadSlot {
  return { localUri: m.localUri, status: 'done', fraction: 1, mediaId: 'asset-1' };
}

/** Sends the draft through the real module and returns the JSON actually put on the wire. */
async function publish(draft: Draft, slots: readonly UploadSlot[]) {
  const { createPost } = await import('@/api/posts');
  await createPost(buildCreateInput(draft, slots));
  const sent = bodies();
  return sent[sent.length - 1] as Record<string, unknown>;
}

describe('every composer type produces a valid PostCreate', () => {
  it('a text post sends a category', async () => {
    const body = await publish({ ...emptyDraft(), type: 'text', body: 'Hello' }, []);
    expect(body).toMatchObject({ kind: 'text', category: 'community', body: 'Hello' });
  });

  it('an image post sends a category and its media ids', async () => {
    const m = media('image');
    const body = await publish({ ...emptyDraft(), type: 'image', media: [m] }, [uploaded(m)]);
    expect(body).toMatchObject({
      kind: 'image',
      category: 'community',
      media_ids: ['asset-1'],
    });
  });

  it('a video post sends a category and its media ids', async () => {
    const m = media('video');
    const body = await publish({ ...emptyDraft(), type: 'video', media: [m] }, [uploaded(m)]);
    expect(body).toMatchObject({
      kind: 'video',
      category: 'community',
      media_ids: ['asset-1'],
    });
  });

  it('a project post files under the projects category', async () => {
    const body = await publish(
      { ...emptyDraft(), type: 'project', project: { ...emptyProject(), title: 'T', description: 'D' } },
      [],
    );
    expect(body).toMatchObject({ kind: 'project', category: 'projects' });
    expect(body.project).toMatchObject({ title: 'T' });
  });

  it('an achievement post files under the achievements category', async () => {
    const body = await publish(
      { ...emptyDraft(), type: 'achievement', achievement: { ...emptyAchievement(), title: 'A' } },
      [],
    );
    expect(body).toMatchObject({ kind: 'achievement', category: 'achievements' });
    expect(body.achievement).toMatchObject({ title: 'A' });
  });
});

describe('the category is derived, not defaulted away', () => {
  it('a project never lands in community, which would hide it from its filter chip', () => {
    expect(buildCreateInput({ ...emptyDraft(), type: 'project', project: emptyProject() }, []).category).toBe('projects');
  });

  it('an achievement never lands in community', () => {
    expect(buildCreateInput({ ...emptyDraft(), type: 'achievement', achievement: emptyAchievement() }, []).category).toBe('achievements');
  });

  it('every type sends one of the four categories the server accepts', () => {
    const allowed = new Set(['projects', 'achievements', 'learning', 'community']);
    for (const type of ['text', 'image', 'video', 'project', 'achievement'] as const) {
      const input = buildCreateInput({ ...emptyDraft(), type }, []);
      expect(input.category, type).toBeDefined();
      expect(allowed.has(input.category as string), type).toBe(true);
    }
  });

  it('no type can send the field as undefined, which is the 422', () => {
    for (const type of ['text', 'image', 'video', 'project', 'achievement'] as const) {
      expect(buildCreateInput({ ...emptyDraft(), type }, []).category, type).toBeTruthy();
    }
  });
});

describe('createPost always sends a category, whatever the caller passed', () => {
  it('falls back to community rather than omitting the required field', async () => {
    const { createPost } = await import('@/api/posts');
    await createPost({ kind: 'text', body: 'no category given' });
    expect(bodies()[0]).toMatchObject({ kind: 'text', category: 'community' });
  });

  it('keeps a caller supplied category', async () => {
    const { createPost } = await import('@/api/posts');
    await createPost({ kind: 'text', category: 'projects', body: 'x' });
    expect(bodies()[0]).toMatchObject({ category: 'projects' });
  });

  it('leaves the existing media fields intact', async () => {
    const { createPost } = await import('@/api/posts');
    await createPost({ kind: 'image', body: 'x', mediaIds: ['m1'], title: 'T' });
    expect(bodies()[0]).toMatchObject({
      kind: 'image',
      category: 'community',
      body: 'x',
      title: 'T',
      media_ids: ['m1'],
    });
  });
});
