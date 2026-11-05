/**
 * `usePersonConnection` — the connection relationship to **one other person**,
 * shared by a Home search suggestion and that person's public profile
 * (`/user/[id]`).
 *
 * Built on the same foundations as `useAuthorConnection` (one shared
 * `GET /connections` list, the send resolving a public id to the internal id
 * first), but it keeps the **direction** of a pending request, because a profile
 * must be able to offer Cancel (I asked them) or Respond (they asked me) — the
 * feed's pill deliberately collapses both to "Pending".
 *
 * The four mutations map to the real `/connections` routes, and each is only
 * offered when the derived state allows it (`personAction`):
 *
 *   - send     -> `POST /connections` with the internal user id
 *   - cancel   -> `POST /connections/{id}/cancel`   (only `is_outgoing`)
 *   - accept   -> `POST /connections/{id}/accept`   (only the addressee)
 *   - decline  -> `POST /connections/{id}/decline`  (only the addressee)
 *
 * Authorization is the server's: `is_outgoing` decides which action a row may
 * offer, and a request that is not the caller's answers 404. This hook never
 * invents a state — it only reflects rows the server returned.
 *
 * After any successful mutation every connections query is invalidated, so this
 * person, the Home list, and the Connections screen all reconcile to the same
 * server truth without a second source of state.
 *
 * A just-sent success holds the pill at `outgoing_pending` for the brief window
 * before the invalidation refetch lands (the same `sentAt` rule as the feed card)
 * so it cannot flicker back to "Connect" and invite a duplicate tap. Any later
 * server answer — a decline, a removal — still overrides it.
 */

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  acceptConnection,
  cancelConnection,
  declineConnection,
  listConnections,
  sendConnectionRequest,
} from '@/api/connections';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { fetchPublicProfile } from '@/api/users';
import {
  derivePersonConnectionState,
  isSelf,
  personAction,
  type PersonAction,
  type PersonConnectionState,
} from '@/features/people/peopleSearch';

export interface PersonConnection extends PersonAction {
  /** True while any request for this person is on the wire. */
  isBusy: boolean;
  /** The connection row id backing the current state, when one exists. */
  connectionId: string | null;
  /** The server's message when the last action failed, else null. */
  error: string | null;
  send: () => void;
  cancel: () => void;
  accept: () => void;
  decline: () => void;
  /** Clears a failed attempt — the banner's "Retry" affordance. */
  dismissError: () => void;
}

/**
 * @param publicId The other person's immutable public id, or null when this
 * surface must not connect at all. Null disables the query entirely.
 * @param selfPublicId The signed-in caller's public id, so the caller's own
 * profile can be identified and never offered a Connect action.
 */
export function usePersonConnection(
  publicId: string | null,
  selfPublicId: string | null,
): PersonConnection {
  const queryClient = useQueryClient();
  const self = isSelf(publicId, selfPublicId);

  const rows = useQuery({
    queryKey: queryKeys.connections(),
    queryFn: () => listConnections(),
    // The caller's own profile never needs the list to decide its label.
    enabled: publicId !== null && !self,
  });

  const state: PersonConnectionState = derivePersonConnectionState(rows.data, publicId);

  // The row that backs the current state, for the id-scoped mutations.
  const connectionId =
    (rows.data ?? []).find((row) => row.user?.public_id === publicId && row.status === 'pending')
      ?.id ?? null;

  // Wall-clock of the last successful send; see the module comment for why.
  const [sentAt, setSentAt] = useState(0);

  const invalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.connectionsRoot }),
    [queryClient],
  );

  const sendMutation = useMutation({
    mutationFn: async (targetPublicId: string) => {
      // The request takes the internal id; the surface only carries the public one.
      const profile = await fetchPublicProfile(targetPublicId);
      return sendConnectionRequest(profile.user_id);
    },
    onSuccess: () => {
      setSentAt(Date.now());
      invalidate();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelConnection(id),
    onSuccess: invalidate,
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => acceptConnection(id),
    onSuccess: invalidate,
  });

  const declineMutation = useMutation({
    mutationFn: (id: string) => declineConnection(id),
    onSuccess: invalidate,
  });

  // Hold "Requested" through the pre-refetch window so the button cannot flicker.
  const heldPending = sendMutation.isSuccess && state === 'none' && rows.dataUpdatedAt < sentAt;
  const effectiveState: PersonConnectionState = heldPending ? 'outgoing_pending' : state;
  const effectiveAction = personAction(effectiveState, self);

  const send = useCallback(() => {
    if (!publicId || self || sendMutation.isPending) return;
    sendMutation.mutate(publicId);
  }, [publicId, self, sendMutation]);

  const cancel = useCallback(() => {
    if (!connectionId || cancelMutation.isPending) return;
    cancelMutation.mutate(connectionId);
  }, [connectionId, cancelMutation]);

  const accept = useCallback(() => {
    if (!connectionId || acceptMutation.isPending) return;
    acceptMutation.mutate(connectionId);
  }, [connectionId, acceptMutation]);

  const decline = useCallback(() => {
    if (!connectionId || declineMutation.isPending) return;
    declineMutation.mutate(connectionId);
  }, [connectionId, declineMutation]);

  const dismissError = useCallback(() => {
    sendMutation.reset();
    cancelMutation.reset();
    acceptMutation.reset();
    declineMutation.reset();
  }, [sendMutation, cancelMutation, acceptMutation, declineMutation]);

  const failed =
    sendMutation.error ?? cancelMutation.error ?? acceptMutation.error ?? declineMutation.error;

  let error: string | null = null;
  if (failed) {
    error =
      failed instanceof ApiError
        ? failed.message
        : "Couldn't update the connection. Check your connection and try again.";
  }

  const isBusy =
    sendMutation.isPending ||
    cancelMutation.isPending ||
    acceptMutation.isPending ||
    declineMutation.isPending;

  return {
    ...effectiveAction,
    isBusy,
    connectionId,
    error,
    send,
    cancel,
    accept,
    decline,
    dismissError,
  };
}