/**
 * Connections API — sending, answering, and removing relationship requests.
 *
 * Binds to the `/connections` router in
 * `apps/api/app/api/v1/endpoints/connections.py`.
 *
 * Two rules the app must respect rather than re-implement:
 *
 * - A request is sent by **internal user id**, which the lookup in `api/users.ts`
 *   returns. The public id and handle are only ever inputs that find a person.
 * - `is_outgoing` decides which action buttons belong on a row. The server sends
 *   it so the app never has to guess whether it may offer Accept or Cancel.
 *
 * Every action is participant-scoped server-side: a request that is not the
 * caller's answers 404, so a stale row in a list can be shown as removed rather
 * than retried.
 */

import { apiClient } from '@/api/client';
import type { Connection } from '@/types/onboarding';

export type ConnectionStatus = Connection['status'];

export function listConnections(status?: ConnectionStatus): Promise<Connection[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiClient.get<Connection[]>(`/connections${query}`);
}

/** Send a request. `userId` is the internal id from a lookup result. */
export function sendConnectionRequest(userId: string): Promise<Connection> {
  return apiClient.post<Connection>('/connections', { body: { user_id: userId } });
}

export function acceptConnection(connectionId: string): Promise<Connection> {
  return apiClient.post<Connection>(`/connections/${connectionId}/accept`);
}

export function declineConnection(connectionId: string): Promise<Connection> {
  return apiClient.post<Connection>(`/connections/${connectionId}/decline`);
}

export function cancelConnection(connectionId: string): Promise<Connection> {
  return apiClient.post<Connection>(`/connections/${connectionId}/cancel`);
}

/** Remove an accepted connection. Either participant may do this. */
export function removeConnection(connectionId: string): Promise<void> {
  return apiClient.delete<void>(`/connections/${connectionId}`);
}
