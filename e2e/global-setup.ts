/**
 * Global setup — compile the suite's routes before the timed tests run.
 *
 * The Expo Web dev server (Metro) compiles a route the first time it is
 * requested, and that first request can take a minute or more. Fetching each
 * route here moves that cost outside the tests, so a journey's timing reflects
 * the app's behaviour rather than the dev server's first-compile latency.
 *
 * A failure here is a genuine compile error and stops the run, rather than
 * surfacing later as an unexplained timeout inside a journey.
 */

const WEB_BASE_URL = process.env.E2E_WEB_BASE_URL ?? 'http://localhost:8081';

const WARMUP_ROUTES = [
  '/',
  '/login',
  '/home',
  '/profile',
  '/learn',
  '/learn/courses',
  '/my-learning',
];

export default async function globalSetup(): Promise<void> {
  for (const route of WARMUP_ROUTES) {
    const started = Date.now();
    const response = await fetch(`${WEB_BASE_URL}${route}`, {
      // `domcontentloaded`-equivalent: the bundle must be served, but the
      // dev server's HMR socket means `load` may never settle.
      headers: { accept: 'text/html' },
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    if (!response.ok) {
      throw new Error(
        `Warm-up failed for ${route}: the dev server answered ${response.status}. ` +
          'Is `npx expo start --web --port 8081` running?',
      );
    }
    // The body must be drained so the connection is released.
    await response.text();
    console.log(`[e2e] warmed ${route} (${response.status}, ${seconds}s)`);
  }
}
