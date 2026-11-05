/**
 * Shared fixtures for the browser E2E suite.
 *
 * **The account is provisioned through the API, not through the sign-up screen.**
 * The sign-up form is one of the journeys under test, but making every test
 * depend on it would (a) couple unrelated tests to one form's behaviour and
 * (b) leave a half-finished account behind whenever a test failed midway.
 * Here the account is created, taken through the minimum profile the server
 * requires, and **deleted again** in `afterAll` — so a green run leaves the
 * development database exactly as it found it.
 *
 * Nothing here invents an endpoint. Every call below is a route that exists in
 * `backend/app/api/v1/router.py`: `POST /auth/signup`, `PATCH /profile`,
 * `POST /profile/education`, `POST /auth/login`, `DELETE /users/me`.
 */

import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API_BASE_URL = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:8000/api/v1';

/**
 * The API origin the **web build** actually calls.
 *
 * `EXPO_PUBLIC_API_BASE_URL_WEB` is `http://localhost:8000/api/v1`, so a
 * browser-level route interception must match `localhost`, not `127.0.0.1` —
 * the two are different origins to the browser even though they resolve to the
 * same server. Node-side requests (`request.post(...)`) may use either, which
 * is why the two constants exist separately.
 */
export const WEB_API_ORIGIN = process.env.E2E_WEB_API_ORIGIN ?? 'http://localhost:8000';

/**
 * A local-development-only password.
 *
 * It satisfies the server policy (min 8, max 128, at least one letter and one
 * digit) and it is **never** a real credential: the account it belongs to is
 * created and destroyed inside the suite. It is deliberately never printed by
 * an assertion, and the helpers below never log a token.
 */
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? 'Passw0rd!2026';

export interface TestAccount {
  email: string;
  password: string;
  /** The account's id, kept so cleanup can report on it precisely. */
  userId: string;
}

/**
 * A unique address per account, so a retried run never collides with an
 * account a previous run left behind (signup answers 409 on a duplicate).
 */
function uniqueEmail(label: string): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `e2e.${label}.${stamp}@example.com`;
}

/**
 * Sign in through the API and return the bearer token.
 *
 * The token is used only to complete onboarding out of band; it is never
 * asserted on and never written to a log.
 */
async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { email, password },
  });
  expect(response.status(), 'login should succeed for the provisioned account').toBe(200);
  const body = (await response.json()) as { access_token: string };
  expect(typeof body.access_token).toBe('string');
  return body.access_token;
}

/**
 * Create a candidate account and take it past onboarding.
 *
 * The server derives onboarding completion from real rows, so a brand-new
 * account is held at `/onboarding` by the role guard and can never reach
 * `/home`. These are the two **required** steps
 * (`backend/app/services/onboarding.py`): `basics` (headline + summary +
 * location) and `about` (one education row). The photo step is optional and is
 * left alone.
 */
export async function provisionCandidate(
  request: APIRequestContext,
  label = 'candidate',
): Promise<TestAccount> {
  const email = uniqueEmail(label);
  const password = TEST_PASSWORD;

  const signup = await request.post(`${API_BASE_URL}/auth/signup`, {
    data: { name: `E2E ${label}`, email, password, phone: null },
  });
  expect(signup.status(), `signup should create the ${label} account`).toBe(201);

  const token = await apiLogin(request, email, password);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const identity = await request.patch(`${API_BASE_URL}/profile`, {
    headers,
    data: {
      headline: 'E2E verification candidate',
      summary: 'Automated browser-verification account. Safe to delete.',
      location: 'Bengaluru, India',
    },
  });
  expect(identity.status(), 'the basics step should save').toBe(200);

  const education = await request.post(`${API_BASE_URL}/profile/education`, {
    headers,
    data: {
      institution: 'MahaJob E2E University',
      degree: 'B.Tech',
      field_of_study: 'Computer Science',
      current: true,
    },
  });
  expect(education.status(), 'the about step should save').toBe(201);

  const me = await request.get(`${API_BASE_URL}/users/me`, { headers });
  expect(me.status()).toBe(200);
  const account = (await me.json()) as { id: string };

  return { email, password, userId: account.id };
}

/**
 * Delete the accounts this suite created.
 *
 * `DELETE /users/me` needs the password and the typed phrase `DELETE`, and it
 * cascades to the profile, the education row and the enrolment. If deletion is
 * not possible the failure is reported rather than swallowed — a silent leak
 * would hide the fact that the development database kept the test data.
 */
export async function deleteAccount(
  request: APIRequestContext,
  account: TestAccount,
): Promise<boolean> {
  try {
    const token = await apiLogin(request, account.email, account.password);
    const response = await request.delete(`${API_BASE_URL}/users/me`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { password: account.password, confirmation: 'DELETE' },
    });
    return response.status() === 204;
  } catch {
    return false;
  }
}

/**
 * Sign in through the **UI**, which is the only way this suite can prove the
 * login journey rather than the API contract.
 *
 * The password is typed into the field and never read back out, so it cannot
 * end up in a screenshot, a trace, or a failure message.
 */
export async function signInThroughUi(page: Page, account: TestAccount): Promise<void> {
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  // The submit control is disabled until both fields hold a value, so wait for
  // it to become actionable instead of clicking a disabled button.
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
}

/**
 * Whether the app currently holds a token, and in which browser store.
 *
 * On web the app uses `sessionStorage` (tab-scoped) and never `localStorage`
 * — `src/auth/tokenStorage.ts` documents this as the deliberate fallback for
 * the platform that has no `expo-secure-store`. This helper reports what the
 * app actually did, so the suite asserts the real behaviour rather than
 * assuming it.
 */
export async function readTokenStorage(page: Page): Promise<{
  session: boolean;
  local: boolean;
  sessionKeys: string[];
  localKeys: string[];
}> {
  return page.evaluate(() => ({
    session: Boolean(window.sessionStorage.getItem('mahajob.access_token')),
    local: Boolean(window.localStorage.getItem('mahajob.access_token')),
    sessionKeys: Object.keys(window.sessionStorage),
    localKeys: Object.keys(window.localStorage),
  }));
}

/**
 * Navigate within the app.
 *
 * `domcontentloaded` rather than the default `load`: the Expo Web dev bundle
 * holds an open HMR websocket, so waiting for `load` couples the assertion to
 * the dev server's connection rather than to the app's own readiness. Every
 * caller then waits on a real element, which is the thing under test.
 */
export async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 300_000 });
}

/**
 * The console errors the page produced, so a test can assert that a journey
 * did not introduce one.
 *
 * Two kinds of message are filtered out, and both are expected rather than
 * defects:
 *
 * - React's own development warnings (nested-button hydration notices from the
 *   community feed) — pre-existing and unrelated to the journeys under test;
 * - the browser's automatic "Failed to load resource: the server responded
 *   with a status of NNN" line, which it logs for **every** non-2xx response.
 *   A rejected sign-in is *supposed* to produce a 401, and the app renders
 *   that rejection in its own banner — the browser's network log is not an
 *   application error. What matters is that the app shows the failure, which
 *   the journey assertions check directly.
 *
 * Anything else — a thrown exception, an unhandled rejection — is reported.
 */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('cannot be a descendant of')) return;
    if (text.includes('cannot contain a nested')) return;
    if (/Failed to load resource: the server responded with a status of \d+/.test(text)) return;
    errors.push(text.slice(0, 300));
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message.slice(0, 300)}`);
  });
  return errors;
}
