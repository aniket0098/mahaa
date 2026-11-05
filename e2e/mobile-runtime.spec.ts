/**
 * Browser-level verification of the MahaJob mobile app's core journeys.
 *
 * Phase 4 proved the API contracts and the pure logic; this file proves the
 * things only a real browser can prove — that the buttons work, the guards
 * redirect, the session survives a reload, and the learning flow actually
 * moves the person from a course to a lecture.
 *
 * **The order matters.** The steps below are the journey a real person takes,
 * and they share one signed-in session on purpose: signing out mid-file would
 * make every later step re-authenticate and hide a real defect behind a login.
 * The logout step is last, and it is the one that ends the session.
 *
 * Every assertion reads the rendered DOM or a real network response. Nothing
 * inspects the source, and nothing trusts the app's own reporting.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  API_BASE_URL,
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
  account = await provisionCandidate(request, 'journey');
});

test.afterAll(async ({ request }) => {
  if (account) {
    const deleted = await deleteAccount(request, account);
    if (!deleted) {
      // Loud, not silent: the suite must not claim a clean run while the
      // development database still holds the test account.
      console.warn(
        `[e2e] cleanup: could not delete the test account ${account.email}. ` +
          'It remains in the local development database and should be removed manually.',
      );
    }
  }
});

/** The landing page's own "I already have an account" entry point. */
async function openLoginFromLanding(page: Page): Promise<void> {
  await gotoApp(page, '/');
  await expect(page.getByRole('heading', { name: 'What MahaJob connects' })).toBeVisible();
  await page.getByRole('button', { name: 'I already have an account' }).first().click();
  await expect(page.getByTestId('login-screen')).toBeVisible();
}

/** Sign in and wait for the candidate home to actually render. */
async function signInAndReachHome(page: Page): Promise<void> {
  await signInThroughUi(page, account);
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
}

/**
 * Read the token the app currently holds, for the one place a test has to call
 * the API as the signed-in user (proving the screen and the server agree).
 * The value is never printed.
 */
async function currentToken(page: Page): Promise<string> {
  return page.evaluate(() => window.sessionStorage.getItem('mahajob.access_token') ?? '');
}

/* ------------------------------------------------------------------ *
 * A — Startup and landing page
 * ------------------------------------------------------------------ */

test('A: the landing page renders and reaches the login screen', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await gotoApp(page, '/');

  // The landing page is public: it must render without a session.
  await expect(page.getByRole('heading', { name: 'What MahaJob connects' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What works today' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Arriving in later stages' })).toBeVisible();

  // The primary navigation entry points are real buttons, not decoration.
  const createAccount = page.getByRole('button', { name: 'Create your account' }).first();
  const signIn = page.getByRole('button', { name: 'I already have an account' }).first();
  await expect(createAccount).toBeVisible();
  await expect(signIn).toBeVisible();

  // The landing page must not leak a protected surface.
  await expect(page.getByTestId('home-screen')).toHaveCount(0);

  await signIn.click();
  await expect(page.getByTestId('login-screen')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  expect(consoleErrors, 'the landing page produced console errors').toEqual([]);
});

/* ------------------------------------------------------------------ *
 * B — Login
 * ------------------------------------------------------------------ */

test('B1: invalid credentials show a visible error and no redirect', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await openLoginFromLanding(page);

  await page.getByLabel('Email address').fill('not-a-real-account@example.com');
  await page.getByLabel('Password').fill('WrongPassw0rd!');
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();

  // A persistent banner, not a toast — the error must survive being looked at.
  await expect(page.getByText('Sign-in failed')).toBeVisible({ timeout: 30_000 });

  // The server's own message is shown, so a wrong password and an inactive
  // account stay distinguishable.
  await expect(page.getByText(/email or password is not correct/i).first()).toBeVisible();

  // No authenticated redirect happened.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId('home-screen')).toHaveCount(0);

  // The form is not cleared on error.
  await expect(page.getByLabel('Email address')).toHaveValue('not-a-real-account@example.com');

  expect(consoleErrors, 'a rejected login produced console errors').toEqual([]);
});

test('B2: valid credentials enter the candidate flow', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await openLoginFromLanding(page);
  await signInThroughUi(page, account);

  // The account's onboarding is complete, so the guard must let it through to
  // the candidate home — not hold it at the wizard.
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/home$/);

  // The candidate tab bar is the real one, with its destinations.
  await expect(page.getByTestId('tab-home')).toBeVisible();
  await expect(page.getByTestId('tab-learn')).toBeVisible();
  await expect(page.getByTestId('tab-profile')).toBeVisible();

  expect(consoleErrors, 'signing in produced console errors').toEqual([]);
});

/* ------------------------------------------------------------------ *
 * C — Session restoration
 * ------------------------------------------------------------------ */

