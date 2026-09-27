/**
 * Company + membership API calls — binds to the `/companies` router in
 * `apps/api/app/api/v1/endpoints/companies.py`. No route is invented.
 *
 * Authorization is membership-based on the server, resolved from the token: a
 * non-member gets 404, so nothing here needs (or accepts) a user id.
 */

import { apiClient } from '@/api/client';
import type {
  CompanyCreate,
  CompanyMemberRead,
  CompanyRead,
  CompanyUpdate,
  MemberInvite,
  MemberUpdate,
  MyCompanySummary,
  VerificationRequestResponse,
} from '@/types/company';

/** `GET /companies/mine` — the caller's companies with their membership role. */
export function fetchMyCompanies(): Promise<MyCompanySummary[]> {
  return apiClient.get<MyCompanySummary[]>('/companies/mine');
}

/** `POST /companies` — the creator becomes owner server-side, atomically. */
export function createCompany(body: CompanyCreate): Promise<MyCompanySummary> {
  return apiClient.post<MyCompanySummary>('/companies', { body });
}

export function fetchCompany(companyId: string): Promise<CompanyRead> {
  return apiClient.get<CompanyRead>(`/companies/${companyId}`);
}

/** `slug` and `verification_status` are server-owned and absent from `CompanyUpdate`. */
export function updateCompany(companyId: string, body: CompanyUpdate): Promise<CompanyRead> {
  return apiClient.patch<CompanyRead>(`/companies/${companyId}`, { body });
}

/**
 * Verification is request-only in V1: the status moves to `pending` and the
 * server's own note explains that document review is a later stage. This app
 * never claims a company is verified.
 */
export function requestVerification(companyId: string): Promise<VerificationRequestResponse> {
  return apiClient.post<VerificationRequestResponse>(`/companies/${companyId}/verification-request`);
}

export function fetchCompanyMembers(companyId: string): Promise<CompanyMemberRead[]> {
  return apiClient.get<CompanyMemberRead[]>(`/companies/${companyId}/members`);
}

/**
 * Invite an existing employer account. No email is sent in this stage — the
 * membership is created as `invited` and the invitee accepts it while signed
 * in, which is why the UI must not say "invitation sent".
 */
export function inviteMember(companyId: string, body: MemberInvite): Promise<CompanyMemberRead> {
  return apiClient.post<CompanyMemberRead>(`/companies/${companyId}/members`, { body });
}

export function updateMember(
  companyId: string,
  memberId: string,
  body: MemberUpdate,
): Promise<CompanyMemberRead> {
  return apiClient.patch<CompanyMemberRead>(`/companies/${companyId}/members/${memberId}`, { body });
}

export function removeMember(companyId: string, memberId: string): Promise<void> {
  return apiClient.delete<void>(`/companies/${companyId}/members/${memberId}`);
}

/** `POST /companies/{id}/members/me/accept` — accept your own pending invitation. */
export function acceptMyInvitation(companyId: string): Promise<CompanyMemberRead> {
  return apiClient.post<CompanyMemberRead>(`/companies/${companyId}/members/me/accept`);
}