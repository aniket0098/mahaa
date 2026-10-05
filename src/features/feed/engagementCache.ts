/**
 * `engagementCache` — pure helpers for writing a like into the cached feed.
 *
 * Split out of `usePostEngagement` so the arithmetic can be tested without
 * mounting a hook or importing React Query. Like `feedModel`, this module has no
 * React Native dependencies, which is what keeps it importable from a plain
 * vitest file.
 *
 * **Identity preservation is the whole optimisation.** Returning a fresh object
 * for a post that did not change would make React re-render that card, and the
 * card owns a video player — so a like on post 3 would restart the video playing
 * on post 1. Same reference, no re-render.
 */

import type { FeedEngagement, FeedPost } from '@/features/feed/feedModel';

/** The cache value shape: `useFeedPosts` stores a bare array of posts. */
export type FeedCache = readonly FeedPost[];

/**
 * What a post should show immediately after a like tap, before the server answers.
 *
 * **Never below zero, and never double-counted from an already-liked state:**
 * a like on a liked post must not add a second unit. The optimistic value is only
 * a guess for the few hundred milliseconds until the response replaces it.
 */
export function optimisticEngagement(
  current: FeedEngagement,
  nextLiked: boolean,
): FeedEngagement {
  return {
    ...current,
    likedByMe: nextLiked,
    likeCount: nextLiked
      ? current.likeCount + (current.likedByMe ? 0 : 1)
      : Math.max(0, current.likeCount - (current.likedByMe ? 1 : 0)),
  };
}

/**
 * Rewrites one post's engagement inside the cached feed, sharing every other
 * post's object identity.
 *
 * Returns the identical array (not a copy) when the post is not in this page, so
 * React Query sees the value as unchanged and skips the re-render.
 */
export function patchPostEngagement(
  cache: FeedCache | undefined,
  postId: string,
  patch: (current: FeedEngagement) => FeedEngagement,
): FeedCache | undefined {
  if (!cache) return cache;
  if (!cache.some((post) => post.id === postId)) return cache;

  return cache.map((post) =>
    post.id === postId ? { ...post, engagement: patch(post.engagement) } : post,
  );
}
