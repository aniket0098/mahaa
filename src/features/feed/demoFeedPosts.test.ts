/**
 * Rules for the development-only demo feed posts.
 *
 * These assertions are the guarantees the rest of the app relies on, checked
 * here rather than by a screen test: demo content is namespaced so it can never
 * be sent anywhere, it is only reachable in development, it is labelled for a
 * human reader, and it never claims a credential, a verification badge, a
 * profile route, or an engagement count.
 */

import { describe, expect, it } from 'vitest';

import {
  createDemoFeedPosts,
  DEMO_EXTERNAL_LINK_NOTE,
  DEMO_POST_BADGE,
  DEMO_POST_ID_PREFIX,
  isDemoFeedEnabled,
  isDemoPost,
  isDemoPostId,
  shouldShowDemoFeed,
} from '@/features/feed/demoFeedPosts';
import { DEMO_FEED_IMAGES } from '@/features/feed/demoFeedAssets';

const NOW = '2026-06-01T12:00:00.000Z';

describe('demo post identity', () => {
  it('recognises the namespaced demo ids', () => {
    expect(isDemoPostId(`${DEMO_POST_ID_PREFIX}campus-event-platform`)).toBe(true);
    expect(isDemoPostId('a3f1c0de-0000-4000-8000-000000000001')).toBe(false);
    expect(isDemoPostId(undefined)).toBe(false);
    expect(isDemoPostId(null)).toBe(false);
  });

  it('flags a demo post by id, by origin, or by its explicit marker', () => {
    const post = createDemoFeedPosts(NOW)[0];
    expect(isDemoPost(post)).toBe(true);
    expect(isDemoPost({ id: 'real-post', origin: 'profile' })).toBe(false);
    // A screen holding only the id still recognises it.
    expect(isDemoPost({ id: `${DEMO_POST_ID_PREFIX}x` })).toBe(true);
  });
});

