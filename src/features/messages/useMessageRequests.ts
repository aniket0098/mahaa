/**
 * useMessageRequests — the Requests tab's data and its Accept/Reject actions.
 *
 * The list is read from the **message service** (`listMessageRequests`). The
 * pending count is the server's own `pending_count` from that same page — never
 * a sum of the loaded rows, because the list may be a subset. It moves only when
 * a refetch returns a new number, so the tab label can never claim a count the
 * server has not confirmed.
 *
 * **Accept and Reject update the list only after the server confirms.** No card
 * is removed optimistically: React Query locks a mutation, so a second tap on the
 * same card is a no-op, and the row leaves the list through the post-success
 * invalidation refetch. If the call fails the row stays and the server's message
 * is surfaced for a retry. There is no toast: success is the row leaving, failure
 * is a persistent banner.
 *
 * A 409 (already resolved elsewhere) is not retried as an error the user can fix
 * — the invalidation is triggered so the refetch replaces the settled card with
 * the server's truth.
 */

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  acceptMessageRequest,
  listMessageRequests,
  rejectMessageRequest,
  type MessageRequest,
  type MessageRequestStatus,
} from '@/api/messageRequests';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';

export interface MessageRequestsView {
  /** Rows to render. Search filtering is applied by the caller. */
  requests: MessageRequest[];
  /** Server-derived pending total; drives the Requests tab label. */
  pendingCount: number;
  isLoading: boolean;
  /** A persistent load error message, or null. */
  loadError: string | null;
  /** The id of the request whose action is currently on the wire. */
  busyId: string | null;
  /** The last accept/reject failure, cleared by dismissActionError. */
  actionError: string | null;
  /** The id of the request whose action failed, for a per-card banner. */
  actionErrorId: string | null;
  accept: (id: string) => void;
  reject: (id: string) => void;
  dismissActionError: () => void;
  retryLoad: () => void;
}

export function useMessageRequests(
  status: MessageRequestStatus = 'pending',
): MessageRequestsView {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionErrorId, setActionErrorId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.messageRequests(status),
    queryFn: () => listMessageRequests(status, 50),
  });

  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) =>
      action === 'accept' ? acceptMessageRequest(id) : rejectMessageRequest(id),
    onSuccess: () => {
      setActionError(null);
      setActionErrorId(null);
      // The server confirmed. Refetch list + count together so the tab label and
      // the remaining rows reflect the new state authoritatively.
      void queryClient.invalidateQueries({ queryKey: queryKeys.messageRequestsRoot });
    },
    onError: (error, { id }) => {
      setActionErrorId(id);
      if (error instanceof ApiError && error.isConflict) {
        // Already settled elsewhere: onSuccess did not run, so trigger the refetch
        // here and let the server's state win.
        void queryClient.invalidateQueries({ queryKey: queryKeys.messageRequestsRoot });
        setActionError('That request was already handled. Refreshing…');
      } else {
        setActionError(
          error instanceof ApiError
            ? error.message
            : 'That request could not be updated. Please try again.',
        );
      }
    },
  });

  const requests = useMemo(() => query.data?.items ?? [], [query.data]);

  const accept = useCallback(
    (id: string) => {
      if (!resolve.isPending) resolve.mutate({ id, action: 'accept' });
    },
    [resolve],
  );
  const reject = useCallback(
    (id: string) => {
      if (!resolve.isPending) resolve.mutate({ id, action: 'reject' });
    },
    [resolve],
  );
  const dismissActionError = useCallback(() => {
    setActionError(null);
    setActionErrorId(null);
  }, []);
  const retryLoad = useCallback(() => {
    void query.refetch();
  }, [query]);

  const loadError = query.isError && query.error instanceof Error ? query.error.message : null;

  return {
    requests,
    pendingCount: query.data?.pending_count ?? 0,
    isLoading: query.isPending,
    loadError,
    busyId: resolve.isPending ? (resolve.variables?.id ?? null) : null,
    actionError,
    actionErrorId,
    accept,
    reject,
    dismissActionError,
    retryLoad,
  };
}
