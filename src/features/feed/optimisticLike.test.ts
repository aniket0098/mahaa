/**
 * The optimistic like's cache patch — the part that decides whether a rolled-back
 * like actually restores what was on screen.
 *
 * **Identity preservation is tested, not just correctness of the numbers.** A
 * naive `map` that rebuilt every post would still produce correct counts while
 * re-rendering the entire feed, restarting any video that was playing and losing
 * the reader's scroll position. So the untouched posts must come back as the *same
 * object reference*; only the liked one may differ.
 *
 * **The rollback is `onMutate`'s snapshot, not an inverse calculation**, so what
 * these tests pin is the patch both directions depend on: given a current state,
 * produce the next one, without ever reaching below zero or double-counting.
 */

import { describe, expect, it } from 'vitest';

import { optimisticEngagement, patchPostEngagement } from '@/features/feed/engagementCache';
import type { FeedEngagement, FeedPost } from '@/features/feed/feedModel';

const engagement = (over: Partial<FeedEngagement> = {}): FeedEngagement => ({
  likeCount: 0,
  commentCount: 0,
  likedByMe: false,
  ...over,
});

const post = (id: string, over: Partial<FeedEngagement> = {}): FeedPost =>
  ({ id, engagement: engagement(over) }) as unknown as FeedPost;

/** Shorthand: what `onMutate` writes for a given tap. */
const optimistic = optimisticEngagement;

describe('patchPostEngagement', () => {
  const feed = [post('a', { likeCount: 2 }), post('b', { likeCount: 5, likedByMe: true })];

  it('changes only the named post', () => {
    const next = patchPostEngagement(feed, 'a', (current) => optimistic(current, true));

    expect(next?.[0].engagement.likeCount).toBe(3);
    expect(next?.[1].engagement.likeCount).toBe(5);
  });

  it('preserves the object identity of every untouched post', () => {
    const next = patchPostEngagement(feed, 'a', (current) => optimistic(current, true));

    // The optimisation, asserted directly: `b` is the *same object*, so React's
    // identity check skips that card entirely and its video is never restarted.
    expect(next?.[1]).toBe(feed[1]);
    // The patched one must genuinely be a new object, or the change would not
    // render at all.
    expect(next?.[0]).not.toBe(feed[0]);
  });

  it('returns the identical array for a post that is not in the page', () => {
    const next = patchPostEngagement(feed, 'missing', (current) => optimistic(current, true));

    // Nothing to do means nothing changed: React Query skips the re-render.
    expect(next).toBe(feed);
  });

  it('tolerates an absent cache', () => {
    expect(patchPostEngagement(undefined, 'a', (c) => c)).toBeUndefined();
  });

  it('leaves an empty page alone', () => {
    const empty: readonly FeedPost[] = [];
    expect(patchPostEngagement(empty, 'a', (c) => c)).toBe(empty);
  });
});

describe('the optimistic write itself', () => {
  it('adds one when liking an unliked post', () => {
    expect(optimistic(engagement({ likeCount: 4 }), true)).toMatchObject({
      likedByMe: true,
      likeCount: 5,
    });
  });

  it('never decrements below zero when un-liking an unliked post', () => {
    // Reachable if the reader taps quickly or a rollback raced. A negative count
    // would render as "-1 likes".
    expect(optimistic(engagement({ likeCount: 0, likedByMe: false }), false)).toMatchObject({
      likeCount: 0,
    });
  });

  it('does not double-count when the state says it is already liked', () => {
    // The optimistic value is a guess; the server's number overwrites it moments
    // later. It must not briefly show 6 when the truth is 5.
    expect(optimistic(engagement({ likeCount: 5, likedByMe: true }), true)).toMatchObject({
      likeCount: 5,
    });
  });

  it('leaves the comment count untouched', () => {
    // A like must not disturb comments: the sheet reads that number and a wrong
    // value would make the card disagree with the sheet it opens.
    expect(optimistic(engagement({ commentCount: 7 }), true).commentCount).toBe(7);
  });

  it('round-trips back to the original state', () => {
    // This is what the rollback does in effect, and what makes an optimistic like
    // reversible without the client knowing the original count.
    const start = engagement({ likeCount: 3 });
    const liked = optimistic(start, true);
    const reverted = optimistic(liked, false);

    expect(reverted).toEqual(start);
  });
});
