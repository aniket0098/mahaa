/**
 * The registered push device id — one string, kept so logout can unregister.
 *
 * **This is not the push token.** The token itself is never persisted here: the
 * server holds it, the app can re-derive it from `expo-notifications` at any time,
 * and §13.6 says it is never echoed. All logout needs is the row's id, which is an
 * opaque uuid with no capability attached to it — knowing it lets you delete that
 * row and nothing else, and the delete is owner-checked server-side.
 *
 * Storage mirrors `auth/tokenStorage.ts` deliberately: secure store on device,
 * `sessionStorage` on web (this app also runs as web), and an in-memory fallback so
 * an unavailable store degrades to "cannot unregister on logout" rather than to a
 * crash. That degradation is acceptable because the server's registration expires
 * on its own and the next sign-in re-registers idempotently.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'mahajob.push_device_id';

let memoryDeviceId: string | null = null;

function isSecureStoreAvailable(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export const pushDeviceStore = {
  async get(): Promise<string | null> {
    if (!isSecureStoreAvailable()) {
      return safeSessionStorage()?.getItem(STORAGE_KEY) ?? memoryDeviceId;
    }
    try {
      return (await SecureStore.getItemAsync(STORAGE_KEY)) ?? memoryDeviceId;
    } catch {
      return memoryDeviceId;
    }
  },

  async set(deviceId: string): Promise<void> {
    memoryDeviceId = deviceId;
    if (!isSecureStoreAvailable()) {
      try {
        safeSessionStorage()?.setItem(STORAGE_KEY, deviceId);
      } catch {
        // The memory copy above already covers this tab.
      }
      return;
    }
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, deviceId);
    } catch {
      // Never throw from storage on a registration that already succeeded.
    }
  },

  async clear(): Promise<void> {
    memoryDeviceId = null;
    if (!isSecureStoreAvailable()) {
      try {
        safeSessionStorage()?.removeItem(STORAGE_KEY);
      } catch {
        // Nothing to clear is a success for our purposes.
      }
      return;
    }
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    } catch {
      // Nothing to clear is a success for our purposes.
    }
  },
};