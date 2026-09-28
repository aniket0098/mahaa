/**
 * Types for the registration, onboarding, identity, connections, and college
 * domains — everything the new screens need that is not already in
 * `types/auth.ts` (the principal) or `types/profile.ts` (the candidate profile).
 *
 * Each shape mirrors a read model in `apps/api/app/schemas/`. Where a field is
 * optional rather than nullable, that is deliberate and load-bearing: the server
 * omits a field it withheld, so "not shown" and "shown and empty" stay distinct.
 */

/** Onboarding progress, always server-derived — never a client flag. */
export type OnboardingState = 'not_started' | 'in_progress' | 'completed';

export interface OnboardingStep {
  key: string;
  label: string;
  complete: boolean;
  required: boolean;
  hint: string;
}

export interface OnboardingStateRead {
  role: string;
  state: OnboardingState;
  /**
   * The server's own completeness percentage. The app never computes this, and
   * never substitutes a progress-bar animation for a real value.
   */
  percent: number;
  /** The first required step that is not complete, or null when finished. */
  next_step: string | null;
  steps: OnboardingStep[];
}

/** My own account (`GET /users/me`). */
export interface Me {
  id: string;
  public_id: string;
  username: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  designation: string | null;
  avatar_url: string | null;
  created_at: string;
}

/** The fields the account screen may change. Anything absent is left alone. */
export interface UserUpdate {
  name?: string;
  email?: string;
  phone?: string | null;
  designation?: string | null;
  username?: string;
  /**
   * Required by the server to change `email` or `username`. Those are identity
   * fields, and this stack has no email verification, so the password is the
   * confirmation — the app must collect it before sending either.
   */
  current_password?: string;
}

export interface UsernameAvailability {
  username: string;
  available: boolean;
}

/** One search result. Minimal by design: a name and a way to identify them. */
export interface UserSummary {
  user_id: string;
  public_id: string;
  username: string;
  name: string;
  role: string;
  avatar_url: string | null;
}

/**
 * A privacy-filtered public profile.
 *
 * Everything after `visibility` is **absent** when the viewer is not allowed past
 * the owner's setting, rather than null. "Not shown" and "shown and empty" are
 * different claims, and the app must not blur them into one.
 */
export interface PublicProfile {
  user_id: string;
  public_id: string;
  username: string;
  name: string;
  role: string;
  avatar_url: string | null;
  is_owner: boolean;
  visibility: string;
  designation?: string | null;
  headline?: string | null;
  summary?: string | null;
  location?: string | null;
  interests?: string[];
  email?: string | null;
  phone?: string | null;
  skill_count?: number | null;
  sections?: Record<string, Array<Record<string, unknown>>>;
}

/** One connection request or connection, from the caller's point of view. */
export interface Connection {
  id: string;
  status: 'pending' | 'accepted' | 'declined' | 'canceled' | 'removed';
  /**
   * True when the caller is the one who sent it. This is what keeps the UI
   * honest: only the addressee may accept or decline, only the requester may
   * cancel, and a screen that offered both would be lying about the state.
   */
  is_outgoing: boolean;
  user: UserSummary;
  created_at: string;
  responded_at: string | null;
}

/** A college / institution, as its owner sees it. */
export interface Institution {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  website: string | null;
  location: string | null;
  description: string | null;
  logo_url: string | null;
  /**
   * Server-owned. A client can *request* verification; it can never set this, and
   * the UI must not render a verified badge the server has not granted.
   */
  verification_status: 'unverified' | 'pending' | 'verified' | 'rejected';
  status: string;
  created_at: string;
  updated_at: string;
}

export interface MyInstitutionSummary {
  institution: Institution;
  /** A real count from the table, never a made-up number. */
  program_count: number;
}

export interface Program {
  id: string;
  institution_id: string;
  name: string;
  level: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface VerificationRequestResponse {
  verification_status: Institution['verification_status'];
  /** The server's own explanation of what has and has not happened. */
  note: string;
}
