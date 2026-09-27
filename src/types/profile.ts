/**
 * Candidate profile types — mirrors `apps/api/app/schemas/profile.py`.
 *
 * Only fields the app actually reads are declared; nothing is renamed and no
 * field is invented. The profile aggregate is the single round trip the profile
 * screen uses (docs/ARCHITECTURE.md §7).
 */

export interface IdentityRead {
  user_id: string;
  public_id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  headline: string | null;
  summary: string | null;
  location: string | null;
  interests: string[];
  profile_updated_at: string;
}

export interface PrivacyRead {
  /**
   * Narrow on the server side too (`app.schemas.profile.ProfileVisibility`), so
   * this stays a union rather than `string`. That lets a full read be handed
   * straight back to the `PUT` with no cast.
   */
  profile_visibility: ProfileVisibility;
  discoverable: boolean;
  allow_messages: boolean;
  show_email: boolean;
  show_phone: boolean;
  updated_at: string;
}

export interface CompletenessSection {
  key: string;
  label: string;
  weight: number;
  earned: number;
  complete: boolean;
  hint: string;
}

/** Always server-derived — the client never computes this percentage. */
export interface Completeness {
  percent: number;
  sections: CompletenessSection[];
}

export interface CandidateSkillRead {
  id: string;
  skill_id: string;
  name: string;
  category: string | null;
  level: string;
  years: number | null;
  verified: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface EducationRead {
  id: string;
  institution: string;
  degree: string | null;
  field_of_study: string | null;
  level: string | null;
  start_date: string | null;
  end_date: string | null;
  current: boolean;
  grade: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectRead {
  id: string;
  title: string;
  description: string | null;
  role: string | null;
  start_date: string | null;
  end_date: string | null;
  source_url: string | null;
  live_url: string | null;
  skills: { skill_id: string; name: string }[];
  created_at: string;
  updated_at: string;
}

/** `app.schemas.profile.CertificationRead`. */
export interface CertificationRead {
  id: string;
  title: string;
  issuer: string;
  issued_on: string | null;
  expires_on: string | null;
  credential_id: string | null;
  verification_url: string | null;
  created_at: string;
  updated_at: string;
}

/** `app.schemas.profile.AchievementRead`. */
export interface AchievementRead {
  id: string;
  title: string;
  issuer: string | null;
  category: string | null;
  achieved_on: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** `app.schemas.profile.LinkRead`. */
export interface LinkRead {
  id: string;
  kind: string;
  label: string;
  url: string;
  created_at: string;
  updated_at: string;
}

/** `app.schemas.profile.PreferencesRead` — job-search preferences. */
export interface PreferencesRead {
  work_modes: string[];
  employment_types: string[];
  preferred_locations: string[];
  salary_min: number | null;
  salary_max: number | null;
  currency: string;
  availability_date: string | null;
  willing_to_relocate: boolean;
  updated_at: string;
}

/**
 * Pagination envelope — `app.schemas.common.Page` in
 * `apps/api/app/schemas/common.py`. Every list endpoint that returns a
 * `Page[...]` uses exactly these five keys.
 */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/** `app.schemas.skills.SkillCatalogItem` — `GET /skills/catalog`. */
export interface SkillCatalogItem {
  id: string;
  name: string;
  category: string | null;
}

/** `app.schemas.skills.CandidateSkillCreate` — `POST /profile/skills`. */
export interface CandidateSkillCreate {
  skill_id: string;
  level: SkillLevel;
  years?: number | null;
}

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

/** `app.schemas.profile.ExperienceRead` — `GET /profile/experience`. */
export interface ExperienceRead {
  id: string;
  title: string;
  company_name: string;
  location: string | null;
  work_mode: string | null;
  start_date: string | null;
  end_date: string | null;
  current: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** `app.schemas.profile.EducationCreate` — `POST /profile/education`. */
export interface EducationCreate {
  institution: string;
  degree?: string | null;
  field_of_study?: string | null;
  level?: EducationLevel | null;
  start_date?: string | null;
  end_date?: string | null;
  current?: boolean;
  grade?: string | null;
  description?: string | null;
}

export type EducationLevel =
  | 'school'
  | 'diploma'
  | 'undergraduate'
  | 'postgraduate'
  | 'doctorate'
  | 'other';

/** `app.schemas.profile.ExperienceCreate` — `POST /profile/experience`. */
export interface ExperienceCreate {
  title: string;
  company_name: string;
  location?: string | null;
  work_mode?: WorkMode | null;
  start_date?: string | null;
  end_date?: string | null;
  current?: boolean;
  description?: string | null;
}

export type WorkMode = 'remote' | 'hybrid' | 'onsite';

/** `app.schemas.profile.ProjectCreate` — `POST /profile/projects`. */
export interface ProjectCreate {
  title: string;
  description?: string | null;
  role?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  source_url?: string | null;
  live_url?: string | null;
  skill_ids?: string[];
}

/** `app.schemas.profile.PrivacyUpdate` — `PUT /profile/privacy` (full state). */
export interface PrivacyUpdate {
  profile_visibility: ProfileVisibility;
  discoverable: boolean;
  allow_messages: boolean;
  show_email: boolean;
  show_phone: boolean;
  /**
   * Intentionally not assignable from `PrivacyRead`.
   *
   * `PrivacyRead` carries the server-owned `updated_at`, and the endpoint sets
   * `extra="forbid"`, so handing a read straight back would be a 422. The
   * nominal marker makes that a compile error rather than a runtime failure;
   * `replacePrivacy` builds its payload from the writable fields instead.
   */
  readonly __privacyWriteOnly?: never;
}

export type ProfileVisibility = 'private' | 'employers' | 'public';

/** `app.schemas.profile.PreferencesUpdate` — `PUT /profile/preferences`. */
export interface PreferencesUpdate {
  work_modes: WorkMode[];
  employment_types: string[];
  preferred_locations: string[];
  salary_min: number | null;
  salary_max: number | null;
  currency: string;
  availability_date: string | null;
  willing_to_relocate: boolean;
}

/** `app.schemas.profile.ProfileIdentityUpdate` — `PATCH /profile`. */
export interface ProfileIdentityUpdate {
  headline?: string | null;
  summary?: string | null;
  location?: string | null;
  interests?: string[] | null;
}

export interface ProfileAggregate {
  identity: IdentityRead;
  privacy: PrivacyRead;
  completeness: Completeness;
  education: EducationRead[];
  experience: ExperienceRead[];
  projects: ProjectRead[];
  certifications: CertificationRead[];
  achievements: AchievementRead[];
  links: LinkRead[];
  skills: CandidateSkillRead[];
  preferences: PreferencesRead | null;
}
