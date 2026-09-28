/**
 * Principal, session, and token types.
 *
 * Mirrors `apps/api/app/schemas/auth.py` exactly — no field here is invented,
 * and nothing is added for a later stage.
 */

export type UserRole = 'candidate' | 'employer' | 'college' | 'admin';

export interface MembershipSummary {
  company_id: string;
  company_name: string;
  role: string;
  status: string;
}

/** `GET /auth/me` — the authenticated principal, always derived server-side. */
export interface Principal {
  id: string;
  /**
   * The permanent public identity (`MJ-XXXXXXXX`). Assigned once at signup and
   * never changed by any endpoint, so the app only ever displays and copies it.
   */
  public_id: string;
  /**
   * The searchable handle, assigned at signup and changeable under password +
   * cooldown rules. Used for search and sharing, never as a database key.
   */
  username: string;
  name: string;
  email: string;
  role: string;
  /** Recruiter / contact-person title. Optional, so it is nullable. */
  designation?: string | null;
  memberships: MembershipSummary[];
}

/** The account types a person can register as. `admin` is never self-registerable. */
export type SignupRole = 'candidate' | 'employer' | 'college';

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
  role: SignupRole;
}

export interface LoginFormValues {
  email: string;
  password: string;
}
