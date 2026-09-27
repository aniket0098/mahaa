/**
 * Access-token storage — a deliberate, documented V1 tradeoff.
 *
 * - the token is a raw credential kept in the platform secure store — iOS
 *   Keychain, Android Keystore-backed storage via `expo-secure-store`. This is
 *   the native equivalent of the web app's `sessionStorage` choice, and is
 *   stronger because mobile app sandboxes are routinely inspected on rooted
 *   devices;
 * - the token is NOT identity: the authenticated principal is always resolved
 *   from the server via `/auth/me`, never reconstructed from client storage;
 * - httpOnly refresh cookies + rotation replace this in V1.1
 *   (docs/SECURITY.md, Stage 4 section).
 *
 * `expo-secure-store` has no web implementation, so the web target (which this
 * app also runs as, via `expo start --web`) uses `sessionStorage` — tab-scoped,
 * never `localStorage` (docs/SECURITY.md Stage 4 rule J). If storage is
 * unavailable the token is kept in memory for the life of the tab.
 *
 * This fallback is load-bearing, not cosmetic: without it `set()` is a silent
 * no-op on web, so the token returned by login/signup is discarded and the very
 * next `GET /auth/me` goes out with no `Authorization` header and comes back
 * 401 "Authentication required." The account is fine; the session was never kept.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'mahajob.access_token';

/**
 * Last-resort holder for a tab where `sessionStorage` is unavailable (private
 * mode, blocked storage). Keeps login working for the life of the page instead
 * of silently failing the way an empty store would.
 */
let memoryToken: string | null = null;

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

export const tokenStorage = {
  async get(): Promise<string | null> {
    if (!isSecureStoreAvailable()) {
      const stored = safeSessionStorage()?.getItem(STORAGE_KEY) ?? null;
      return stored ?? memoryToken;
    }
    try {
      const value = await SecureStore.getItemAsync(STORAGE_KEY);
      if (value) return value;
      return memoryToken;
    } catch {
      // A corrupt/unreadable keychain entry must not wedge the app: treat it as
      // "no session" and let the user authenticate again.
      return memoryToken;
    }
  },

  async set(token: string): Promise<void> {
    // Always mirror in memory so a platform whose store is unavailable still
    // authenticates this session.
    memoryToken = token;

    if (!isSecureStoreAvailable()) {
      try {
        safeSessionStorage()?.setItem(STORAGE_KEY, token);
      } catch {
        // Memory copy above already covers this tab.
      }
      return;
    }
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, token);
    } catch {
      // Never throw from storage on a login that already succeeded; the token
      // simply will not survive a restart.
    }
  },

  async clear(): Promise<void> {
    memoryToken = null;

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