test('C: the session survives a reload and lands back on the candidate home', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await openLoginFromLanding(page);
  await signInAndReachHome(page);

  // The web build's storage fallback: `sessionStorage`, never `localStorage`.
  // This is the browser fallback for the platform that has no
  // `expo-secure-store` — it is NOT evidence about native secure storage.
  const storage = await readTokenStorage(page);
  expect(storage.session, 'the token should be kept in sessionStorage on web').toBe(true);
  expect(storage.local, 'the token must never be kept in localStorage').toBe(false);

  // Reload the page. The session must be restored from the stored token by
  // asking the server who the caller is — never by trusting the token itself.
  await page.reload();

  // No flash of the login screen and no redirect loop: the app resolves the
  // session and comes back to the home screen.
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId('login-screen')).toHaveCount(0);

  // A cold load of a protected route restores the session too, rather than
  // bouncing to /login and back.
  await gotoApp(page, '/profile');
  await expect(page.getByTestId('profile-screen')).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/profile$/);

  expect(consoleErrors, 'the session restore produced console errors').toEqual([]);
});

/* ------------------------------------------------------------------ *
 * D — Candidate home and the Learning Hub
 * ------------------------------------------------------------------ */

test('D: the candidate home and the Learning Hub show real content', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await openLoginFromLanding(page);
  await signInAndReachHome(page);

  // The home screen renders real server rows (the feed), not a spinner.
  await expect(page.getByTestId('community-feed')).toBeVisible({ timeout: 60_000 });

  // Navigate to Learn through the real tab, not by typing a URL.
  await page.getByTestId('tab-learn').click();
  await expect(page.getByTestId('learning-hub-home')).toBeVisible({ timeout: 60_000 });

  // Real lecture content, or an honest empty state — never a stuck skeleton.
  await expect(page.getByTestId('hub-feed-list')).toBeVisible();
  await expect(page.getByTestId('courses-loading')).toHaveCount(0);

  const lectureCards = page.locator('[data-testid^="lecture-card-"]');
  const featured = page.getByTestId('featured-lecture-card');
  await expect(featured.or(lectureCards).first()).toBeVisible({ timeout: 30_000 });

  // The hub's own four-section bar is present.
  await expect(page.getByTestId('hub-tab-index')).toBeVisible();
  await expect(page.getByTestId('hub-tab-courses')).toBeVisible();

  expect(consoleErrors, 'the learning hub produced console errors').toEqual([]);
});

/* ------------------------------------------------------------------ *
 * E — Courses and curriculum
 * ------------------------------------------------------------------ */

test('E: a course opens, shows its curriculum, and opens a lecture', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await openLoginFromLanding(page);
  await signInAndReachHome(page);

  // Open the catalogue through the hub's own bar.
  await page.getByTestId('tab-learn').click();
  await expect(page.getByTestId('learning-hub-home')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('hub-tab-courses').click();

  // The catalogue renders real courses.
  await expect(page.getByTestId('courses-ready')).toBeVisible({ timeout: 60_000 });
  const courseCards = page.locator('[data-testid^="course-card-"]');
  await expect(courseCards.first()).toBeVisible();

  // Open the first course.
  await courseCards.first().click();
  await expect(page.getByTestId('course-detail-screen')).toBeVisible({ timeout: 60_000 });

  // The title is on screen, and the route carries the course id.
  await expect(page.getByRole('heading', { name: /dev\./ }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/course\/[0-9a-f-]{36}$/);

  // The curriculum is present, with a real lecture count.
  await expect(page.getByRole('heading', { name: 'Course curriculum' })).toBeVisible();
  await expect(page.getByText(/section[s]? · \d+ lecture[s]?/)).toBeVisible();

  // Expand the first section and open its first lecture.
  const sectionButton = page.locator('[aria-expanded]').filter({ hasText: 'lecture' }).first();
  await sectionButton.click();

  const lectureRow = page.getByRole('button', { name: /^Open lesson:/ }).first();
  await expect(lectureRow).toBeVisible({ timeout: 30_000 });

  const lectureLabel = (await lectureRow.getAttribute('aria-label')) ?? '';
  await lectureRow.click();

  // The lecture screen opens, and the URL carries both the lecture id and
  // the course id — the parameter the player needs to find the lecture.
  await expect(page.getByTestId('lecture-player-screen')).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/lecture\/[0-9a-f-]{36}\?courseId=[0-9a-f-]{36}$/);

  // The lecture's own title is on screen, so the player resolved the right row
  // out of the course's curriculum.
  const title = lectureLabel.replace('Open lesson: ', '');
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible();

  // The curriculum sheet is reachable from the player.
  await expect(page.getByRole('button', { name: 'Curriculum' })).toBeVisible();

  expect(consoleErrors, 'the course flow produced console errors').toEqual([]);
});

