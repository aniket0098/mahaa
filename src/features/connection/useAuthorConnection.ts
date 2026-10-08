/**
 * `useAuthorConnection` — the feed card's Connect pill.
 *
 * **One shared list, many cards.** Every connectable video card calls this hook
 * with the same `queryKeys.connections()` key, so React Query turns N mounted
 * cards into exactly one `GET /connections` request. Cards that cannot connect
 * (own posts, demo authors, non-video cards) pass `null` and the query stays
 * `enabled: false` — no request, no state, no pill.
 *
 * **The send is two real calls, not one.** `POST /connections` takes the
 * *internal* user id, and the feed only carries the author's public id — so the
 * mutation first resolves `GET /users/{public_id}` and then sends the request
 * with `user_id`. Nothing is invented between the two steps.
 *
 * **The server's rows win, with one narrow exception.** After a 201 the rows
 * are stale until the invalidation refetch lands; during that window the pill
 * would flicker back to "Connect" and invite a duplicate tap, so a just-sent
 * success holds the pill at `pending` until fresh data arrives *or* is proven
 * newer than the send (`dataUpdatedAt`). A later server answer — a decline, a
 * removal — therefore still overrides the local success.
 *
 * Errors are surfaced as the server's own message (`ApiError.message`) for the
 * card's persistent banner, and dismissed by `mutation.reset()` — which is what
 * "Retry" on that banner does: clear the failure, leaving the pill ready to try
 * again. There is no toast anywhere in this flow.
 */

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { listConnections, sendConnectionRequest } from '@/api/connections';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { fetchPublicProfile } from '@/api/users';
import {
  deriveConnectionState,
  type AuthorConnectionState,
} from '@/features/connection/connectionState';

export interface AuthorConnection {
  /** What the pill renders: `none` → Connect, `pending` → Pending, `connected` → Connected. */
  state: AuthorConnectionState;
  /** True while the send (lookup + request) is on the wire. */
  isSending: boolean;
  /** The server's message when the last attempt failed, else null. */
  error: string | null;
  /** Sends a request for this author. No-op without a public id or while one is running. */
  send: () => void;
  /** Clears a failed attempt — the banner's "Retry" affordance. */
  dismissError: () => void;
}

/**
 * @param publicId The *author's* public id, or null when this card must not
 * connect at all (own post, demo author, non-video card). Null disables the
 * query entirely rather than fetching a list nobody will read.
 */
export function useAuthorConnection(publicId: string | null): AuthorConnection {
  const queryClient = useQueryClient();

  const rows = useQuery({
    // Function key, same family every connections screen invalidates under.
    queryKey: queryKeys.connections(),
    queryFn: () => listConnections(),
    enabled: publicId !== null,
  });

  // Wall-clock of the last successful send, kept as state rather than a ref
  // because the render below reads it: state reads are allowed during render,
  // and a ref read here would be invisible to the re-render that must follow.
  // It distinguishes "the server has not answered yet" from "the server has
  // answered and it is not pending".
  const [sentAt, setSentAt] = useState(0);

  const mutation = useMutation({
    mutationFn: async (targetPublicId: string) => {
      // The request takes the internal id; the feed only carries the public one.
      const profile = await fetchPublicProfile(targetPublicId);
      return sendConnectionRequest(profile.user_id);
    },
    onSuccess: () => {
      setSentAt(Date.now());
      // Every connections query refetches, so this card and the Connections
      // screen agree on the new row without a second source of truth.
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectionsRoot });
    },
  });

  const derived = deriveConnectionState(rows.data, publicId);
  const state: AuthorConnectionState =
    mutation.isSuccess && derived === 'none' && rows.dataUpdatedAt < sentAt
      ? 'pending'
      : derived;

  const send = useCallback(() => {
    if (!publicId) return;
    mutation.mutate(publicId);
  }, [mutation, publicId]);

  const dismissError = useCallback(() => mutation.reset(), [mutation]);

  let error: string | null = null;
  if (mutation.error) {
    error =
      mutation.error instanceof ApiError
        ? mutation.error.message
        : "Couldn't send the connection request. Check your connection and try again.";
  }

  return {
    state,
    isSending: mutation.isPending,
    error,
    send,
    dismissError,
  };
}
