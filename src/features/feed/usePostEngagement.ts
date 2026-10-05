/**
 * `usePostEngagement` â€” the one place a post's like state changes.
 *
 * **Optimistic, with a real rollback.** A like is the interaction where waiting for
 * a round trip is most visible: the heart either jumps instantly or appears broken.
 * So the cache is written immediately and reverted on failure â€” and the rollback is
 * the point, because a heart that fills and stays filled after a failed request is
 * a lie about data the server never accepted.
 *
 * **Only the affected post is touched.** The feed holds many posts, and a like on
 * one must not rewrite the other 49 â€” that would re-render the whole list, restart
 * any playing video, and lose the reader's scroll position. Every cache write here
 * is a `map` over the list that returns the *same object reference* for posts it
 * did not change, which is what lets React's identity check skip them.
 *
 * **The server's counts win, always.** The optimistic value is only ever a guess
 * shown for the few hundred milliseconds before the response. When it arrives, its
 * numbers replace ours even if they differ â€” for instance if somebody else liked
 * the same post in between. That is why `onSuccess` writes the response rather
 * than assuming the guess was right.
 *
 * **In-flight taps are dropped, not queued.** Two optimistic writes racing would
 * need a request queue to stay consistent; the server is idempotent, so the
 * simpler and more honest behaviour is to ignore a tap while one is already
 * running and let the user tap again after it settles.
 *
 * No request is made for a demo post. Demo content has no server behind it, so
 * attempting a like on it would 404 and the card would flash an error for a post
 * that never existed on the server.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/errors';
import { likePost, unlikePost } from '@/api/posts';
import { queryKeys } from '@/api/queryKeys';
import { isDemoPostId } from '@/features/feed/demoFeedPosts';
import {
  optimisticEngagement,
  patchPostEngagement,
} from '@/features/feed/engagementCache';
import { type FeedPost } from '@/features/feed/feedModel';

/** The cache value shape: `useFeedPosts` stores a bare array of posts. */
type FeedCache = readonly FeedPost[];

/** What a card needs to render its engagement row. */
export interface PostEngagementState {
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  /** True while a like request is on the wire. Disables the button. */
  isUpdating: boolean;
  /** The server's message when the last request failed, else null. */
  problem: string | null;
  /** Optimistic toggle. Ignored for a demo post and while a request is running. */
  toggleLike: () => void;
  dismissProblem: () => void;
}

export function usePostEngagement(post: FeedPost): PostEngagementState {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  // Drives the rendered disabled state, so it must be state: a ref read during
  // render would not re-render the button, and the rule against reading refs while
  // rendering exists for exactly that reason.
  const [isUpdating, setIsUpdating] = useState(false);

  // The tap guard is a ref, deliberately, and is never read during render. A double
  // tap arrives before React re-renders, so `isUpdating` would still be false and
  // both taps would be treated as the first.
  const inFlight = useRef(false);

  const isDemo = isDemoPostId(post.id);

  const mutation = useMutation({
    mutationFn: (nextLiked: boolean) =>
      nextLiked ? likePost(post.id) : unlikePost(post.id),

    onMutate: async (nextLiked: boolean) => {
      // Snapshot *before* the write so the rollback restores exactly what was
      // there, including a count another like had already moved.
      const previous = queryClient.getQueryData<FeedCache>(queryKeys.posts);

      queryClient.setQueryData<FeedCache>(queryKeys.posts, (current) =>
        patchPostEngagement(current, post.id, (engagement) =>
          optimisticEngagement(engagement, nextLiked),
        ),
      );

      return { previous };
    },

    onError: (error: unknown, _nextLiked, context) => {
      // The rollback. Restoring the snapshot - rather than recomputing an inverse -
      // is what makes this correct when several likes are in flight at once.
      if (context?.previous) {
        queryClient.setQueryData<FeedCache>(queryKeys.posts, context.previous);
      }
      setProblem(
        error instanceof ApiError
          ? error.message
          : "Couldn't update like. Check your connection and try again.",
      );
    },

    onSuccess: (server) => {
      // Adopt the server's numbers even though they may differ from the guess.
      queryClient.setQueryData<FeedCache>(queryKeys.posts, (current) =>
        patchPostEngagement(current, post.id, () => ({
          likedByMe: server.liked_by_me,
          likeCount: server.like_count,
          commentCount: server.comment_count,
        })),
      );
      setProblem(null);
    },

    onSettled: () => {
      inFlight.current = false;
      // Also cleared through state so the button re-enables. A stuck disabled
      // button is worse than a duplicate request, which the server absorbs anyway.
      setIsUpdating(false);
    },
  });

  const toggleLike = useCallback(() => {
    // Demo content is not on the server; a request would only fail.
    if (isDemo) return;
    // The ref guard runs before the state one, because it is the only check that is
    // true for a tap arriving in the same tick as the previous one.
    if (inFlight.current) return;
    inFlight.current = true;
    setIsUpdating(true);
    setProblem(null);
    mutation.mutate(!post.engagement.likedByMe);
  }, [isDemo, mutation, post.engagement.likedByMe]);

  const dismissProblem = useCallback(() => setProblem(null), []);

  return useMemo(
    () => ({
      likeCount: post.engagement.likeCount,
      commentCount: post.engagement.commentCount,
      likedByMe: post.engagement.likedByMe,
      isUpdating,
      problem,
      toggleLike,
      dismissProblem,
    }),
    [post.engagement, isUpdating, problem, toggleLike, dismissProblem],
  );
}

