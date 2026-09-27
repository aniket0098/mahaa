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

import { fetchPrincipal, login as loginRequest, signup as signupRequest } from '@/api/auth';
import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import { AuthContext, type AuthContextValue } from '@/auth/AuthContext';
import { tokenStorage } from '@/auth/tokenStorage';
import type { AuthStatus, LoginFormValues, Principal, SignupFormValues } from '@/types/auth';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
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

  const logout = useCallback(async () => {
    await tokenStorage.clear();
    setPrincipal(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, principal, login, signup, logout }),
    [status, principal, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
