import { createContext, useContext } from 'react';

import type { AuthStatus, LoginFormValues, Principal, SignupFormValues } from '@/types/auth';

export interface AuthContextValue {
  status: AuthStatus;
  principal: Principal | null;
  /**
   * A retryable message for a *transient* session-resolve failure (network,
   * timeout, 5xx), or `null`. The token is preserved in that state, so this is
   * not a sign-out: the cold-start screen shows the message and offers
   * `retrySession`. A genuine invalid/expired session never sets this — it
   * settles to `unauthenticated` instead.
   */
  sessionError: string | null;
  /** Re-run session validation after a transient failure, once connectivity returns. */
  retrySession: () => void;
  login: (values: LoginFormValues) => Promise<Principal>;
  signup: (values: SignupFormValues) => Promise<Principal>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
