/**
 * The feed is published posts, and nothing else.
 *
 * **The rule under test.** Profile data belongs on Profile. Home is where
 * somebody deliberately publishes. Adding a project, a skill, a certification,
 * an achievement or an education entry to your profile must not put a card in
 * the feed, because the feed is a statement about what you chose to say, and
 * auto-generating one says it for you.
 *
 * **These are structural checks on the source rather than assertions about a
 * rendered screen**, for the same reason `demoIsolation.test.ts` is: the thing
 * being protected is a capability, and the hook cannot be rendered in Node
 * because it imports `react-native`. Reading the files means a future edit that
 * re-adds a profile source fails the suite instead of quietly shipping.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mergeFeed, type FeedPost } from '@/features/feed/feedModel';

const FEED_DIR = fileURLToPath(new URL('.', import.meta.url));
const read = (name: string) => readFileSync(`${FEED_DIR}${name}`, 'utf8');

describe('the feed composition has no profile source', () => {
  const hook = read('useFeedPosts.ts');

  it('does not import the profile-record mapper', () => {
    // The one change that removed the leak. Asserted on the import list and on
    // the call site, because either alone could be satisfied by accident: an
    // unused import is dead code, and a call with no import does not compile.
    expect(hook).not.toContain('fromProfileRecords');
  });

  it('does not turn a profile aggregate into feed posts', () => {
    expect(hook).not.toMatch(/fromProfileRecords\s*\(/);
    // The parameter that carried it is gone, so the hook cannot be handed one.
    expect(hook).not.toMatch(/profile:\s*ProfileAggregate/);
  });

  it('reads published posts and nothing else', () => {
    expect(hook).toContain("from '@/api/posts'");
    expect(hook).toContain('fetchPosts(');
    expect(hook).toContain('mergeFeed(');
  });

  it('does not read the profile aggregate at all', () => {
    // Not just "does not derive posts from it" -- it should not need it, so the
    // feed cannot be made to depend on the profile request succeeding.
    expect(hook).not.toContain('@/types/profile');
  });

  it('still gates demo content behind the development flag', () => {
    // Removing a source must not weaken the other isolation guarantee.
    expect(hook).toContain('isDemoFeedEnabled()');
  });
});

describe('the feed component does not take a profile', () => {
  const component = read('CommunityFeed.tsx');

  it('has no profile prop to feed it records from', () => {
    expect(component).not.toMatch(/profile\?:\s*ProfileAggregate/);
    expect(component).not.toContain('ProfileAggregate');
    expect(component).toContain('useFeedPosts(filter)');
  });

  it('no longer promises that profile records appear in the feed', () => {
    // The empty state used to say exactly that, which made the bug a documented
    // feature rather than a bug. The copy is part of the behaviour.
    expect(component).not.toMatch(/appear here as soon as you save them/);
    expect(component).toContain('only shows what you choose to post');
  });
});

describe('the profile mapper is kept, but is not a feed source', () => {
  it('is still exported so the mapping is not silently lost', () => {
    // It remains a real, tested mapping. Deleting it would have thrown away
    // fifteen passing tests to remove a call site that no longer exists.
    expect(read('feedModel.ts')).toContain('export function fromProfileRecords');
  });

  it('is referenced by no other feed module', () => {
    for (const name of ['useFeedPosts.ts', 'CommunityFeed.tsx', 'FeedPostCard.tsx']) {
      expect(read(name), `${name} must not use fromProfileRecords`).not.toContain(
        'fromProfileRecords',
      );
    }
  });
});

describe('merging published posts invents nothing', () => {
  const author = {
    name: 'Ada Lovelace',
    // Real identity fields, which the feed model now carries for every post.
    username: 'ada',
    publicId: 'pub_ada',
    headline: null,
    avatarUrl: null,
    profileHref: '/profile',
    verified: false,
  };
  const post = (id: string, overrides: Partial<FeedPost> = {}): FeedPost =>
    ({
      id,
      kind: 'text',
      category: 'community',
      origin: 'profile',
      title: null,
      body: null,
      media: [],
      project: null,
      achievement: null,
      tags: [],
      createdAt: '2026-03-01T00:00:00Z',
      // Zeros, because the server is the only source of a real count.
      engagement: { likeCount: 0, commentCount: 0, likedByMe: false },
      author,
      ...overrides,
    }) as FeedPost;

  it('passes every published post through untouched', () => {
    const real = [post('a'), post('b'), post('c')];
    const merged = mergeFeed(real, [], { demoEnabled: false });

    expect(merged.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('adds nothing when there is nothing to add', () => {
    expect(mergeFeed([], [], { demoEnabled: false })).toEqual([]);
  });

  it('appends demo posts only while the flag is on, never in front of real ones', () => {
    const real = [post('real-1')];
    const demo = [{ id: 'demo-1', origin: 'demo' } as never];

    const on = mergeFeed(real, demo, { demoEnabled: true });
    expect(on.map((entry) => entry.id)).toEqual(['real-1', 'demo-1']);

    const off = mergeFeed(real, demo, { demoEnabled: false });
    expect(off.map((entry) => entry.id)).toEqual(['real-1']);
  });
});
