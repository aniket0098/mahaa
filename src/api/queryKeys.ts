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
  stories: ['stories'] as const,
  story: (storyId: string) => ['stories', storyId] as const,
  /** The Community Feed. Invalidated after a publish so a new post appears. */
  posts: ['posts'] as const,
  /**
   * The caller's own published posts (`GET /posts/mine`). Nested under `posts`
   * so a publish invalidates the count and the list together.
   */
  myPosts: ['posts', 'mine'] as const,
  certifications: ['profile', 'certifications'] as const,
  achievements: ['profile', 'achievements'] as const,
  /** Server-published upload limits, so the composer never hard-codes a copy. */
  mediaLimits: ['media', 'limits'] as const,
  opportunities: (filter?: Record<string, unknown>) => ['opportunities', filter ?? {}] as const,
  opportunity: (opportunityId: string) => ['opportunities', opportunityId] as const,

  /**
   * My own account. Nested under `users` so an account change (name, handle,
   * photo) invalidates it together with the principal.
   */
  me: ['users', 'me'] as const,
  usernameAvailability: (username: string) => ['users', 'username', username] as const,
  userLookup: (query: string) => ['users', 'lookup', query] as const,
  publicProfile: (publicId: string) => ['users', 'public', publicId] as const,

  /**
   * Onboarding state. Invalidated after every step save: the wizard's position,
   * the required-step list, and the completion percentage all live in it, so a
   * stale copy is exactly what would strand somebody on a finished step.
   */
  onboarding: ['onboarding', 'state'] as const,

  /** Requests and connections, in both directions. */
  connections: (status?: string) => ['connections', status ?? 'all'] as const,

  /** The college workspace. */
  myInstitutions: ['institutions', 'mine'] as const,
  institution: (institutionId: string) => ['institutions', institutionId] as const,
  programs: (institutionId: string) => ['institutions', institutionId, 'programs'] as const,
} as const;
