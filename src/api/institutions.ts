/**
 * Institutions API — the college workspace.
 *
 * Binds to the `/institutions` router in
 * `apps/api/app/api/v1/endpoints/institutions.py`.
 *
 * Every route is ownership-scoped on the server: the registering contact person
 * owns the institution and anybody else gets 404. The app therefore never sends
 * an owner id — the server derives it from the token — and `program_count` comes
 * from a real `COUNT`, so the workspace can show a number that is true.
 *
 * Verification is request-only in V1: the status moves to `pending` and the
 * server's own note explains that document review is a later stage. Nothing here
 * sets a status, and the UI must not claim a college is verified.
 */

import { apiClient } from '@/api/client';
import type {
  Institution,
  MyInstitutionSummary,
  Program,
  VerificationRequestResponse,
} from '@/types/onboarding';

export function fetchMyInstitutions(): Promise<MyInstitutionSummary[]> {
  return apiClient.get<MyInstitutionSummary[]>('/institutions/mine');
}

export function createInstitution(body: {
  name: string;
  website?: string | null;
  location?: string | null;
  description?: string | null;
}): Promise<MyInstitutionSummary> {
  return apiClient.post<MyInstitutionSummary>('/institutions', { body });
}

export function fetchInstitution(institutionId: string): Promise<Institution> {
  return apiClient.get<Institution>(`/institutions/${institutionId}`);
}

export function updateInstitution(
  institutionId: string,
  body: {
    name?: string;
    website?: string | null;
    location?: string | null;
    description?: string | null;
  },
): Promise<Institution> {
  return apiClient.patch<Institution>(`/institutions/${institutionId}`, { body });
}

/** Records an honest request. The status becomes `pending`; nothing more. */
export function requestInstitutionVerification(
  institutionId: string,
): Promise<VerificationRequestResponse> {
  return apiClient.post<VerificationRequestResponse>(
    `/institutions/${institutionId}/verification-request`,
  );
}

export function listPrograms(institutionId: string): Promise<Program[]> {
  return apiClient.get<Program[]>(`/institutions/${institutionId}/programs`);
}

export function createProgram(
  institutionId: string,
  body: { name: string; level?: string | null; description?: string | null },
): Promise<Program> {
  return apiClient.post<Program>(`/institutions/${institutionId}/programs`, { body });
}

export function updateProgram(
  institutionId: string,
  programId: string,
  body: { name?: string; level?: string | null; description?: string | null },
): Promise<Program> {
  return apiClient.patch<Program>(`/institutions/${institutionId}/programs/${programId}`, { body });
}

export function deleteProgram(institutionId: string, programId: string): Promise<void> {
  return apiClient.delete<void>(`/institutions/${institutionId}/programs/${programId}`);
}
