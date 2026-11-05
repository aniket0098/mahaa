# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mobile-runtime.spec.ts >> D: the candidate home and the Learning Hub show real content
- Location: e2e\mobile-runtime.spec.ts:197:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('hub-feed-list')
Expected: visible
Timeout: 60000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByTestId('hub-feed-list') with timeout 60000ms
  - waiting for getByTestId('hub-feed-list')

```

```yaml
- button "Back to Home": 
- text: LEARNING HUB
- heading "Lectures" [level=1]
- text: Learn something new today.  No lectures available yet New learning content will appear here as courses are published.
- tab "Home":  Home
- tab "Lectures":  Lectures
- tab "Courses":  Courses
- tab "Upload":  Upload
- tab "Saved":  Saved
- img
- button "2 <button> cannot contain a nested <button":
  - text: 2 <button> cannot contain a nested <button
  - button:
    - img
```

# Test source

```ts
  111 |   const consoleErrors = collectConsoleErrors(page);
  112 | 
  113 |   await openLoginFromLanding(page);
  114 | 
  115 |   await page.getByLabel('Email address').fill('not-a-real-account@example.com');
  116 |   await page.getByLabel('Password').fill('WrongPassw0rd!');
  117 |   const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  118 |   await expect(submit).toBeEnabled({ timeout: 30_000 });
  119 |   await submit.click();
  120 | 
  121 |   // A persistent banner, not a toast — the error must survive being looked at.
  122 |   await expect(page.getByText('Sign-in failed')).toBeVisible({ timeout: 30_000 });
  123 | 
  124 |   // The server's own message is shown, so a wrong password and an inactive
  125 |   // account stay distinguishable.
  126 |   await expect(page.getByText(/email or password is not correct/i).first()).toBeVisible();
  127 | 
  128 |   // No authenticated redirect happened.
  129 |   await expect(page).toHaveURL(/\/login/);
  130 |   await expect(page.getByTestId('home-screen')).toHaveCount(0);
  131 | 
  132 |   // The form is not cleared on error.
  133 |   await expect(page.getByLabel('Email address')).toHaveValue('not-a-real-account@example.com');
  134 | 
  135 |   expect(consoleErrors, 'a rejected login produced console errors').toEqual([]);
  136 | });
  137 | 
  138 | test('B2: valid credentials enter the candidate flow', async ({ page }) => {
  139 |   const consoleErrors = collectConsoleErrors(page);
  140 | 
  141 |   await openLoginFromLanding(page);
  142 |   await signInThroughUi(page, account);
  143 | 
  144 |   // The account's onboarding is complete, so the guard must let it through to
  145 |   // the candidate home — not hold it at the wizard.
  146 |   await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
  147 |   await expect(page).toHaveURL(/\/home$/);
  148 | 
  149 |   // The candidate tab bar is the real one, with its destinations.
  150 |   await expect(page.getByTestId('tab-home')).toBeVisible();
  151 |   await expect(page.getByTestId('tab-learn')).toBeVisible();
  152 |   await expect(page.getByTestId('tab-profile')).toBeVisible();
  153 | 
  154 |   expect(consoleErrors, 'signing in produced console errors').toEqual([]);
  155 | });
  156 | 
  157 | /* ------------------------------------------------------------------ *
  158 |  * C — Session restoration
  159 |  * ------------------------------------------------------------------ */
  160 | 
  161 | test('C: the session survives a reload and lands back on the candidate home', async ({ page }) => {
  162 |   const consoleErrors = collectConsoleErrors(page);
  163 | 
  164 |   await openLoginFromLanding(page);
  165 |   await signInAndReachHome(page);
  166 | 
  167 |   // The web build's storage fallback: `sessionStorage`, never `localStorage`.
  168 |   // This is the browser fallback for the platform that has no
  169 |   // `expo-secure-store` — it is NOT evidence about native secure storage.
  170 |   const storage = await readTokenStorage(page);
  171 |   expect(storage.session, 'the token should be kept in sessionStorage on web').toBe(true);
  172 |   expect(storage.local, 'the token must never be kept in localStorage').toBe(false);
  173 | 
  174 |   // Reload the page. The session must be restored from the stored token by
  175 |   // asking the server who the caller is — never by trusting the token itself.
  176 |   await page.reload();
  177 | 
  178 |   // No flash of the login screen and no redirect loop: the app resolves the
  179 |   // session and comes back to the home screen.
  180 |   await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
  181 |   await expect(page).toHaveURL(/\/home$/);
  182 |   await expect(page.getByTestId('login-screen')).toHaveCount(0);
  183 | 
  184 |   // A cold load of a protected route restores the session too, rather than
  185 |   // bouncing to /login and back.
  186 |   await gotoApp(page, '/profile');
  187 |   await expect(page.getByTestId('profile-screen')).toBeVisible({ timeout: 60_000 });
  188 |   await expect(page).toHaveURL(/\/profile$/);
  189 | 
  190 |   expect(consoleErrors, 'the session restore produced console errors').toEqual([]);
  191 | });
  192 | 
  193 | /* ------------------------------------------------------------------ *
  194 |  * D — Candidate home and the Learning Hub
  195 |  * ------------------------------------------------------------------ */
  196 | 
  197 | test('D: the candidate home and the Learning Hub show real content', async ({ page }) => {
  198 |   const consoleErrors = collectConsoleErrors(page);
  199 | 
  200 |   await openLoginFromLanding(page);
  201 |   await signInAndReachHome(page);
  202 | 
  203 |   // The home screen renders real server rows (the feed), not a spinner.
  204 |   await expect(page.getByTestId('community-feed')).toBeVisible({ timeout: 60_000 });
  205 | 
  206 |   // Navigate to Learn through the real tab, not by typing a URL.
  207 |   await page.getByTestId('tab-learn').click();
  208 |   await expect(page.getByTestId('learning-hub-home')).toBeVisible({ timeout: 60_000 });
  209 | 
  210 |   // Real lecture content, or an honest empty state — never a stuck skeleton.
> 211 |   await expect(page.getByTestId('hub-feed-list')).toBeVisible();
      |                                                   ^ Error: expect(locator).toBeVisible() failed
  212 |   await expect(page.getByTestId('courses-loading')).toHaveCount(0);
  213 | 
  214 |   const lectureCards = page.locator('[data-testid^="lecture-card-"]');
  215 |   const featured = page.getByTestId('featured-lecture-card');
  216 |   await expect(featured.or(lectureCards).first()).toBeVisible({ timeout: 30_000 });
  217 | 
  218 |   // The hub's own four-section bar is present.
  219 |   await expect(page.getByTestId('hub-tab-index')).toBeVisible();
  220 |   await expect(page.getByTestId('hub-tab-courses')).toBeVisible();
  221 | 
  222 |   expect(consoleErrors, 'the learning hub produced console errors').toEqual([]);
  223 | });
  224 | 
  225 | /* ------------------------------------------------------------------ *
  226 |  * E — Courses and curriculum
  227 |  * ------------------------------------------------------------------ */
  228 | 
  229 | test('E: a course opens, shows its curriculum, and opens a lecture', async ({ page }) => {
  230 |   const consoleErrors = collectConsoleErrors(page);
  231 | 
  232 |   await openLoginFromLanding(page);
  233 |   await signInAndReachHome(page);
  234 | 
  235 |   // Open the catalogue through the hub's own bar.
  236 |   await page.getByTestId('tab-learn').click();
  237 |   await expect(page.getByTestId('learning-hub-home')).toBeVisible({ timeout: 60_000 });
  238 |   await page.getByTestId('hub-tab-courses').click();
  239 | 
  240 |   // The catalogue renders real courses.
  241 |   await expect(page.getByTestId('courses-ready')).toBeVisible({ timeout: 60_000 });
  242 |   const courseCards = page.locator('[data-testid^="course-card-"]');
  243 |   await expect(courseCards.first()).toBeVisible();
  244 | 
  245 |   // Open the first course.
  246 |   await courseCards.first().click();
  247 |   await expect(page.getByTestId('course-detail-screen')).toBeVisible({ timeout: 60_000 });
  248 | 
  249 |   // The title is on screen, and the route carries the course id.
  250 |   await expect(page.getByRole('heading', { name: /dev\./ }).first()).toBeVisible();
  251 |   await expect(page).toHaveURL(/\/course\/[0-9a-f-]{36}$/);
  252 | 
  253 |   // The curriculum is present, with a real lecture count.
  254 |   await expect(page.getByRole('heading', { name: 'Course curriculum' })).toBeVisible();
  255 |   await expect(page.getByText(/section[s]? · \d+ lecture[s]?/)).toBeVisible();
  256 | 
  257 |   // Expand the first section and open its first lecture.
  258 |   const sectionButton = page.locator('[aria-expanded]').filter({ hasText: 'lecture' }).first();
  259 |   await sectionButton.click();
  260 | 
  261 |   const lectureRow = page.getByRole('button', { name: /^Open lesson:/ }).first();
  262 |   await expect(lectureRow).toBeVisible({ timeout: 30_000 });
  263 | 
  264 |   const lectureLabel = (await lectureRow.getAttribute('aria-label')) ?? '';
  265 |   await lectureRow.click();
  266 | 
  267 |   // The lecture screen opens, and the URL carries both the lecture id and
  268 |   // the course id — the parameter the player needs to find the lecture.
  269 |   await expect(page.getByTestId('lecture-player-screen')).toBeVisible({ timeout: 60_000 });
  270 |   await expect(page).toHaveURL(/\/lecture\/[0-9a-f-]{36}\?courseId=[0-9a-f-]{36}$/);
  271 | 
  272 |   // The lecture's own title is on screen, so the player resolved the right row
  273 |   // out of the course's curriculum.
  274 |   const title = lectureLabel.replace('Open lesson: ', '');
  275 |   await expect(page.getByText(title, { exact: false }).first()).toBeVisible();
  276 | 
  277 |   // The curriculum sheet is reachable from the player.
  278 |   await expect(page.getByRole('button', { name: 'Curriculum' })).toBeVisible();
  279 | 
  280 |   expect(consoleErrors, 'the course flow produced console errors').toEqual([]);
  281 | });
  282 | 
  283 | test('E2: returning from a course goes back to the catalogue', async ({ page }) => {
  284 |   const consoleErrors = collectConsoleErrors(page);
  285 | 
  286 |   await openLoginFromLanding(page);
  287 |   await signInAndReachHome(page);
  288 | 
  289 |   await gotoApp(page, '/learn/courses');
  290 |   await expect(page.getByTestId('courses-ready')).toBeVisible({ timeout: 60_000 });
  291 |   await page.locator('[data-testid^="course-card-"]').first().click();
  292 |   await expect(page.getByTestId('course-detail-screen')).toBeVisible({ timeout: 60_000 });
  293 | 
  294 |   // "Back to courses" returns to the catalogue.
  295 |   await page.getByRole('button', { name: 'Back to courses' }).first().click();
  296 |   await expect(page.getByTestId('courses-ready')).toBeVisible({ timeout: 60_000 });
  297 | 
  298 |   expect(consoleErrors, 'returning from a course produced console errors').toEqual([]);
  299 | });
  300 | 
  301 | /* ------------------------------------------------------------------ *
  302 |  * F — Enrolment and My Learning
  303 |  * ------------------------------------------------------------------ */
  304 | 
  305 | test('F: enrolling in a free course is reflected in My Learning', async ({ page, request }) => {
  306 |   const consoleErrors = collectConsoleErrors(page);
  307 | 
  308 |   await openLoginFromLanding(page);
  309 |   await signInAndReachHome(page);
  310 | 
  311 |   await gotoApp(page, '/learn/courses');
```