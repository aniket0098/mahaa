/**
 * `usePostComments` — the one place a post's comments are read or written.
 *
 * **Optimistic insertion, with a rollback that removes the temporary row.** A
 * comment that appears a round trip later feels broken; one that appears instantly
 * and then vanishes feels worse. So the row is inserted with a client-side
 * placeholder id, marked as pending, and removed again if the request fails — with
 * the server's own error left on screen rather than the text silently vanishing.
 *
 * **A pending row is visibly marked and cannot be deleted.** It does not exist on
 * the server yet, so offering a delete would 404, and rendering it identically to a
 * saved comment would claim something untrue for the moment the request is open.
 *
 * **No author field is sent.** The server attributes a comment to the bearer token
 * (`CommentCreate` has no `author_id` and `extra="forbid"`), so the client has no
 * way to post as somebody else — there is nothing to omit.
 *
 * **A demo post loads nothing.** Demo content has no server behind it, so a request
 * would only fail; the sheet says so instead of showing a spinner that never ends.
 */

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/errors';
import { createComment, fetchComments } from '@/api/posts';
import { queryKeys } from '@/api/queryKeys';
import { isDemoPostId } from '@/features/feed/demoFeedPosts';
import {
  type FeedAuthor,
  type FeedComment,
} from '@/features/feed/feedModel';

/** Marks a row that is in the optimistic window and not yet on the server. */
export interface PendingComment extends FeedComment {
  /** True while the create request is in flight. */
  readonly pending: true;
}

export interface PostCommentsState {
  comments: readonly FeedComment[];
  status: 'loading' | 'error' | 'ready';
  errorMessage: string | null;
  /** The server's message when a create failed, else null. */
  problem: string | null;
  isSending: boolean;
  canSend: boolean;
  send: (body: string) => void;
  dismissProblem: () => void;
  /** True when this post is development demo content with no server behind it. */
  isDemo: boolean;
}

/** Longest comment the API will accept; mirrors `MAX_COMMENT_CHARS` server-side. */
export const MAX_COMMENT_CHARS = 2000;

/**
 * The author shown on an optimistic row.
 *
 * **The viewer's own name is not available to this hook**, and inventing one
 * would be worse than admitting it: the real identity arrives with the server's
 * response a moment later and replaces this row wholesale. Every field is
 * therefore empty, so the row renders initials from "You" rather than borrowing
 * somebody's real avatar or handle.
 */
const SELF_AUTHOR: FeedAuthor = {
  name: 'You',
  username: null,
  publicId: null,
  headline: null,
  avatarUrl: null,
  profileHref: null,
  verified: false,
};

export function usePostComments(postId: string): PostCommentsState {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const isDemo = isDemoPostId(postId);

  const key = queryKeys.postComments(postId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchComments(postId),
    // Demo content is never fetched, so the query is disabled rather than left to
    // fail: a permanently red error would misrepresent a deliberate decision.
    enabled: !isDemo,
  });

  const create = useMutation({
    mutationFn: (body: string) => createComment(postId, body),

    onMutate: async (body: string) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<FeedComment[]>(key);

      // A placeholder id that cannot collide with a server uuid, so the optimistic
      // row is removable by id without risking removing a real comment.
      const optimistic: PendingComment = {
        id: `pending-${Date.now()}`,
        postId,
        body,
        createdAt: new Date().toISOString(),
        author: SELF_AUTHOR,
        pending: true,
      };

      queryClient.setQueryData<FeedComment[]>(key, (current) => [
        optimistic,
        ...(current ?? []),
      ]);

      return { previous };
    },

    onError: (error: unknown, _body, context) => {
      // Drop the temporary row. `previous` is the exact list from before the
      // insert, so restoring it removes the placeholder without disturbing anything
      // the server has since confirmed.
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      setProblem(
        error instanceof ApiError
          ? error.message
          : 'Your comment could not be sent. Check your connection and try again.',
      );
    },

    onSuccess: (saved) => {
      // Replace the placeholder rather than prepending: the server's row carries
      // the real id, the real timestamp and the real author projection.
      queryClient.setQueryData<FeedComment[]>(key, (current) => [
        saved,
        ...(current ?? []).filter((row) => !row.id.startsWith('pending-')),
      ]);
      setProblem(null);
    },
  });

  const send = useCallback(
    (body: string) => {
      const trimmed = body.trim();
      // Disabled in the UI as well; this is the second gate, for a keyboard that
      // submits faster than React re-renders the button.
      if (!trimmed || trimmed.length > MAX_COMMENT_CHARS || create.isPending) return;
      setProblem(null);
      create.mutate(trimmed);
    },
    [create],
  );

  const dismissProblem = useCallback(() => setProblem(null), []);

  return useMemo(
    () => ({
      comments: query.data ?? [],
      status: query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
      errorMessage: query.error instanceof Error ? query.error.message : null,
      problem,
      isSending: create.isPending,
      canSend: !create.isPending,
      send,
      dismissProblem,
      isDemo,
    }),
    [query.data, query.isPending, query.isError, query.error, problem, create.isPending, send, dismissProblem, isDemo],
  );
}
