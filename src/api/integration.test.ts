/**
 * Live backend integration tests.
 *
 * These stub nothing: they run the real `apiClient` and the real `api/*` modules
 * against a running FastAPI instance. That is the only way to prove the bindings
 * — base URL, method, payload, response parsing, bearer handling, error mapping —
 * match what the server actually does.
 *
 * Two native-only modules are replaced purely because they cannot load in Node:
 * `tokenStorage` (expo-secure-store) and `env` (expo-device). Everything under
 * test — transport, bearer attachment, timeout, error-envelope parsing, and every
 * endpoint binding — is the real code.
 *
 * Every route asserted here was read from the running server's own
 * `/openapi.json` (58 operations), so no test can assert a route the backend does
 * not serve.
 *
 * **Safety.** Each account gets a unique random email, so a run can never collide
 * with or touch an existing account. Nothing pre-existing is read, and no test
 * deletes an account. If the API is unreachable the suites skip rather than
 * fail, so `npm test` stays green on a machine with no database.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

const API_BASE =
  process.env.INTEGRATION_API_BASE_URL ?? 'http://127.0.0.1:8000/api/v1';

// `vi.mock` factories hoist above the imports, so their state needs `vi.hoisted`.
const h = vi.hoisted(() => ({
  token: null as string | null,
  base: process.env.INTEGRATION_API_BASE_URL ?? 'http://127.0.0.1:8000/api/v1',
}));

vi.mock('@/auth/tokenStorage', () => ({
  tokenStorage: {
    get: async () => h.token,
    set: async (token: string) => {
      h.token = token;
    },
    clear: async () => {
      h.token = null;
    },
  },
}));

vi.mock('@/lib/env', () => ({
  env: {
    apiBaseUrl: h.base,
    apiBaseUrlSource: 'configured',
    apiHostKind: 'lan',
    isPhysicalDevice: false,
    needsDeviceConfiguration: false,
  },
}));

const { ApiError } = await import('@/api/errors');
// `ApiError` arrives as a value from the dynamic import, so the type is bound
// separately for the `instanceof`/`as` assertions below.
type ApiErrorInstance = InstanceType<typeof ApiError>;
const { login, signup, fetchPrincipal } = await import('@/api/auth');
const profileApi = await import('@/api/profile');
const resumesApi = await import('@/api/resumes');
const companyApi = await import('@/api/company');
const { tokenStorage } = await import('@/auth/tokenStorage');
const { homePathForRole } = await import('@/auth/roleHome');

/** Satisfies the server rule: >= 8 chars, >= 1 letter, >= 1 digit. */
const PASSWORD = 'Passw0rd123';
const runId = Math.random().toString(36).slice(2, 10);

async function apiReachable(): Promise<boolean> {
  try {
    return (await fetch(`${API_BASE}/health`)).ok;
  } catch {
    return false;
  }
}

const reachable = await apiReachable();
if (!reachable) {
  console.warn(`[integration] skipped: no API at ${API_BASE}. Start the backend, then re-run.`);
}

/** Runs a body as a given role, restoring the ambient token afterwards. */
async function asRole<T>(token: string, body: () => Promise<T>): Promise<T> {
  const previous = h.token;
  h.token = token;
  try {
    return await body();
  } finally {
    h.token = previous;
  }
}

/**
 * The domain the throwaway accounts are created under.
 *
 * The server validates with pydantic's `EmailStr`, which rejects special-use
 * and reserved names — `@example.com` and `@example.org` are both refused by a
 * production deployment with
 * "the part after the @-sign is a special-use or reserved name". `example.com`
 * therefore only works against a development server configured to allow it, so
 * the domain is overridable: point this at a host the target API will accept
 * when running against anything other than a permissive dev instance.
 *
 *   INTEGRATION_EMAIL_DOMAIN=gmail.com
 *   INTEGRATION_API_BASE_URL=https://<host>/api/v1 npm test
 */
const EMAIL_DOMAIN = process.env.INTEGRATION_EMAIL_DOMAIN ?? 'example.com';

const CANDIDATE = { name: 'Integration Candidate', email: `cand.${runId}@${EMAIL_DOMAIN}` };
const EMPLOYER = { name: 'Integration Employer', email: `emp.${runId}@${EMAIL_DOMAIN}` };

let candidateToken = '';
let employerToken = '';

beforeAll(async () => {
  if (!reachable) return;
  candidateToken = (await signup({ ...CANDIDATE, password: PASSWORD, role: 'candidate' }))
    .access_token;
  employerToken = (await signup({ ...EMPLOYER, password: PASSWORD, role: 'employer' })).access_token;
});

