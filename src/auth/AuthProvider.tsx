/**
 * Auth session provider — the mobile counterpart of
 * `apps/web/src/auth/AuthProvider.tsx`.
 *
 * Resolution model (no flash of incorrect navigation):
 *   loading -> authenticated | unauthenticated | forbidden
 *
 * - on mount: with a stored token, the session resolves via `/auth/me` and the
 *   app stays in `loading` until the server answers;
 * - without a token the state settles as `unauthenticated` immediately;
 * - any 401 from any request clears the token and demotes the session.
 *
 * **The realtime socket is part of this provider's job**, opened on
 * `authenticated` and closed on `unauthenticated`/`logout`. It is here rather
 * than in a screen because it has to outlive any one screen (a socket torn down
 * on Home's unmount would stop the feed updating from a detail route) and because
 * the token it authenticates with is the one this provider manages.
 *
 * The only intentional difference from the web provider is that secure-store
 * reads/writes are asynchronous, so `login`/`signup`/`logout` are async here.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { fetchPrincipal, login as loginRequest, signup as signupRequest } from '@/api/auth';
import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import { clearMediaAuth, primeMediaAuth } from '@/api/media';
import { resetPlayback } from '@/features/feed/feedPlayback';
import { AuthContext, type AuthContextValue } from '@/auth/AuthContext';
import { tokenStorage } from '@/auth/tokenStorage';
import { pushDeviceStore } from '@/notifications/deviceStore';
import { unregisterForPush } from '@/notifications/push';
import { bindRealtimeToQueryCache } from '@/realtime/queryBridge';
import { realtimeClient } from '@/realtime/client';
import type { AuthStatus, LoginFormValues, Principal, SignupFormValues } from '@/types/auth';

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * How long logout waits for the unregister before giving up on it.
 *
 * Short enough that a user never perceives a stall, long enough for a healthy
 * request on a normal connection. This is the only reason logout is not
 * instantaneous, so it is deliberately a small number.
 */
const LOGOUT_PUSH_TIMEOUT_MS = 2_000;

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [principal, setPrincipal] = useState<Principal | null>(null);

  useEffect(() => {
    const unsubscribe = apiClient.onUnauthorized(() => {
      setPrincipal(null);
      setStatus('unauthenticated');
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function resolveSession() {
      const stored = await tokenStorage.get();
      if (!stored) {
        if (!cancelled) setStatus('unauthenticated');
        return;
      }
      try {
        const me = await fetchPrincipal();
        if (!cancelled) {
          setPrincipal(me);
          setStatus('authenticated');
        }
      } catch (error) {
        if (cancelled) return;
        await tokenStorage.clear();
        setPrincipal(null);
        setStatus(error instanceof ApiError && error.isForbidden ? 'forbidden' : 'unauthenticated');
      }
    }

    void resolveSession();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The realtime session, tied to the one this provider already owns.
   *
   * **This is where the socket is opened, and it was missing entirely.** The
   * transport, the heartbeat, the reconnect backoff and the event-to-query bridge
   * all existed and were unit tested, but nothing ever called `connect()`, so no
   * socket was ever opened: `post.created` arrived at nobody, and every realtime
   * test passed against a client the app itself never used. A second user's post
   * could therefore only reach the feed by pull-to-refresh.
   *
   * Three properties, in order of importance:
   *
   * 1. **Connected exactly while signed in.** The effect keys on `status`, so a
   *    logout closes the socket and a sign-in opens it — no timer, no manual
   *    call from each screen.
   * 2. **Bound once.** `bindRealtimeToQueryCache` subscribes to the shared
   *    client; a second bind would apply every event twice. The unsubscriber is
   *    held in a ref so the teardown actually runs.
   * 3. **Failures are not session failures.** A WebSocket the server refuses (an
   *    expired token, a blocked upgrade) must never strand somebody on a spinner
   *    or throw during sign-in: the feed still loads over REST, which is the
   *    source of truth. So the connect is not awaited and cannot reject here.
   */
  const unbindRealtime = useRef<(() => void) | null>(null);

  const startRealtime = useCallback(() => {
    if (unbindRealtime.current) return;
    const client = realtimeClient();
    unbindRealtime.current = bindRealtimeToQueryCache();
    // Not awaited: the socket reconnects on its own schedule, and blocking the
    // sign-in on a handshake it does not need would be a worse failure than a
    // missed frame. `.catch` is defensive — `connect()` already swallows its own
    // socket-construction errors.
    void client.connect().catch(() => {
      // The transport reports its own state; a missing socket degrades to REST.
    });
  }, []);

  const stopRealtime = useCallback(() => {
    unbindRealtime.current?.();
    unbindRealtime.current = null;
    void realtimeClient().disconnectForLogout();
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    // The media token cache is filled here rather than per screen: the API serves
    // media bytes only to authenticated callers, so an image in a feed card
    // cannot load until the session's token is in memory.
    void primeMediaAuth();
    startRealtime();
    return () => stopRealtime();
  }, [status, startRealtime, stopRealtime]);

  const login = useCallback(async (values: LoginFormValues) => {
    const token = await loginRequest(values);
    await tokenStorage.set(token.access_token);
    const me = await fetchPrincipal();
    setPrincipal(me);
    setStatus('authenticated');
    return me;
  }, []);

  const signup = useCallback(async (values: SignupFormValues) => {
    const token = await signupRequest(values);
    await tokenStorage.set(token.access_token);
    const me = await fetchPrincipal();
    setPrincipal(me);
    setStatus('authenticated');
    return me;
  }, []);

  /**
   * Clear the session, unregistering the push device first.
   *
   * **The unregister is best-effort and bounded.** A user tapping "log out" on a
   * flaky connection must still be logged out: the request carries a short timeout
   * and its failure is swallowed, because the registration expires on its own and
   * the next sign-in re-registers idempotently. What must not happen is a logout
   * that hangs on a network call.
   *
   * It runs *before* `tokenStorage.clear()` because the call is authenticated —
   * clearing the token first would turn every unregister into a 401.
   *
   * **The query cache is dropped last, and that is the point.** Every screen's
   * data — this account's `me`, its profile, its feed, its connections — stays in
   * memory until now, so signing in as somebody else would render the previous
   * user's avatar, name and posts for as long as the cache's 5-minute `gcTime`
   * had not expired. `clearMediaAuth()` drops the mirrored bearer token for the
   * same reason: a signed-out session must not be able to read media bytes.
   */
  const logout = useCallback(async () => {
    const deviceId = await pushDeviceStore.get();
    if (deviceId) {
      await Promise.race([
        unregisterForPush(deviceId),
        new Promise((resolve) => setTimeout(resolve, LOGOUT_PUSH_TIMEOUT_MS)),
      ]);
      await pushDeviceStore.clear();
    }
    await tokenStorage.clear();
    // The previous account's cached reads must not survive into the next session.
    clearMediaAuth();
    // A video the last session left registered as "active" would hold the feed's
    // single playback slot, so the next account's feed would have nothing able to
    // play. Cleared here for the same reason the query cache is: it is the last
    // moment we still know which session is ending.
    resetPlayback();
    // The socket goes with the session, here rather than only through the
    // `status` effect's cleanup: an authenticated socket that survives a logout
    // would keep this device in the room for the *next* account's events, and its
    // token is already gone. `disconnectForLogout` also drops the cached token, so
    // a reconnect cannot resurrect it.
    stopRealtime();
    queryClient.clear();
    setPrincipal(null);
    setStatus('unauthenticated');
  }, [queryClient, stopRealtime]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, principal, login, signup, logout }),
    [status, principal, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
