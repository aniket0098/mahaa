/**
 * Company + membership types — mirrors `apps/api/app/schemas/company.py`.
 *
 * Every field here exists in the server schema. `verification_status` and
 * `slug` are deliberately read-only: the server owns them, and `extra="forbid"`
 * means the API would reject an attempt to write them anyway.
 */

export type CompanySize = '1-10' | '11-50' | '51-200' | '201-500' | '501-1000' | '1000+';

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export type MemberRole = 'owner' | 'admin' | 'recruiter' | 'hiring_manager' | 'viewer';

/** An invite can never mint an owner — ownership changes through a role change. */
export type InvitableRole = 'admin' | 'recruiter' | 'hiring_manager' | 'viewer';

/** `CompanyRead` — `GET /companies/{id}`. */
export interface CompanyRead {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  industry: string | null;
  company_size: string | null;
  location: string | null;
  description: string | null;
  logo_url: string | null;
  verification_status: VerificationStatus;
  status: string;
  created_at: string;
  updated_at: string;
}

/** `MyCompanySummary` — `GET /companies/mine`, and the `POST /companies` result. */
export interface MyCompanySummary {
  company: CompanyRead;
  role: MemberRole;
  membership_status: string;
}

/** `MemberUserRead` — minimal identity; the server never exposes contact details. */
export interface MemberUserRead {
  user_id: string;
  name: string;
  public_id: string;
}

/** `CompanyMemberRead` — `GET /companies/{id}/members`. */
export interface CompanyMemberRead {
  id: string;
  user: MemberUserRead;
  role: MemberRole;
  status: string;
  created_at: string;
  updated_at: string;
}

/** `CompanyCreate` — `POST /companies`. The caller becomes owner server-side. */
export interface CompanyCreate {
  name: string;
  website?: string | null;
  industry?: string | null;
  company_size?: CompanySize | null;
  location?: string | null;
  description?: string | null;
}

/** `CompanyUpdate` — `PATCH /companies/{id}`. `slug`/`verification_status` excluded. */
export interface CompanyUpdate {
  name?: string | null;
  website?: string | null;
  industry?: string | null;
  company_size?: CompanySize | null;
  location?: string | null;
  description?: string | null;
}

/** `MemberInvite` — `POST /companies/{id}/members`. */
export interface MemberInvite {
  email: string;
  role: InvitableRole;
}

/** `MemberUpdate` — `PATCH /companies/{id}/members/{member_id}`. */
export interface MemberUpdate {
  role?: MemberRole;
  status?: 'active' | 'suspended';
}

/** `VerificationRequestResponse` — `POST /companies/{id}/verification-request`. */
export interface VerificationRequestResponse {
  verification_status: VerificationStatus;
  note: string;
}