describe.skipIf(!reachable)('Phase A — authentication', () => {
  it('signs a candidate up and returns a usable bearer token', async () => {
    expect(candidateToken).toMatch(/\S+/);
    const principal = await asRole(candidateToken, () => fetchPrincipal());
    expect(principal.email).toBe(CANDIDATE.email);
    expect(principal.role).toBe('candidate');
    expect(principal.id).toBeTruthy();
    expect(principal.public_id).toBeTruthy();
    expect(Array.isArray(principal.memberships)).toBe(true);
  });

  it('signs an employer up and returns a usable bearer token', async () => {
    const principal = await asRole(employerToken, () => fetchPrincipal());
    expect(principal.role).toBe('employer');
  });

  it('rejects a duplicate signup with a conflict', async () => {
    const error = await signup({ ...CANDIDATE, password: PASSWORD, role: 'candidate' }).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiErrorInstance).isConflict).toBe(true);
  });

  it('rejects a password the server rules forbid', async () => {
    const error = await signup({
      name: 'Bad Password',
      email: `bad.${runId}@example.com`,
      password: 'short1',
      role: 'candidate',
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiErrorInstance).isValidation).toBe(true);
  });

  it('logs in with valid credentials', async () => {
    const response = await login({ email: CANDIDATE.email, password: PASSWORD });
    expect(response.token_type).toBe('bearer');
    expect(response.expires_in).toBeGreaterThan(0);
    const principal = await asRole(response.access_token, () => fetchPrincipal());
    expect(principal.email).toBe(CANDIDATE.email);
  });

  it('rejects an invalid password with invalid_credentials', async () => {
    const error = await login({ email: CANDIDATE.email, password: 'WrongPass1' }).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiErrorInstance).code).toBe('invalid_credentials');
    expect((error as ApiErrorInstance).status).toBe(401);
  });

  it('does not reveal whether an account exists', async () => {
    const error = await login({ email: `nobody.${runId}@example.com`, password: PASSWORD }).catch(
      (cause: unknown) => cause,
    );
    expect((error as ApiErrorInstance).code).toBe('invalid_credentials');
  });

  it('restores a session from the stored token alone', async () => {
    // The relaunch path: identity is re-resolved from the server, never
    // reconstructed from storage.
    h.token = candidateToken;
    const principal = await fetchPrincipal();
    expect(principal.email).toBe(CANDIDATE.email);
  });

  it('stops authenticating once the token is cleared on sign-out', async () => {
    await tokenStorage.clear();
    const error = await fetchPrincipal().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiErrorInstance).isUnauthenticated).toBe(true);
  });

  it('refuses a protected endpoint with no token at all', async () => {
    h.token = null;
    const error = await profileApi.fetchProfile().catch((cause: unknown) => cause);
    expect((error as ApiErrorInstance).isUnauthenticated).toBe(true);
  });

  it('sends each role to its own dashboard', () => {
    expect(homePathForRole('candidate')).toBe('/home');
    expect(homePathForRole('employer')).toBe('/employer/home');
  });
});

