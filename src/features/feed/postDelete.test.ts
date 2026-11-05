/**
 * Post delete, feed spacing, and scroll perf: the wiring items 1, 6, 7 depend on.
 *
 * Source-level (the `feedAutoplayWiring.test.ts` approach), because the
 * components import react-native, which this runner is not.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('Delete offered only for own post', () => {
  const menu = read('PostOverflowMenu.tsx');
  const card = read('FeedPostCard.tsx');

  it('owner-gated rows hide behind isOwnPost', () => {
    expect(menu.split('{isOwnPost ? (').length - 1).toBe(2);
    expect(menu).toContain('{isOwnPost ? (');
    expect(menu).toMatch(/\{isOwnPost \? \(\s+<MenuRow\s+label="Delete"/);
  });

  it('the card gates on the server answer, not on the post origin', () => {
    expect(card).toContain('isOwnPost={post.author.isSelf}');
    expect(card).not.toContain('isOwnPost={post.origin');
  });

  it('the confirmation repeats the spec copy with Cancel and Delete', () => {
    expect(menu).toContain('Delete this post permanently?');
    expect(menu).toContain('This action cannot be undone.');
    expect(menu).toContain('label="Cancel"');
    expect(menu).toContain('label="Delete"');
    expect(menu).toContain('testID="feed-post-delete-confirm"');
  });

  it('deleting spins the confirm button and surfaces the message inline', () => {
    expect(menu).toContain('loading={deleting}');
    expect(menu).toContain('testID="feed-post-delete-error"');
    expect(menu).toContain('{deleteError}');
  });
});

describe('Deleting removes the post from every cached face of the feed', () => {
  const card = read('FeedPostCard.tsx');
  const api = read('../../api/posts.ts');

  it('the client goes through the real DELETE endpoint', () => {
    expect(api).toContain('apiClient.delete');
    expect(api).toContain('/posts/${postId}');
    expect(card).toContain('await deletePost(post.id)');
  });

  it('success filters the feed and the own-posts caches, then re-reads the server', () => {
    expect(card).toContain('setQueryData<FeedPost[]>(queryKeys.posts,');
    expect(card).toContain('queryKeys.myPosts');
    expect(card).toContain('invalidateQueries({ queryKey: queryKeys.postsRoot })');
  });
});

describe('Ownership comes from the server is_self', () => {
  it('the wire maps is_self into the single gating field', () => {
    const model = read('feedModel.ts');
    const api = read('../../api/posts.ts');
    expect(model).toContain('isSelf: boolean;');
    expect(api).toContain('isSelf: wire.is_self');
  });
});

describe('Feed spacing stays one small shared gap', () => {
  it('every card variant lives inside the one list gap', () => {
    expect(read('feedStyles.ts')).toContain('list: { gap: spacing.sm }');
  });
});

describe('The list keeps its identities across renders', () => {
  const feed = read('CommunityFeed.tsx');

  it('the posts container clips off-screen native views once the list is long', () => {
    expect(feed).toContain('removeClippedSubviews={view.posts.length > 8}');
  });

  it('cards are memoised and keyed by post id, and the merged list is memoised', () => {
    const card = read('FeedPostCard.tsx');
    const hook = read('useFeedPosts.ts');
    expect(card).toContain('export const FeedPostCard = memo(FeedPostCardInner);');
    expect(feed).toContain('key={post.id}');
    expect(hook).toContain('const merged = useMemo(');
  });
});

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

