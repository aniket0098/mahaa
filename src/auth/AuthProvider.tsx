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
 * The only intentional difference from the web provider is that secure-store
 * reads/writes are asynchronous, so `login`/`signup`/`logout` are async here.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { fetchPrincipal, login as loginRequest, signup as signupRequest } from '@/api/auth';
import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import { clearMediaAuth } from '@/api/media';
import { AuthContext, type AuthContextValue } from '@/auth/AuthContext';
import { tokenStorage } from '@/auth/tokenStorage';
import { pushDeviceStore } from '@/notifications/deviceStore';
import { unregisterForPush } from '@/notifications/push';
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
    queryClient.clear();
    setPrincipal(null);
    setStatus('unauthenticated');
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, principal, login, signup, logout }),
    [status, principal, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