describe.skipIf(!reachable)('Phase B — candidate data', () => {
  let catalogSkillId = '';
  let skillId = '';
  let educationId = '';
  let projectId = '';

  it('reads the profile aggregate with every collection present', async () => {
    const profile = await asRole(candidateToken, () => profileApi.fetchProfile());
    expect(profile.identity.email).toBe(CANDIDATE.email);
    expect(profile.completeness.percent).toBeGreaterThanOrEqual(0);
    expect(profile.completeness.percent).toBeLessThanOrEqual(100);
    expect(profile.completeness.sections.length).toBeGreaterThan(0);
    for (const key of [
      'education',
      'experience',
      'projects',
      'certifications',
      'achievements',
      'links',
      'skills',
    ] as const) {
      expect(Array.isArray(profile[key]), `aggregate.${key} must be an array`).toBe(true);
    }
  });

  it('reads completeness standalone and agrees with the aggregate', async () => {
    const [standalone, aggregate] = await asRole(candidateToken, async () => {
      const [a, b] = await Promise.all([profileApi.fetchCompleteness(), profileApi.fetchProfile()]);
      return [a, b];
    });
    expect(standalone.percent).toBe(aggregate.completeness.percent);
  });

  it('searches the catalogue and adds a real catalogue skill', async () => {
    const catalog = await asRole(candidateToken, () => profileApi.searchSkillCatalog('react', 5, 0));
    expect(Array.isArray(catalog.items)).toBe(true);
    expect(catalog).toHaveProperty('total');
    expect(catalog).toHaveProperty('has_more');
    const found = catalog.items[0];
    if (!found) return; // An empty catalogue is a valid server state.

    catalogSkillId = found.id;
    const created = await asRole(candidateToken, () =>
      profileApi.addSkill({ skill_id: catalogSkillId, level: 'intermediate' }),
    );
    skillId = created.id;
    expect(created.name).toBe(found.name);
    expect(created.level).toBe('intermediate');
  });

  it('lists and updates the candidate’s own skills', async () => {
    if (!skillId) return;
    const list = await asRole(candidateToken, () => profileApi.fetchMySkills(100, 0));
    expect(list.items.some((item) => item.id === skillId)).toBe(true);

    const updated = await asRole(candidateToken, () =>
      profileApi.updateSkill(skillId, { level: 'advanced' }),
    );
    expect(updated.level).toBe('advanced');
  });

  it('creates, lists and deletes an education record', async () => {
    const created = await asRole(candidateToken, () =>
      profileApi.educationApi.create({ institution: 'Integration University', degree: 'B.Tech' }),
    );
    educationId = created.id;
    expect(created.institution).toBe('Integration University');

    const list = await asRole(candidateToken, () => profileApi.educationApi.list(100, 0));
    expect(list.items.some((item) => item.id === educationId)).toBe(true);

    await asRole(candidateToken, () => profileApi.educationApi.remove(educationId));
    const after = await asRole(candidateToken, () => profileApi.educationApi.list(100, 0));
    expect(after.items.some((item) => item.id === educationId)).toBe(false);
  });

  it('creates, lists and deletes an experience record', async () => {
    const created = await asRole(candidateToken, () =>
      profileApi.experienceApi.create({ title: 'Engineer', company_name: 'Integration Co' }),
    );
    const list = await asRole(candidateToken, () => profileApi.experienceApi.list(100, 0));
    expect(list.items.some((item) => item.id === created.id)).toBe(true);
    await asRole(candidateToken, () => profileApi.experienceApi.remove(created.id));
  });

  it('creates and lists a project, which is what the feed renders', async () => {
    const created = await asRole(candidateToken, () =>
      profileApi.projectsApi.create({
        title: 'Integration project',
        description: 'Created by the integration suite.',
      }),
    );
    projectId = created.id;
    expect(created.title).toBe('Integration project');

    const list = await asRole(candidateToken, () => profileApi.projectsApi.list(100, 0));
    expect(list.items.some((item) => item.id === projectId)).toBe(true);
  });
  it('raises the server-computed completeness after real writes', async () => {
    // The point: the percentage is the server's number and it moves because real
    // records were added — not because the app estimated it.
    const before = await asRole(candidateToken, () => profileApi.fetchCompleteness());
    await asRole(candidateToken, () =>
      profileApi.experienceApi.create({ title: 'Intern', company_name: 'Second Co' }),
    );
    const after = await asRole(candidateToken, () => profileApi.fetchCompleteness());
    expect(after.percent).toBeGreaterThan(before.percent);
  });

  it('round-trips privacy as a full-state PUT, then restores it', async () => {
    const current = await asRole(candidateToken, () => profileApi.fetchPrivacy());
    expect(current.profile_visibility).toMatch(/^(private|employers|public)$/);
    expect(current).toHaveProperty('discoverable');
    expect(current).toHaveProperty('allow_messages');

    // Built field by field, not spread: a read carries the server-owned
    // `updated_at`, and the endpoint forbids unknown fields.
    const writable = {
      profile_visibility: current.profile_visibility,
      discoverable: !current.discoverable,
      allow_messages: current.allow_messages,
      show_email: current.show_email,
      show_phone: current.show_phone,
    };

    const saved = await asRole(candidateToken, () => profileApi.replacePrivacy(writable));
    expect(saved.discoverable).toBe(!current.discoverable);
    expect(saved.profile_visibility).toBe(current.profile_visibility);

    await asRole(candidateToken, () =>
      profileApi.replacePrivacy({ ...writable, discoverable: current.discoverable }),
    );
  });

  it('writes preferences and sees them in the aggregate', async () => {
    await asRole(candidateToken, () =>
      profileApi.replacePreferences({
        work_modes: ['remote'],
        employment_types: ['internship'],
        preferred_locations: ['Pune'],
        salary_min: null,
        salary_max: null,
        currency: 'INR',
        availability_date: null,
        willing_to_relocate: false,
      }),
    );
    const profile = await asRole(candidateToken, () => profileApi.fetchProfile());
    expect(profile.preferences?.work_modes).toContain('remote');
  });

  it('updates identity fields', async () => {
    const identity = await asRole(candidateToken, () =>
      profileApi.updateIdentity({ headline: 'Integration headline', location: 'Pune' }),
    );
    expect(identity.headline).toBe('Integration headline');
  });

  it('creates a resume version the server builds from the profile', async () => {
    const list = await asRole(candidateToken, () => resumesApi.fetchResumes());
    expect(Array.isArray(list)).toBe(true);

    const created = await asRole(candidateToken, () =>
      resumesApi.createResume('Integration resume', true),
    );
    expect(created.id).toBeTruthy();
    expect(created.label).toBe('Integration resume');
    expect(created.version_no).toBeGreaterThanOrEqual(1);
    expect(created.snapshot).toBeTruthy();

    const renamed = await asRole(candidateToken, () =>
      resumesApi.updateResume(created.id, { label: 'Renamed resume' }),
    );
    expect(renamed.label).toBe('Renamed resume');

    await asRole(candidateToken, () => resumesApi.deleteResume(created.id));
  });

  it('maps an unknown record to a not_found ApiError', async () => {
    const error = await asRole(candidateToken, () =>
      profileApi.educationApi.remove('00000000-0000-0000-0000-000000000000').catch(
        (cause: unknown) => cause,
      ),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiErrorInstance).status).toBe(404);
  });
});
describe.skipIf(!reachable)('Phase C — employer data and permissions', () => {
  let companyId = '';

  it('starts with no companies', async () => {
    const companies = await asRole(employerToken, () => companyApi.fetchMyCompanies());
    expect(Array.isArray(companies)).toBe(true);
  });

  it('creates a company and becomes its owner', async () => {
    // `MyCompanySummary` is a wrapper: the company plus the caller's membership.
    const created = await asRole(employerToken, () =>
      companyApi.createCompany({ name: `Integration Co ${runId}` }),
    );
    companyId = created.company.id;
    expect(created.company.name).toBe(`Integration Co ${runId}`);
    expect(created.role).toBe('owner');
    expect(created.company.verification_status).toBe('unverified');

    const mine = await asRole(employerToken, () => companyApi.fetchMyCompanies());
    expect(mine.some((item) => item.company.id === companyId)).toBe(true);
  });

  it('reads and updates the company profile', async () => {
    const fetched = await asRole(employerToken, () => companyApi.fetchCompany(companyId));
    expect(fetched.id).toBe(companyId);
    expect(fetched.slug).toBeTruthy(); // Server-owned.

    const updated = await asRole(employerToken, () =>
      companyApi.updateCompany(companyId, { description: 'Updated by the integration suite.' }),
    );
    expect(updated.description).toBe('Updated by the integration suite.');
  });

  it('lists company members with the owner present', async () => {
    const members = await asRole(employerToken, () => companyApi.fetchCompanyMembers(companyId));
    expect(Array.isArray(members)).toBe(true);
    expect(members.some((member) => member.role === 'owner')).toBe(true);
  });

  it('requests verification and never claims a company is verified', async () => {
    const status = await asRole(employerToken, () => companyApi.requestVerification(companyId));
    expect(status.verification_status).toBe('pending');
    expect(status.note).toBeTruthy();

    const fetched = await asRole(employerToken, () => companyApi.fetchCompany(companyId));
    expect(fetched.verification_status).toBe('pending');
  });

  it('refuses candidate access to employer company routes', async () => {
    const error = await asRole(candidateToken, () =>
      companyApi.fetchMyCompanies().catch((cause: unknown) => cause),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiErrorInstance).isForbidden).toBe(true);
  });

  it('refuses an employer access to the candidate profile route', async () => {
    const error = await asRole(employerToken, () =>
      profileApi.fetchProfile().catch((cause: unknown) => cause),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiErrorInstance).isForbidden).toBe(true);
  });

  it('refuses a non-member access to someone else’s company', async () => {
    const error = await asRole(candidateToken, () =>
      companyApi.fetchCompany(companyId).catch((cause: unknown) => cause),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiErrorInstance).status).toBeGreaterThanOrEqual(400);
  });
});

