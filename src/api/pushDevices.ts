/**
 * Push device registration — the mobile half of §13.6.
 *
 * Binds to the two `/notifications/devices` routes. Both are authenticated and
 * both are owner-scoped, so this module never sends a user id: the server derives
 * the owner from the bearer token, and a `user_id` field in the body is a 422
 * rather than something to work around.
 *
 * **The push token is write-only.** The server never echoes it (§13.6), so
 * {@link PushDevice} has no `push_token` field and nothing here can leak one into
 * a log, a state dump, or an error message. The device id is the only handle the
 * app keeps, and it is needed solely to unregister on logout.
 */

import { apiClient } from '@/api/client';

/** The two platforms the server's CHECK constraint accepts (§14.13). */
export type PushPlatform = 'android' | 'ios';

/**
 * A registered device, as the server describes it.
 *
 * `is_active` is false when the provider rejected the token. The server disabled
 * the row rather than deleting it (§13.5), and the app re-registers on the next
 * authenticated start, which reactivates it.
 */
export interface PushDevice {
  id: string;
  platform: string;
  device_name: string | null;
  is_active: boolean;
  created_at: string;
  last_seen_at: string | null;
}

export interface DeviceRegistrationBody {
  push_token: string;
  platform: PushPlatform;
  device_name?: string | null;
}

/**
 * Register (or refresh) this device for push delivery.
 *
 * Idempotent server-side: the same account presenting the same token always
 * resolves to the same row, so calling this on every authenticated start is
 * correct and cannot accumulate devices.
 */
export function registerDevice(body: DeviceRegistrationBody): Promise<PushDevice> {
  return apiClient.post<PushDevice>('/notifications/devices', { body });
}

/**
 * Remove this device's registration — called before logout clears the session.
 *
 * A 404 is a legitimate outcome (the row was already removed, or the provider
 * disabled it), and the caller treats both as success; see `push.ts`.
 */
export function removeDevice(deviceId: string): Promise<void> {
  return apiClient.delete<void>(`/notifications/devices/${deviceId}`);
}