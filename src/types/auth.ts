/**
 * Principal, session, and token types.
 *
 * Mirrors `apps/api/app/schemas/auth.py` exactly — no field here is invented,
 * and nothing is added for a later stage.
 */

export type UserRole = 'candidate' | 'employer' | 'admin';

export interface MembershipSummary {
  company_id: string;
  company_name: string;
  role: string;
  status: string;
}

/** `GET /auth/me` — the authenticated principal, always derived server-side. */
export interface Principal {
  id: string;
  public_id: string;
  name: string;
  email: string;
  role: string;
  memberships: MembershipSummary[];
}

/** `POST /auth/login` and `POST /auth/signup`. */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Session resolution states. `loading` must never render protected content and
 * must never trigger a redirect (no flash of incorrect navigation).
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'forbidden';

export interface SignupFormValues {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role: 'candidate' | 'employer';
}

export interface LoginFormValues {
  email: string;
  password: string;
}
