import { createContext, useContext } from 'react';

import type { AuthStatus, LoginFormValues, Principal, SignupFormValues } from '@/types/auth';

export interface AuthContextValue {
  status: AuthStatus;
  principal: Principal | null;
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
