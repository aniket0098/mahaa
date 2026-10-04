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
  /**
   * The onboarding picker's browse pages.
   *
   * Deliberately a *different* key from `skillCatalog`. That one caches a single
   * `Page` (the profile screen's `AddSkillPanel` asks for one page and stops);
   * this one caches an infinite query's `{pages, pageParams}`. Two different
   * shapes under one key would let whichever screen mounted first hand the other
   * data it cannot read. The `browse` segment keeps the two namespaces apart
   * while still invalidating together under `['skills', 'catalog']`.
   */
  skillCatalogBrowse: (query: string) => ['skills', 'catalog', 'browse', query] as const,
  education: ['profile', 'education'] as const,
  experience: ['profile', 'experience'] as const,
  projects: ['profile', 'projects'] as const,
  myCompanies: ['companies', 'mine'] as const,
  company: (companyId: string) => ['companies', companyId] as const,
  companyMembers: (companyId: string) => ['companies', companyId, 'members'] as const,
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

  /**
   * **Every query whose rendered output can contain an avatar.**
   *
   * This exists so a profile-photo save has one honest answer to "what else shows
   * this face?" instead of a list each screen remembers for itself. The photo
   * used to be written into `queryKeys.me` and nothing else, so the Profile page,
   * the Home header, the post author row, the connections list and a search
   * result all kept rendering the *old* avatar until they happened to refetch on
   * their own — which is why a photo could look saved and still be the previous
   * one (or initials) everywhere else.
   *
   * Prefix keys, so one invalidation covers every variant:
   * - `me`            — `GET /users/me`
   * - `profile`       — `GET /profile` (identity.avatar_url; also the Home header)
   * - `onboarding`    — the photo step's own completion flag
   * - `posts`         — `author.avatar_url` on every card
   * - `connections`   — `user.avatar_url` on every row
   * - `stories`       — `publisher.logo_url`
   * - `userLookup` / `publicProfile` — other people seeing this account
   *
   * `users/me/photo` and `users/lookup` are **not** keys of their own here; they
   * are reached by the `users` prefix, so a single invalidate covers the caller's
   * own account and everybody else's view of it in one call.
   */
  avatarDependent: ['users'] as const,

  /** Requests and connections, in both directions. */
  connections: (status?: string) => ['connections', status ?? 'all'] as const,
  /**
   * Every connections query, whatever the status filter.
   *
   * `connections()` is a function, so it cannot be handed to an invalidation as a
   * prefix directly. React Query matches a filter against the *leading* segments
   * of a key, so this bare `['connections']` covers `connections('all')`,
   * `connections('accepted')` and anything added later without this having to be
   * updated.
   */
  connectionsRoot: ['connections'] as const,

  /** The college workspace. */
  myInstitutions: ['institutions', 'mine'] as const,
  institution: (institutionId: string) => ['institutions', institutionId] as const,
  programs: (institutionId: string) => ['institutions', institutionId, 'programs'] as const,
} as const;
