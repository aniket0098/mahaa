/**
 * Users API — identity, discovery, and the account lifecycle.
 *
 * Binds to the `/users` router in `apps/api/app/api/v1/endpoints/users.py`. No
 * route is invented: every function here maps to a line that exists, and the
 * two rules that shape the module are the server's, not this app's.
 *
 * **Sensitive changes carry a password.** `email` and `username` are identity
 * fields, and this stack has no email verification, so {@link UserUpdate} must
 * include `current_password` for either. The app collects it in the UI rather
 * than letting the request fail and showing a generic error.
 *
 * **A profile is filtered by its owner's privacy settings.** `PublicProfile`
 * omits the fields the viewer is not allowed to see; the app renders what
 * arrives and must not assume a field exists.
 */

import { apiClient } from '@/api/client';
import type {
  Me,
  PublicProfile,
  UserSummary,
  UserUpdate,
  UsernameAvailability,
} from '@/types/onboarding';

export function fetchMe(): Promise<Me> {
  return apiClient.get<Me>('/users/me');
}

/** Ordinary fields need no password; `email` and `username` do. */
export function updateMe(body: UserUpdate): Promise<Me> {
  return apiClient.patch<Me>('/users/me', { body });
}

export function checkUsername(username: string): Promise<UsernameAvailability> {
  return apiClient.get<UsernameAvailability>(
    `/users/me/username/availability?username=${encodeURIComponent(username)}`,
  );
}

/**
 * Search by name, handle, or public id.
 *
 * A name search only reaches accounts that opted in to being discoverable; an
 * exact handle or public id resolves regardless. Both are the server's decision
 * — this function just asks, and renders what comes back.
 */
export function lookupUsers(query: string): Promise<UserSummary[]> {
  return apiClient.get<UserSummary[]>(`/users/lookup?query=${encodeURIComponent(query)}`);
}

export function fetchPublicProfile(publicId: string): Promise<PublicProfile> {
  return apiClient.get<PublicProfile>(`/users/${encodeURIComponent(publicId)}`);
}

/** Pause the account. Nothing is deleted; signing in again reactivates it. */
export function deactivateAccount(): Promise<Me> {
  return apiClient.post<Me>('/users/me/deactivate');
}

/**
 * Delete the account. Irreversible, and the server requires **both** the password
 * and a typed `DELETE` phrase — the two confirmations the safety rules call for.
 */
export function deleteAccount(password: string, confirmation: string): Promise<void> {
  return apiClient.delete<void>('/users/me', { body: { password, confirmation } });
}

export function changePassword(current: string, next: string): Promise<void> {
  return apiClient.post<void>('/users/me/password', {
    body: { current_password: current, new_password: next },
  });
}