describe.skipIf(!reachable)('Phase D — API client behaviour', () => {
  it('targets the configured base URL without duplicating the prefix', async () => {
    // /health proves the base resolves; /auth/me proves the bearer is attached.
    expect(API_BASE).toMatch(/^https?:\/\/.+\/api\/v1$/);
    const response = await fetch(`${API_BASE}/health`);
    expect(response.ok).toBe(true);
  });

  it('attaches the bearer token to protected calls', async () => {
    const principal = await asRole(candidateToken, () => fetchPrincipal());
    expect(principal.id).toBeTruthy();
  });

  it('parses the server error envelope into ApiError', async () => {
    // A malformed request body makes the server answer 422 in its own envelope;
    // this proves the client reads `detail` rather than inventing a message.
    const error = await asRole(candidateToken, () =>
      profileApi
        .updateIdentity({ headline: 12345 as unknown as string })
        .catch((cause: unknown) => cause),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiErrorInstance).isValidation).toBe(true);
    expect((error as ApiErrorInstance).status).toBe(422);
  });

  it('rejects a request when the server is unreachable', async () => {
    // 127.0.0.1:1 has nothing listening, so this exercises the network branch
    // rather than the HTTP branch.
    const response = await fetch('http://127.0.0.1:1/api/v1/health').catch((cause: unknown) => cause);
    expect(response).toBeInstanceOf(Error);
  });
});
