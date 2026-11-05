/**
 * Playwright configuration for the browser-level verification suite.
 *
 * **The dev server is not started by Playwright.** `npm run start:web` is
 * expected to be running already (or `npx expo start --web --port 8081`),
 * because Metro's first web bundle takes minutes and starting a second one
 * would fight the first for the port. `webServer` is deliberately absent:
 * `reuseExistingServer` is honoured only when it is configured, and a silent
 * second Metro on another port would silently test the wrong build.
 *
 * The API base URL is the local development backend only. Nothing here points
 * at a production host, and no test may use a production credential.
 */

import { defineConfig, devices } from '@playwright/test';

const WEB_BASE_URL = process.env.E2E_WEB_BASE_URL ?? 'http://localhost:8081';

/**
 * Generous timeouts.
 *
 * The Expo Web dev bundle is served by Metro, which compiles per route on
 * first request, so a cold navigation can take a minute or more. Every wait in
 * the suite is an explicit assertion with its own timeout rather than a fixed
 * sleep, so these ceilings only ever bound a genuine failure.
 *
 * `testTimeout` covers the whole test, and one test performs several cold
 * navigations, so it is set well above a single navigation's cost.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.artifacts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 600_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL: WEB_BASE_URL,
    actionTimeout: 60_000,
    navigationTimeout: 300_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  /**
   * Compile every route the suite visits before the timed tests start.
   *
   * A plain HTTP fetch is enough: Metro's compilation is server-side, so the
   * browser is not involved. A failure here is a compile error, and it should
   * stop the run rather than surface later as a mysterious timeout.
   */
  globalSetup: './e2e/global-setup.ts',
});
