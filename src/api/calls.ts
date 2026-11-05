import { apiClient } from '@/api/client';

/**
 * One call as a member of its conversation sees it — mirrors `CallRead`.
 *
 * `caller_id`/`callee_id` are the two participants; direction is derived by
 * comparing `caller_id` to the authenticated user id, so there is no `direction`
 * field that could disagree with the row. Statuses: `ringing`, `answered`,
 * `rejected`, `cancelled`, `ended`, `expired`. Terminal state arrives as
 * `ended` or `rejected` with `ended_at` set.
 */
export interface Call {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  mode: 'audio' | 'video';
  status: 'ringing' | 'answered' | 'rejected' | 'cancelled' | 'ended' | 'expired';
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
}

export interface CallToken {
  token: string;
  server_url: string;
  room_name: string;
  identity: string;
  expires_at: string;
}

export interface CallPage {
  items: Call[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Ring the other member of a conversation — `POST
 * /conversations/{id}/calls`.
 *
 * `mode` defaults to audio; the callee is the other member of the
 * conversation, derived server-side. A new invitation is 201; re-ringing a
 * conversation that already has a live call answers 200 with that call — the
 * caller must obey the contract by treating both as "the call to show" rather
 * than creating a second screen. Idempotent on double-tap for exactly this
 * reason: the server reuses the live call instead of inserting a second row.
 */
export function startCall(
  conversationId: string,
  body: { mode?: 'audio' | 'video' } = {},
): Promise<Call> {
  return apiClient.post<Call>(`/conversations/${conversationId}/calls`, { body });
}

/** Answer an incoming call — callee only. 404 to anybody else. */
export function acceptCall(callId: string): Promise<Call> {
  return apiClient.post<Call>(`/calls/${callId}/accept`);
}

/** Decline an incoming call before answering — callee only. Terminal. */
export function rejectCall(callId: string): Promise<Call> {
  return apiClient.post<Call>(`/calls/${callId}/reject`);
}

/** Give up on a call you started while it is still ringing — caller only. */
export function cancelCall(callId: string): Promise<Call> {
  return apiClient.post<Call>(`/calls/${callId}/cancel`);
}

/** Hang up an answered call — either participant. */
export function endCall(callId: string): Promise<Call> {
  return apiClient.post<Call>(`/calls/${callId}/end`);
}

/**
 * Mint a short-lived LiveKit join token — `GET /calls/{id}/token`.
 *
 * Returned only here, never in a read model, a list, or a socket payload — a
 * client re-requests a token per join rather than caching one. 503 when calling
 * is not configured on this deployment; the screen must render "calling
 * unavailable" from that status, never a fake ringing state. 409 when the call
 * already ended — a token for a finished call would be a key to an empty room.
 */
export function callToken(callId: string): Promise<CallToken> {
  return apiClient.get<CallToken>(`/calls/${callId}/token`);
}

/**
 * Read one call row — `GET /calls/{id}`, members only.
 *
 * The active call screen tracks its lifecycle from this row, re-read over
 * REST: the socket routes (it tells the screen *when* to refetch), the row is
 * the authority on *what changed*.
 */
export function fetchCallRow(callId: string): Promise<Call> {
  return apiClient.get<Call>(`/calls/${callId}`);
}

/** Call history for a conversation, newest first — members only. */
export function listCalls(conversationId: string, limit = 20, offset = 0): Promise<CallPage> {
  return apiClient.get<CallPage>(
    `/conversations/${conversationId}/calls?limit=${limit}&offset=${offset}`,
  );
}
