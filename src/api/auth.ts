/**
 * Auth API calls — the only module that talks to `/auth/*`.
 *
 * Every request here maps to a route that exists in
 * `apps/api/app/api/v1/endpoints/auth.py`. No endpoint is invented.
 */

import { apiClient } from '@/api/client';
import type { LoginFormValues, Principal, SignupFormValues, TokenResponse } from '@/types/auth';

export function signup(input: SignupFormValues): Promise<TokenResponse> {
  return apiClient.post<TokenResponse>('/auth/signup', {
    body: {
      name: input.name,
      email: input.email,
      password: input.password,
      phone: input.phone?.trim() ? input.phone.trim() : null,
      role: input.role,
    },
    auth: false,
  });
}

export function login(values: LoginFormValues): Promise<TokenResponse> {
  return apiClient.post<TokenResponse>('/auth/login', {
    body: { email: values.email.trim(), password: values.password },
    auth: false,
  });
}

export function fetchPrincipal(): Promise<Principal> {
  return apiClient.get<Principal>('/auth/me');
}
