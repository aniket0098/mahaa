/**
 * Resume API calls — binds to the `/resumes` router in
 * `apps/api/app/api/v1/endpoints/resumes.py`.
 *
 * A "resume" here is a server-generated **version**: a frozen snapshot the
 * backend builds from structured profile data. There is no file upload and no PDF
 * generation, and the client never submits snapshot content — it only creates a
 * version from a label and can rename it or change which one is the default.
 */

import { apiClient } from '@/api/client';
import type { ResumeDetail, ResumeSummary } from '@/types/resume';

export function fetchResumes(): Promise<ResumeSummary[]> {
  return apiClient.get<ResumeSummary[]>('/resumes');
}

export function fetchResume(resumeId: string): Promise<ResumeDetail> {
  return apiClient.get<ResumeDetail>(`/resumes/${resumeId}`);
}

/** The snapshot is generated server-side from the profile as it stands now. */
export function createResume(label: string, isDefault = false): Promise<ResumeDetail> {
  return apiClient.post<ResumeDetail>('/resumes', { body: { label, is_default: isDefault } });
}

export function updateResume(
  resumeId: string,
  body: { label?: string; is_default?: boolean },
): Promise<ResumeSummary> {
  return apiClient.patch<ResumeSummary>(`/resumes/${resumeId}`, { body });
}

export function deleteResume(resumeId: string): Promise<void> {
  return apiClient.delete<void>(`/resumes/${resumeId}`);
}