/**
 * Network-failure and recovery behaviour (journey step H).
 *
 * **The failure is simulated in the browser, not by stopping the backend.**
 * `page.route()` aborts the app's own requests to the local API, so the
 * development server, the database and every other process keep running
 * untouched. It is the closest a browser test can get to the backend going
 * away, and it is reversible: `page.unroute()` restores normal connectivity.
 *
 * Two independent failures are exercised:
 *
 * 1. **A dead API on the sign-in screen.** The login screen carries the API
 *    connection panel precisely so this is visible. The app must show a
 *    recoverable error, must not claim success, and must not hang.
 * 2. **A dead API on an authenticated screen.** The catalogue must show its
 *    persistent error banner with a working retry, and the retry must recover
 *    once the network is restored.
 */

import { expect, test } from '@playwright/test';

import {
  WEB_API_ORIGIN,
  collectConsoleErrors,
  deleteAccount,
  gotoApp,
  provisionCandidate,
  readTokenStorage,
  signInThroughUi,
  type TestAccount,
} from './fixtures';

test.describe.configure({ mode: 'serial' });

let account: TestAccount;

test.beforeAll(async ({ request }) => {
  account = await provisionCandidate(request, 'network');
});

test.afterAll(async ({ request }) => {
  if (account) {
    const deleted = await deleteAccount(request, account);
    if (!deleted) {
      console.warn(
        `[e2e] cleanup: could not delete the test account ${account.email}. ` +
          'It remains in the local development database.',
      );
    }
  }
});

test('H1: a dead API on the login screen shows a recoverable error', async ({ page }) => {
  // Every call to the local API fails at the network layer.
  await page.route(`${WEB_API_ORIGIN}/**`, (route) => route.abort('connectionrefused'));

  await gotoApp(page, '/login');
  await expect(page.getByTestId('login-screen')).toBeVisible({ timeout: 60_000 });

  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password').fill(account.password);

  // The submit control is enabled only once the form has both fields, so wait
  // for it to become actionable rather than clicking a disabled button.
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();

  // The app must report the failure — never silently succeed.
  await expect(page.getByText('Sign-in failed')).toBeVisible({ timeout: 30_000 });

  // It must not have pretended to authenticate.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId('home-screen')).toHaveCount(0);
  expect((await readTokenStorage(page)).session).toBe(false);

  // The connection panel names the API it could not reach. The panel probes on
  // mount, so the failure is visible without any interaction.
  await expect(page.getByText(/Cannot reach|Network request failed/i).first()).toBeVisible({
    timeout: 30_000,
  });

  // The "Check" control is there, so the person can retry.
  await expect(page.getByRole('button', { name: 'Check the API connection' })).toBeVisible();
});

test('H2: a failed course load shows a retry that recovers', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  // Sign in first, while the API is reachable.
  await gotoApp(page, '/login');
  await expect(page.getByTestId('login-screen')).toBeVisible({ timeout: 60_000 });
  await signInThroughUi(page, account);
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });

  // Now the catalogue's own request fails.
  await page.route(`${WEB_API_ORIGIN}/api/v1/courses**`, (route) =>
    route.abort('connectionrefused'),
  );

  await gotoApp(page, '/learn/courses');
  await expect(page.getByTestId('courses-error')).toBeVisible({ timeout: 60_000 });

  // A persistent banner with a retry — not a spinner that never ends, and not
  // a fabricated empty catalogue.
  await expect(page.getByText(/couldn't load|could not load|failed/i).first()).toBeVisible();
  await expect(page.getByTestId('courses-loading')).toHaveCount(0);

  const retry = page.getByRole('button', { name: 'Retry' }).first();
  await expect(retry).toBeVisible();

  // Restore connectivity and use the app's own retry control.
  await page.unroute(`${WEB_API_ORIGIN}/api/v1/courses**`);
  await retry.click();

  // The catalogue recovers into its real, populated state.
  await expect(page.getByTestId('courses-ready')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-testid^="course-card-"]').first()).toBeVisible();

  expect(consoleErrors, 'the recovery flow produced console errors').toEqual([]);
});
