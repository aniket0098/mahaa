/**
 * Declared query keys. One object, no inline strings at call sites, so cache
 * invalidation stays predictable (mirrors `apps/web/src/api/queryKeys.ts`).
 *
 * Keys are hierarchical and prefixed by domain, so an invalidation can target a
 * whole branch (e.g. `['profile']` refreshes the aggregate and every section
 * screen at once, because they all live under it).
 */

export const queryKeys = {
  health: ['health'] as const,
  readiness: ['readiness'] as const,
  principal: ['auth', 'me'] as const,
  profile: ['profile'] as const,
  completeness: ['profile', 'completeness'] as const,
  privacy: ['profile', 'privacy'] as const,
  preferences: ['profile', 'preferences'] as const,
  mySkills: ['profile', 'skills'] as const,
  skillCatalog: (query: string) => ['skills', 'catalog', query] as const,
  education: ['profile', 'education'] as const,
  experience: ['profile', 'experience'] as const,
  projects: ['profile', 'projects'] as const,
  myCompanies: ['companies', 'mine'] as const,
  company: (companyId: string) => ['companies', companyId] as const,
  companyMembers: (companyId: string) => ['companies', companyId, 'members'] as const,
  resumes: ['resumes'] as const,
  resume: (resumeId: string) => ['resumes', resumeId] as const,
} as const;