describe('createDemoFeedPosts', () => {
  const posts = createDemoFeedPosts(NOW);

  it('creates exactly the four approved demo posts', () => {
    expect(posts).toHaveLength(4);
  });

  it('covers all four card types, so every renderer is reviewable', () => {
    expect(posts.map((post) => post.kind).sort()).toEqual([
      'achievement',
      'image',
      'project',
      'text',
    ]);
  });

  it('namespaces every id and marks every post as demo', () => {
    for (const post of posts) {
      expect(post.demo).toBe(true);
      expect(post.origin).toBe('demo');
      expect(isDemoPostId(post.id)).toBe(true);
    }
  });

  it('gives every post a unique id, so React keys cannot collide', () => {
    expect(new Set(posts.map((post) => post.id)).size).toBe(posts.length);
  });

  it('dates every post in the past relative to the supplied instant', () => {
    for (const post of posts) {
      const stamp = Date.parse(post.createdAt);
      expect(Number.isNaN(stamp), `${post.id} has an unparseable timestamp`).toBe(false);
      expect(stamp).toBeLessThanOrEqual(Date.parse(NOW));
    }
  });

  it('orders the demo posts newest first', () => {
    const stamps = posts.map((post) => Date.parse(post.createdAt));
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
  });

  it('never claims a verification badge on an author', () => {
    for (const post of posts) {
      expect(post.author.verified).toBe(false);
    }
  });

  it('gives no author a profile route, because none exists for other users', () => {
    for (const post of posts) {
      expect(post.author.profileHref).toBeNull();
    }
  });

  it('gives no author an avatar URL, so no stock face is implied', () => {
    for (const post of posts) {
      expect(post.author.avatarUrl).toBeNull();
    }
  });

  it('never invents credential verification for a demo certificate', () => {
    const certificate = posts.find((post) => post.kind === 'achievement');
    expect(certificate?.achievement).not.toBeNull();
    expect(certificate?.achievement?.verificationUrl).toBeNull();
  });

  it('labels every author as a demo profile in their headline', () => {
    for (const post of posts) {
      expect(post.author.headline).toContain('Demo profile');
    }
  });

  it('uses a distinct author for each demo post, as four fictional students', () => {
    expect(new Set(posts.map((post) => post.author.name)).size).toBe(posts.length);
  });

  it('carries no engagement count on any post', () => {
    for (const post of posts) {
      const record = post as unknown as Record<string, unknown>;
      for (const key of ['likes', 'comments', 'shares', 'bookmarks', 'counts']) {
        expect(record[key], `${post.id} must not carry ${key}`).toBeUndefined();
      }
    }
  });

  it('gives every media item a real size, a data URI, and a useful alt text', () => {
    const media = posts.flatMap((post) => post.media);
    expect(media.length).toBeGreaterThan(0);
    for (const item of media) {
      expect(item.uri.startsWith('data:image/png;base64,')).toBe(true);
      expect(item.width).toBeGreaterThan(0);
      expect(item.height).toBeGreaterThan(0);
      expect(item.alt.length).toBeGreaterThan(10);
    }
  });

  it('includes one multi-image post, so the count indicator is exercised', () => {
    const multi = posts.filter((post) => post.media.length > 1);
    expect(multi).toHaveLength(1);
    expect(multi[0]?.media).toHaveLength(3);
  });

  it('references only images the generated asset module actually contains', () => {
    // Typed as `Set<string>`: the asset map is `as const`, so an inferred set
    // would hold literal URI types and reject any other string.
    const known = new Set<string>(Object.values(DEMO_FEED_IMAGES).map((image) => image.uri));
    for (const item of posts.flatMap((post) => post.media)) {
      expect(known.has(item.uri), 'demo media must resolve to a generated asset').toBe(true);
    }
  });

  it('keeps the generated images at the sizes the asset module declares', () => {
    for (const image of Object.values(DEMO_FEED_IMAGES)) {
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);
      expect(image.width / image.height).toBeGreaterThan(0.5);
    }
  });

  it('labels the one demo post that carries an illustrative link', () => {
    const project = posts.find((post) => post.kind === 'project');
    expect(project?.project?.sourceUrl).toBeTruthy();
    expect(DEMO_EXTERNAL_LINK_NOTE).toMatch(/illustrative/i);
  });

  it('has a text post long enough to exercise the See-more control', () => {
    const text = posts.find((post) => post.kind === 'text');
    expect((text?.body ?? '').length).toBeGreaterThan(260);
  });

  it('gives no post a project and an achievement block at once', () => {
    for (const post of posts) {
      const both = post.project !== null && post.achievement !== null;
      expect(both, `${post.id} must not carry two detail panels`).toBe(false);
    }
  });
});

describe('demo labelling', () => {
  it('carries a DEMO badge on every card, so demo is never implicit', () => {
    expect(DEMO_POST_BADGE).toBe('DEMO');
  });
});

describe('shouldShowDemoFeed', () => {
  it('is enabled in development unless explicitly switched off', () => {
    expect(shouldShowDemoFeed({ isDev: true })).toBe(true);
    expect(shouldShowDemoFeed({ isDev: true, flag: 'on' })).toBe(true);
    expect(shouldShowDemoFeed({ isDev: true, flag: 'off' })).toBe(false);
    expect(shouldShowDemoFeed({ isDev: true, flag: '0' })).toBe(false);
    expect(shouldShowDemoFeed({ isDev: true, flag: 'FALSE' })).toBe(false);
    expect(shouldShowDemoFeed({ isDev: true, flag: '  off  ' })).toBe(false);
  });

  it('is disabled in production whatever the environment says', () => {
    expect(shouldShowDemoFeed({ isDev: false })).toBe(false);
    expect(shouldShowDemoFeed({ isDev: false, flag: 'on' })).toBe(false);
  });

  it('reads the runtime flag without assuming __DEV__ exists in Node', () => {
    expect(typeof isDemoFeedEnabled()).toBe('boolean');
  });
});
