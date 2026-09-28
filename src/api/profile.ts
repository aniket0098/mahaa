/**
 * Profile API calls — binds to the `/profile` router in
 * `apps/api/app/api/v1/endpoints/profile.py`. No route is invented.
 *
 * The aggregate read is preferred for the profile screen because it is a single
 * round trip; `/profile/completeness` exists for the Home screen, which needs
 * only the server-derived percentage.
 *
 * The per-section endpoints exist as well and are what the section screens
 * (skills, education, experience, projects) read and write: they page, and they
 * return the canonical persisted record after a mutation.
 */

import { apiClient } from '@/api/client';
import type {
  AchievementCreate,
  AchievementRead,
  CandidateSkillCreate,
  CandidateSkillRead,
  CertificationCreate,
  CertificationRead,
  Completeness,
  EducationCreate,
  EducationRead,
  ExperienceCreate,
  ExperienceRead,
  Page,
  PreferencesRead,
  PreferencesUpdate,
  PrivacyRead,
  PrivacyUpdate,
  ProfileAggregate,
  ProfileIdentityUpdate,
  ProjectCreate,
  ProjectRead,
  SkillCatalogItem,
  IdentityRead,
} from '@/types/profile';

export function fetchProfile(): Promise<ProfileAggregate> {
  return apiClient.get<ProfileAggregate>('/profile');
}

export function fetchCompleteness(): Promise<Completeness> {
  return apiClient.get<Completeness>('/profile/completeness');
}

/** `PATCH /profile` — identity fields only (headline, summary, location, interests). */
export function updateIdentity(body: ProfileIdentityUpdate): Promise<IdentityRead> {
  return apiClient.patch<IdentityRead>('/profile', { body });
}

/* ------------------------------ privacy & preferences ------------------------------ */

export function fetchPrivacy(): Promise<PrivacyRead> {
  return apiClient.get<PrivacyRead>('/profile/privacy');
}

/**
 * `PUT` semantics: the body is the complete privacy state, never a patch.
 *
 * The payload is rebuilt from the five writable fields rather than forwarded.
 * `PrivacyRead` extends the server's `ReadModel` and therefore also carries
 * `updated_at`, which TypeScript will happily let you pass straight back in —
 * but `PrivacyUpdate` sets `extra="forbid"`, so the server rejects it. Picking
 * the fields explicitly makes a read-modify-write round trip safe by
 * construction, and keeps server-owned fields off the wire.
 */
export function replacePrivacy(body: PrivacyUpdate): Promise<PrivacyRead> {
  return apiClient.put<PrivacyRead>('/profile/privacy', {
    body: {
      profile_visibility: body.profile_visibility,
      discoverable: body.discoverable,
      allow_messages: body.allow_messages,
      show_email: body.show_email,
      show_phone: body.show_phone,
    },
  });
}

/**
 * `GET /profile/preferences` — the stored work modes, employment types, and
 * preferred locations.
 *
 * Read before writing, because `replacePreferences` is replace-semantics: sending a
 * body assembled from an empty screen would silently erase a real preference list.
 */
export function fetchPreferences(): Promise<PreferencesRead> {
  return apiClient.get<PreferencesRead>('/profile/preferences');
}

export function replacePreferences(body: PreferencesUpdate): Promise<PreferencesRead> {
  return apiClient.put<PreferencesRead>('/profile/preferences', { body });
}

/* ------------------------------------ skills ------------------------------------ */

export function fetchMySkills(limit = 100, offset = 0): Promise<Page<CandidateSkillRead>> {
  return apiClient.get<Page<CandidateSkillRead>>(`/profile/skills?limit=${limit}&offset=${offset}`);
}

export function addSkill(body: CandidateSkillCreate): Promise<CandidateSkillRead> {
  return apiClient.post<CandidateSkillRead>('/profile/skills', { body });
}

export function updateSkill(
  id: string,
  body: { level?: CandidateSkillRead['level']; years?: number | null },
): Promise<CandidateSkillRead> {
  return apiClient.patch<CandidateSkillRead>(`/profile/skills/${id}`, { body });
}

export function removeSkill(id: string): Promise<void> {
  return apiClient.delete<void>(`/profile/skills/${id}`);
}

/** `GET /skills/catalog?q=` — the database-backed catalogue, never a local list. */
export function searchSkillCatalog(
  q: string,
  limit = 25,
  offset = 0,
): Promise<Page<SkillCatalogItem>> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (q.trim()) query.set('q', q.trim());
  return apiClient.get<Page<SkillCatalogItem>>(`/skills/catalog?${query.toString()}`);
}

/* --------------------------- education / experience / projects --------------------------- */

/**
 * The three sections share one shape on the server (list, create, patch, delete)
 * and one pagination envelope, so they are generated from a single descriptor
 * rather than copied three times. `TRead` is what the server returns, `TCreate`
 * what it accepts.
 */
function sectionApi<TRead, TCreate, TUpdate = Partial<TCreate>>(path: string) {
  return {
    list(limit = 100, offset = 0): Promise<Page<TRead>> {
      return apiClient.get<Page<TRead>>(`/profile/${path}?limit=${limit}&offset=${offset}`);
    },
    create(body: TCreate): Promise<TRead> {
      return apiClient.post<TRead>(`/profile/${path}`, { body });
    },
    update(id: string, body: TUpdate): Promise<TRead> {
      return apiClient.patch<TRead>(`/profile/${path}/${id}`, { body });
    },
    remove(id: string): Promise<void> {
      return apiClient.delete<void>(`/profile/${path}/${id}`);
    },
  };
}

export const educationApi = sectionApi<EducationRead, EducationCreate>('education');
export const experienceApi = sectionApi<ExperienceRead, ExperienceCreate>('experience');
export const projectsApi = sectionApi<ProjectRead, ProjectCreate>('projects');

/**
 * Certificates and achievements follow the same server contract as the three
 * above (`/profile/certifications`, `/profile/achievements`), so they reuse the
 * same descriptor instead of growing a fourth copy of it. Both are read by the
 * profile screen straight off the aggregate; these exist for the section screens
 * that write them.
 */
export const certificationsApi = sectionApi<CertificationRead, CertificationCreate>(
  'certifications',
);
export const achievementsApi = sectionApi<AchievementRead, AchievementCreate>('achievements');
