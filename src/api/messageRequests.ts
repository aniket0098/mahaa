/**
 * Message-requests API — the Requests tab of the Message section.
 *
 * Binds to the `/message-requests` router served by the **independent message
 * service** (`message-docker-service`), not the main API: that service owns
 * the `message_requests` table, its migration and its five routes. Nothing
 * here is invented — every function maps to a route that exists in
 * `message-service/app/api/v1/endpoints/message_requests.py`.
 *
 * Three rules the server owns and this module must not re-implement:
 *
 * - **The sender is the authenticated caller.** There is no sender field in
 *   any payload; `POST /message-requests` takes `recipient_id` (the internal
 *   id from `lookupUsers`) and an optional `note`.
 * - **Only the recipient can accept or reject**, and a request that is not
 *   yours answers 404 rather than 403 — so a stale list item is shown as
 *   gone, never as "forbidden".
 * - **A settled request answers 409.** `ApiError.isConflict` is how a screen
 *   knows to refresh instead of retrying.
 *
 * When the message-service URL is not configured for this build
 * (`env.messageServiceBaseUrl === null`), every call throws a clear
 * configuration `ApiError` instead of a request that cannot succeed — the
 * screen then renders a notice rather than a spinner that never resolves.
 */

import { createApiClient, type ApiClient } from '@/api/client';
import { API_ERROR_CODES, ApiError } from '@/api/errors';
import { env } from '@/lib/env';

export type MessageRequestStatus = 'pending' | 'accepted' | 'rejected';

/** What a request card renders — the server's sender summary, field for field. */
export interface MessageRequestSender {
  user_id: string;
  public_id: string;
  username: string;
  name: string;
  role: string;
  /** `users.designation`; null when the account never set one. */
  designation: string | null;
  /** Relative media path; `Avatar` resolves it against the main API base. */
  avatar_url: string | null;
}

export interface MessageRequest {
  id: string;
  status: MessageRequestStatus;
  note: string | null;
  created_at: string;
  responded_at: string | null;
  sender: MessageRequestSender;
}

export interface MessageRequestPage {
  items: MessageRequest[];
  /** Server-derived pending total — the tab badge never adds up pages. */
  pending_count: number;
}

export interface PendingCount {
  pending: number;
}

const client: ApiClient | null = env.messageServiceBaseUrl
  ? createApiClient(env.messageServiceBaseUrl)
  : null;

/** The unconfigured-build error, thrown instead of a doomed request. */
function unconfigured(): ApiError {
  return new ApiError({
    message:
      'The message service is not configured for this build. Set ' +
      'EXPO_PUBLIC_MESSAGE_API_BASE_URL and restart the dev server.',
    code: API_ERROR_CODES.network,
  });
}

function requireClient(): ApiClient {
  if (!client) throw unconfigured();
  return client;
}

export function listMessageRequests(
  status: MessageRequestStatus = 'pending',
  limit = 50,
): Promise<MessageRequestPage> {
  return requireClient().get<MessageRequestPage>(
    `/message-requests?status=${encodeURIComponent(status)}&limit=${limit}`,
  );
}

export function fetchPendingRequestCount(): Promise<PendingCount> {
  return requireClient().get<PendingCount>('/message-requests/count');
}

/** Send a request. `recipientId` is the internal id from `lookupUsers`. */
export function sendMessageRequest(
  recipientId: string,
  note?: string | null,
): Promise<MessageRequest> {
  return requireClient().post<MessageRequest>('/message-requests', {
    body: note ? { recipient_id: recipientId, note } : { recipient_id: recipientId },
  });
}

export function acceptMessageRequest(requestId: string): Promise<MessageRequest> {
  return requireClient().post<MessageRequest>(`/message-requests/${requestId}/accept`);
}

export function rejectMessageRequest(requestId: string): Promise<MessageRequest> {
  return requireClient().post<MessageRequest>(`/message-requests/${requestId}/reject`);
}