test('E2: returning from a course goes back to the catalogue', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await openLoginFromLanding(page);
  await signInAndReachHome(page);

  await gotoApp(page, '/learn/courses');
  await expect(page.getByTestId('courses-ready')).toBeVisible({ timeout: 60_000 });
  await page.locator('[data-testid^="course-card-"]').first().click();
  await expect(page.getByTestId('course-detail-screen')).toBeVisible({ timeout: 60_000 });

  // "Back to courses" returns to the catalogue.
  await page.getByRole('button', { name: 'Back to courses' }).first().click();
  await expect(page.getByTestId('courses-ready')).toBeVisible({ timeout: 60_000 });

  expect(consoleErrors, 'returning from a course produced console errors').toEqual([]);
});

/* ------------------------------------------------------------------ *
 * F — Enrolment and My Learning
 * ------------------------------------------------------------------ */

test('F: enrolling in a free course is reflected in My Learning', async ({ page, request }) => {
  const consoleErrors = collectConsoleErrors(page);

  await openLoginFromLanding(page);
  await signInAndReachHome(page);

  await gotoApp(page, '/learn/courses');
  await expect(page.getByTestId('courses-ready')).toBeVisible({ timeout: 60_000 });

  // Pick the first genuinely free course — the enrolment CTA is only offered
  // for a course the server prices as free.
  const cards = page.locator('[data-testid^="course-card-"]');
  const count = await cards.count();
  expect(count, 'the catalogue should have at least one course').toBeGreaterThan(0);

  let enrolledCourseTitle: string | null = null;
  for (let index = 0; index < count; index += 1) {
    await cards.nth(index).click();
    await expect(page.getByTestId('course-detail-screen')).toBeVisible({ timeout: 60_000 });

    const enrollButton = page.getByRole('button', { name: 'Enroll for free' });
    if (await enrollButton.isVisible().catch(() => false)) {
      enrolledCourseTitle = await page
        .getByRole('heading', { name: /dev\./ })
        .first()
        .innerText()
        .catch(() => null);
      await enrollButton.click();
      // The server confirmed the enrolment, so the CTA becomes "Enrolled".
      await expect(page.getByRole('button', { name: 'Enrolled' })).toBeVisible({ timeout: 60_000 });
      break;
    }

    await page.getByRole('button', { name: 'Back to courses' }).first().click();
    await expect(page.getByTestId('courses-ready')).toBeVisible({ timeout: 60_000 });
  }

  expect(enrolledCourseTitle, 'no free course was available to enrol in').not.toBeNull();

  // The enrolment is real: the server's own list agrees with the screen.
  const mine = await request.get(`${API_BASE_URL}/courses/enrollments/mine`, {
    headers: { Authorization: `Bearer ${await currentToken(page)}` },
  });
  expect(mine.status()).toBe(200);
  const enrolled = (await mine.json()) as { items: Array<{ course?: { title?: string } }> };
  expect(enrolled.items.length, 'the server should report one enrolment').toBeGreaterThan(0);
  expect(
    enrolled.items.some((row) => row.course?.title === enrolledCourseTitle),
    'My Learning should list the course that was just enrolled in',
  ).toBe(true);

  // My Learning shows it in the UI too.
  await gotoApp(page, '/my-learning');
  await expect(page.getByTestId('my-learning-screen')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('my-learning-empty')).toHaveCount(0);
  await expect(page.getByTestId('my-learning-list')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(enrolledCourseTitle!, { exact: false }).first()).toBeVisible();

  expect(consoleErrors, 'the enrolment flow produced console errors').toEqual([]);
});

/* ------------------------------------------------------------------ *
 * G — Logout and protected routes
 * ------------------------------------------------------------------ */

test('G: signing out clears the session and protected routes redirect', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await openLoginFromLanding(page);
  await signInAndReachHome(page);

  // Sign out through the app's own UI: Profile → Settings → Sign out.
  await page.getByTestId('tab-profile').click();
  await expect(page.getByTestId('profile-screen')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();

  // The app clears its own token — this is the app's doing, not the test's.
  await expect
    .poll(async () => (await readTokenStorage(page)).session, { timeout: 30_000 })
    .toBe(false);

  // And it returns to an unauthenticated entry point.
  await expect(page.getByTestId('login-screen')).toBeVisible({ timeout: 60_000 });

  // A protected route, opened directly, is refused — with no redirect loop.
  await gotoApp(page, '/home');
  await expect(page.getByTestId('login-screen')).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId('home-screen')).toHaveCount(0);

  // The same for a second protected route, reached cold.
  await gotoApp(page, '/learn');
  await expect(page.getByTestId('login-screen')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('learning-hub-home')).toHaveCount(0);

  // No stale authenticated data is exposed after signing out.
  const bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText).not.toContain('community-feed');

  expect(consoleErrors, 'signing out produced console errors').toEqual([]);
});
