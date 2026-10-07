/**
 * Real two-user UI verification, driven against the running web build.
 *
 * Two **isolated browser contexts**, so the sessions have separate cookie and
 * `sessionStorage` jars and are genuinely two different people. That is the
 * whole point: the token lives in `sessionStorage` on web, so two tabs of one
 * window would share it and the test would silently pass while proving nothing.
 *
 * Every assertion reads the rendered DOM or the network log. Nothing inspects
 * the source, and nothing trusts the app's own reporting — if a post does not
 * appear in User B's pixels, it fails.
 *
 *   node tools/ui-verify.mjs
 */

import { writeFileSync } from 'node:fs';

import { connect, openPage } from './cdp.mjs';

/**
 * The exported build, served by `tools/serve-export.mjs`.
 *
 * **Not the dev server on 8081.** Same application code, but the dev server
 * compiles per browser context on first load and takes minutes to hand a browser
 * its bundle, which makes an iterative two-session run impractical. This value
 * points at the compiled export of the same tree.
 */
const WEB = 'http://localhost:8082';
const API = 'http://localhost:8000/api/v1';
const MEDIA = 'C:/mahaa/.e2e-media';
const PASSWORD = 'Passw0rd!2026';

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}\n`);
};

/**
 * Progress that survives a piped (fully buffered) stdout.
 *
 * `console.log` alone is invisible until exit when the output is redirected to a
 * file, so a run that hangs in a 90-second `waitFor` looks identical to one that
 * is working. `process.stdout.write` goes to the fd directly and is not buffered
 * by the pipe, so each step is visible while it happens.
 */
const step = (message) => process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${message}\n`);

/** Create an account through the public API, so the browser signs in for real. */
async function createUser(label) {
  const stamp = Math.random().toString(36).slice(2, 10);
  const email = `uiv.${label}.${stamp}@example.com`;
  const response = await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `UI ${label}`,
      email,
      password: PASSWORD,
      phone: null,
      role: 'candidate',
    }),
  });
  if (!response.ok) {
    throw new Error(`signup ${label}: ${response.status} ${await response.text()}`);
  }
  const { access_token: token } = await response.json();

  const user = { label, email, password: PASSWORD, token };

  /**
   * Satisfy the onboarding gate before the browser ever sees the account.
   *
   * **Account setup, not part of what is under test.** A brand-new candidate is
   * routed to the wizard, and the wizard asks for a headline, a location, a bio
   * and an education row before Home is reachable. Driving four wizard steps
   * through the UI for each of two users would be testing the wizard, and the
   * subject here is the feed, stories and realtime sync. So the profile is
   * created here, once, through the same public API a person would use — and the
   * browser then signs in to an account that already has what Home needs.
   *
   * The wizard's own rule, from `services/onboarding.py`: `basics` needs a
   * headline, a summary and a location; `about` needs a real education row.
   */
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const identity = await fetch(`${API}/profile`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({
      headline: `Verification Engineer (${label.toUpperCase()})`,
      location: 'Pune, India',
      summary: `A verification account used to check that content reaches another member's Home.`,
    }),
  });
  if (!identity.ok) {
    throw new Error(`identity for ${label}: ${identity.status} ${await identity.text()}`);
  }

  const education = await fetch(`${API}/profile/education`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      institution: 'MIT',
      degree: 'B.Tech',
      field_of_study: 'Computer Science',
      current: true,
    }),
  });
  if (!education.ok) {
    throw new Error(`education for ${label}: ${education.status} ${await education.text()}`);
  }

  return user;
}

/**
 * Set a React-controlled input's value.
 *
 * The native setter is used deliberately: assigning `el.value` directly does not
 * notify React, whose synthetic `onChange` would never fire, so the field would
 * look filled while the app still believed it empty.
 */
const FILL = `
  const setNative = (el, value) => {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
`;

/** Sign in through the app's own login screen. */
async function signIn(page, user) {
  step(`${user.label}: loading the login screen`);
  await page.goto(`${WEB}/login`, { timeoutMs: 120_000 });
  await page.waitFor(
    `!!document.querySelector('input[type="email"], input[name="email"]')`,
    { label: 'the login form', timeoutMs: 60_000 },
  );
  step(`${user.label}: login form is on screen`);

  const filled = await page.eval(`
    ${FILL}
    const email = document.querySelector('input[type="email"], input[name="email"]');
    const password = document.querySelector('input[type="password"], input[name="password"]');
    if (!email || !password) {
      return { ok: false, inputs: Array.from(document.querySelectorAll('input'))
        .map((i) => i.type || i.name || '?') };
    }
    setNative(email, ${JSON.stringify(user.email)});
    setNative(password, ${JSON.stringify(user.password)});
    return { ok: true };
  `);
  if (!filled.ok) throw new Error(`login inputs missing: ${JSON.stringify(filled.inputs)}`);

  const clicked = await page.eval(`
    const button = Array.from(document.querySelectorAll('button, [role="button"]'))
      .find((b) => /sign in|log in/i.test(b.innerText || b.getAttribute('aria-label') || ''));
    if (!button) return { clicked: false };
    button.click();
    return { clicked: true };
  `);
  if (!clicked.clicked) throw new Error('no sign-in button found');
  step(`${user.label}: sign-in submitted, waiting for the app to route`);

  // **Not `pathname === '/home'`.** A brand-new account has no profile yet, so the
  // app is entitled to route it to onboarding first; insisting on `/home` here
  // would report a routing decision as a broken login. What matters is that the
  // session is established, which is proven by reaching an authenticated screen.
  const landed = await page.waitFor(
    `location.pathname !== '/login' ? location.pathname : null`,
    { label: 'an authenticated screen', timeoutMs: 90_000 },
  );
  step(`${user.label}: authenticated, landed on ${landed}`);

  await completeOnboarding(page, user);
  return page;
}

/**
 * Fill the onboarding wizard, if it appeared.
 *
 * **Returns nothing, and is a no-op when onboarding is not shown.** Whether a new
 * account is sent to onboarding is the server's decision (an account with no
 * profile gets it), so the test must not depend on that decision either way.
 * Presence is therefore detected by route and absence is simply "nothing to do".
 */
async function completeOnboarding(page, user) {
  const onWizard = await page.eval('return location.pathname === "/onboarding";');
  if (!onWizard) return false;

  const filled = await page.eval(`
    const setNative = (el, value) => {
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const fields = Array.from(document.querySelectorAll('input, textarea'))
      .filter((el) => !['checkbox', 'radio', 'file'].includes(el.type));
    const valueFor = (el) => {
      const hint = ((el.getAttribute('placeholder') || '') + ' ' +
        (el.getAttribute('aria-label') || '') + ' ' + (el.name || '')).toLowerCase();
      if (/email/.test(hint)) return ${JSON.stringify(user.email)};
      if (/phone|mobile/.test(hint)) return '+919876543210';
      if (/city|location/.test(hint)) return 'Pune';
      if (/date|dob|birth/.test(hint)) return '2000-01-01';
      if (/school|university|college|institution/.test(hint)) return 'MIT';
      if (/degree|course|field|major/.test(hint)) return 'Computer Science';
      if (/year/.test(hint)) return '2024';
      if (/first|given/.test(hint)) return 'Ui';
      if (/last|surname|family/.test(hint)) return ${JSON.stringify(user.label.toUpperCase())};
      if (/password/.test(hint)) return ${JSON.stringify(user.password)};
      if (/headline|title|role/.test(hint)) return 'Software Engineer';
      return 'Verification Engineer';
    };
    for (const field of fields) setNative(field, valueFor(field));
    return { count: fields.length };
  `);
  step(`${user.label}: onboarding wizard shown, filled ${filled.count} field(s)`);

  // Click forward until the wizard stops asking. Bounded, so a wizard that never
  // advances reports itself instead of looping.
  for (let advance = 0; advance < 8; advance += 1) {
    const outcome = await page.eval(`
      if (location.pathname !== '/onboarding') return { left: true };
      const button = Array.from(document.querySelectorAll('button, [role="button"]'))
        .find((b) => /next|continue|save|finish|submit|done|complete/i.test(b.innerText || '')
          && b.disabled !== true);
      if (!button) return { left: false, stuck: true };
      button.click();
      return { clicked: (button.innerText || '').trim() };
    `);
    await new Promise((r) => setTimeout(r, 1500));
    const left = await page.eval('return location.pathname !== "/onboarding";');
    if (left) {
      step(`${user.label}: onboarding complete`);
      return true;
    }
    if (outcome.stuck) {
      step(`${user.label}: onboarding has no enabled advance button`);
      break;
    }
  }

  // An account still in the wizard cannot reach Home, so go there directly once
  // the wizard has been given a fair chance.
  const after = await page.eval('return location.pathname;');
  if (after.startsWith('/onboarding')) {
    step(`${user.label}: leaving onboarding (${after}) for home`);
    await page.goto(`${WEB}/home`, { timeoutMs: 60_000 });
  }
  return false;
}

/** A snapshot of what the page is actually showing. */
const SNAPSHOT = `
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const scroller = Array.from(document.querySelectorAll('div'))
    .find((d) => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 200);
  return {
    path: location.pathname + location.search,
    text: document.body.innerText,
    images: Array.from(document.querySelectorAll('img')).filter(visible).map((img) => ({
      src: img.currentSrc || img.src,
      loaded: img.complete && img.naturalWidth > 0,
      natural: img.naturalWidth + 'x' + img.naturalHeight,
    })),
    videos: Array.from(document.querySelectorAll('video')).filter(visible).map((v) => ({
      src: v.currentSrc || v.src,
      muted: v.muted,
      paused: v.paused,
      readyState: v.readyState,
      duration: Number.isFinite(v.duration) ? Number(v.duration.toFixed(2)) : String(v.duration),
      width: v.videoWidth,
      height: v.videoHeight,
    })),
    scroll: scroller
      ? { top: Math.round(scroller.scrollTop), view: scroller.clientHeight, total: scroller.scrollHeight }
      : null,
  };
`;

/** What the page is saying about problems, as distinct from a generic apology. */
const NOTICES = `
  const texts = Array.from(document.querySelectorAll('div, span, p'))
    .map((el) => (el.innerText || '').trim())
    .filter((t) => t && t.length < 400);
  const problems = [...new Set(texts.filter((t) =>
    /error|failed|did not|not uploaded|not published|could not|try again|skipped|too large|unsupported|offline|expired/i.test(t)
  ))];
  return { problems, generic: problems.some((t) => /something went wrong/i.test(t)) };
`;

/**
 * Hand files to the hidden `<input type="file">` the web image picker creates.
 *
 * `expo-image-picker` on web appends a real file input and clicks it, so that
 * input is the only way a person can choose a file. Setting its `files` and
 * firing `change` is exactly what the OS file dialog would have done — the app
 * downstream of that point is untouched, which is what keeps this a UI test
 * rather than an API test wearing a browser costume.
 *
 * **The input is waited for, not assumed.** The picker creates it when
 * `launchImageLibraryAsync` runs, which is a tick or more after the button press
 * returns, so a caller that has only just clicked has nothing to attach to yet.
 */
async function attachFiles(page, paths) {
  await page.waitFor(`!!document.querySelector('input[type="file"]')`, {
    label: 'the image picker to open a file input',
    timeoutMs: 20_000,
  });

  for (const path of paths) {
    await page.setFiles(path);
  }

  return page.eval(`
    const input = document.querySelector('input[type="file"]');
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.files.length;
  `);
}

/** Reset the recorded network log, so one phase cannot be credited to another. */
function markNetwork(page) {
  page.network.length = 0;
}

/**
 * Summarise a page's recorded traffic: what failed, and what was malformed.
 *
 * Every field is defaulted, because the log holds heterogeneous entry kinds
 * (`ws_created` has no `status`, a `response` may have no `method`) and a check
 * that assumed a uniform shape would throw instead of reporting.
 */
function auditNetwork(page) {
  const bad = page.network
    .filter((n) => n.type === 'response' && typeof n.status === 'number' && n.status >= 400)
    .map((n) => `${n.status} ${n.url.replace(WEB, '').replace(API, '/api/v1')}`);
  const doubled = page.network
    .filter((n) => typeof n.url === 'string' && n.url.includes('/api/v1/api/v1/'))
    .map((n) => n.url);
  const sockets = page.network.filter((n) => n.type === 'ws_created').length;
  const frames = page.network.filter((n) => n.type === 'ws_frame' && n.payload);
  return {
    bad,
    doubled,
    sockets,
    frames,
    responses: page.network.filter((n) => n.type === 'response').length,
  };
}

/** The content events User B's socket actually received, by type. */
function receivedEvents(page) {
  const found = [];
  for (const frame of auditNetwork(page).frames) {
    try {
      const parsed = JSON.parse(frame.payload);
      if (parsed && typeof parsed.type === 'string') found.push(parsed.type);
    } catch {
      // A non-JSON frame is not a content event; ignore it.
    }
  }
  return found;
}

/** Count occurrences of a marker in the rendered text. */
const countText = (needle) => `
  const text = document.body.innerText;
  let total = 0;
  let at = text.indexOf(${JSON.stringify(needle)});
  while (at !== -1) { total += 1; at = text.indexOf(${JSON.stringify(needle)}, at + 1); }
  return total;
`;

/* ------------------------------------------------------------------ composer */

/** Every button-ish node with its accessible name, for reading a screen. */
const LIST_CONTROLS = `
  return Array.from(document.querySelectorAll(
    'button, [role="button"], a, [role="link"], [role="radio"], [role="menuitem"]'
  )).map((el) => ({
    label: (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 80),
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    testid: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || '',
  })).filter((c) => c.label || c.testid);
`;

/**
 * Click a control by its accessible name, retrying while the screen settles.
 *
 * The name is interpolated into the page body, so it must be referenced there as
 * `needle` — a bare `label` is a free variable in the page's scope, where it
 * resolves to `undefined` and the click silently matches nothing.
 */
async function tap(page, label, { timeoutMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    const outcome = await page.eval(`
      const needle = ${JSON.stringify(label)};
      const nodes = Array.from(document.querySelectorAll(
        'button, [role="button"], [role="link"], [role="radio"], [role="menuitem"]'
      ));
      const nameOf = (node) => (node.getAttribute('aria-label') || node.innerText || '').trim();
      const hit = nodes.find((node) => {
        const name = nameOf(node);
        return name === needle || name.includes(needle);
      });
      if (!hit) {
        return { ok: false, names: nodes.map(nameOf).filter(Boolean).slice(0, 60) };
      }
      if (hit.disabled === true || hit.getAttribute('aria-disabled') === 'true') {
        return { ok: false, disabled: true, name: needle };
      }
      hit.click();
      return { ok: true, name: needle };
    `);
    if (outcome.ok) return outcome;
    last = outcome.disabled ? `disabled: ${outcome.name}` : outcome.names;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`could not tap "${label}": ${JSON.stringify(last).slice(0, 400)}`);
}

/** Type into a text field, by its placeholder or accessible name. */
async function typeInto(page, selector, value) {
  const done = await page.eval(`
    ${FILL}
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, inputs: Array.from(document.querySelectorAll('input, textarea'))
      .map((i) => (i.getAttribute('placeholder') || i.getAttribute('aria-label') || i.type || '?')) };
    setNative(el, ${JSON.stringify(value)});
    return { ok: true };
  `);
  if (!done.ok) throw new Error(`field ${selector} missing: ${JSON.stringify(done.inputs)}`);
  return done;
}

/**
 * Fill a field by the label a person reads on screen.
 *
 * React Native Web renders `TextInput` as a real `<input>`/`<textarea>` carrying
 * the label on `aria-label` or `placeholder`, so the field is located by that
 * text — the same thing a person reads — rather than by a test id the component
 * never promised to keep.
 *
 * **The field is waited for before it is filled.** The composer renders its
 * sections in stages, so immediately after the page loads there can be a real
 * moment with no text field in the DOM at all; filling "whatever is there" then
 * is a silent no-op that only surfaces much later as a post with no caption.
 */
async function fillByLabel(page, pattern, value) {
  await page.waitFor(
    `Array.from(document.querySelectorAll('input, textarea')).some((el) => ${pattern}.test(
      (el.getAttribute('placeholder') || '') + ' ' +
      (el.getAttribute('aria-label') || '') + ' ' + (el.name || '')))`,
    { label: `a field matching ${pattern}`, timeoutMs: 30_000 },
  );

  const done = await page.eval(`
    ${FILL}
    const pattern = ${pattern};
    const fields = Array.from(document.querySelectorAll('input, textarea'));
    const match = fields.find((el) => pattern.test(
      (el.getAttribute('placeholder') || '') + ' ' +
      (el.getAttribute('aria-label') || '') + ' ' + (el.name || '')));
    if (!match) {
      return { ok: false, fields: fields.map((el) =>
        el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.type) };
    }
    setNative(match, ${JSON.stringify(value)});
    return { ok: true, tag: match.tagName };
  `);
  if (!done.ok) throw new Error(`no field matching ${pattern}: ${JSON.stringify(done.fields)}`);

  // React re-renders on the input event; wait for the value to actually be in the
  // DOM so the next step cannot run against a field the app has not yet accepted.
  const landed = await page.eval(`
    const pattern = ${pattern};
    const match = Array.from(document.querySelectorAll('input, textarea')).find((el) => pattern.test(
      (el.getAttribute('placeholder') || '') + ' ' +
      (el.getAttribute('aria-label') || '') + ' ' + (el.name || '')));
    return match ? match.value : null;
  `);
  if (landed !== value) {
    throw new Error(`the field did not accept the text (read back ${JSON.stringify(landed)})`);
  }
  return done;
}

/**
 * Publish one post through the composer, as a person would.
 *
 * Opens the composer, types whatever fields that post type asks for, attaches the
 * file through the real file input the web picker creates, and taps Publish.
 * Returns the network calls the composer made, so the caller can assert on the
 * server's actual status codes rather than on what the UI claimed.
 *
 * **Publish is not tapped while it is disabled.** A disabled Publish means the
 * draft is missing something the composer requires, and clicking anyway would
 * report a publish failure instead of the real cause.
 */
async function publishPost(page, { type, caption, files = [] }) {
  markNetwork(page);
  await page.goto(`${WEB}/add-post${type ? `?type=${type}` : ''}`, { timeoutMs: 90_000 });

  if (caption) {
    // The composer's caption field is labelled "Post caption" (`ComposerFields.tsx`).
    await fillByLabel(page, '/post caption|caption/i', caption);
  }

  // A project post asks for its own title and description on top of the caption
  // (`add-post.tsx`), and the server requires both. The description field is
  // labelled "What did you build?", not "Description".
  if (type === 'project') {
    await fillByLabel(page, '/project title/i', `Verification project ${caption.slice(-6)}`);
    await fillByLabel(page, '/what did you build|project description/i', 'Built to verify that a project post reaches another member.');
  }

  for (const file of files) {
    // Open the picker, exactly as the composer's own add-tile does. The tile's
    // accessible name states what it will do ("Add images from your gallery"),
    // so it is matched by that intent rather than by a guessed wording.
    await tap(page, 'Add image', { timeoutMs: 20_000 });
    await attachFiles(page, [file]);
    // The picker resolves the file asynchronously; wait for the composer to show
    // it, so the publish press is never made against an empty draft.
    await page.waitFor(
      `document.body.innerText.includes(${JSON.stringify(file.split('/').pop())})`,
      { label: `the composer to accept ${file.split('/').pop()}`, timeoutMs: 30_000 },
    );
  }

  // The composer only enables Publish once the draft is publishable, so waiting
  // for it to enable is how the harness knows the draft is complete.
  await page.waitFor(`
    Array.from(document.querySelectorAll('button, [role="button"]'))
      .some((b) => /^publish$/i.test((b.innerText || '').trim())
        && b.disabled !== true && b.getAttribute('aria-disabled') !== 'true')
  `, { label: 'Publish to become enabled', timeoutMs: 30_000 });

  await tap(page, 'Publish', { timeoutMs: 20_000 });

  // The composer only closes on a 201, so arriving back at Home is itself the
  // proof that the server accepted the post.
  await page.waitFor(`location.pathname === '/home'`, {
    label: 'the composer to close after a 201',
    timeoutMs: 60_000,
  });

  const audit = auditNetwork(page);
  const created = page.network.filter(
    (n) => n.type === 'response' && n.method === undefined && /\/posts$/.test(n.url) && n.status === 201,
  );
  return { audit, created: created.length > 0 };
}

/** Publish one story through `/add-story`. */
async function publishStory(page, { caption, file }) {
  markNetwork(page);
  await page.goto(`${WEB}/add-story`, { timeoutMs: 90_000 });

  if (caption) {
    // The story composer's caption field is labelled "Story caption"
    // (`add-story.tsx`).
    await fillByLabel(page, '/story caption|caption/i', caption);
  }
  // The story composer's photo tile is labelled "Attach a photo".
  await tap(page, 'Attach a photo', { timeoutMs: 20_000 });
  await attachFiles(page, [file]);
  await page.waitFor(
    `document.body.innerText.includes(${JSON.stringify(file.split('/').pop())})`,
    { label: 'the story composer to accept the file', timeoutMs: 30_000 },
  );

  await tap(page, 'Publish', { timeoutMs: 20_000 });
  await page.waitFor(`location.pathname === '/home'`, {
    label: 'the story composer to close after a 201',
    timeoutMs: 60_000,
  });

  const audit = auditNetwork(page);
  const created = page.network.some(
    (n) => n.type === 'response' && /\/stories$/.test(n.url) && n.status === 201,
  );
  return { audit, created };
}

/**
 * Sign out through the app's own UI.
 *
 * The token is cleared by the app, not by this function writing to storage:
 * a test that cleared `sessionStorage` itself would not prove the app can end a
 * session, and would leave any server-side revocation untested.
 */
async function signOut(page) {
  await page.goto(`${WEB}/profile`, { timeoutMs: 60_000 });
  await page.waitFor(`document.body.innerText.length > 0`, {
    label: 'the profile screen',
    timeoutMs: 60_000,
  });

  const clicked = await page.eval(`
    const button = Array.from(document.querySelectorAll('button, [role="button"]'))
      .find((b) => /sign out|log out/i.test(b.innerText || b.getAttribute('aria-label') || ''));
    if (!button) {
      return { found: false, names: Array.from(document.querySelectorAll('button, [role="button"]'))
        .map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 25) };
    }
    button.click();
    return { found: true };
  `);
  if (!clicked.found) {
    throw new Error(`no sign-out control on Profile: ${JSON.stringify(clicked.names)}`);
  }

  await page.waitFor(`location.pathname === '/login'`, {
    label: 'the login screen after signing out',
    timeoutMs: 60_000,
  });

  // The token must actually be gone, or "signed out" is only a route change.
  const cleared = await page.eval(`
    return !window.sessionStorage.getItem('mahajob.access_token');
  `);
  if (!cleared) throw new Error('the access token is still in sessionStorage after signing out');
  return true;
}

/**
 * Wait for text to appear in a page that is deliberately not being refreshed.
 *
 * **The no-refresh rule is enforced by the caller, not here.** This function only
 * polls the DOM; what makes it a realtime check is that nothing in this file
 * reloads, re-navigates or re-authenticates `pageB` between User A's publish and
 * this returning. A `goto` or `reload` anywhere in between would invalidate the
 * result, so none exists.
 */
async function expectAppears(page, needle, { timeoutMs = 45_000, label } = {}) {
  try {
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(needle)})`, {
      label: label ?? `"${needle}" to appear`,
      timeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ run phase */

/**
 * Every in-page snippet is compiled before the run starts.
 *
 * These bodies are interpolated into `Runtime.evaluate`, so a bad escape is not a
 * syntax error in this file — it is one that surfaces minutes later, inside a
 * browser, as `SyntaxError: Invalid or unexpected token`, with no clue which of a
 * dozen snippets was at fault. Compiling each one up front turns that into an
 * immediate failure that names the snippet.
 */
for (const [name, body] of Object.entries({ FILL, SNAPSHOT, NOTICES, LIST_CONTROLS, countText })) {
  try {
    new Function(`return (async () => { ${body} })()`);
  } catch (error) {
    process.stdout.write(`in-page snippet "${name}" will not parse: ${error.message}\n`);
    process.exit(2);
  }
}

/** A unique, greppable marker so a check can find its own content in the DOM. */
const marker = (kind) => `UIVERIFY-${kind}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const A = await createUser('a');
const B = await createUser('b');
step(`created two accounts: ${A.email} / ${B.email}`);

// Handed to `inspect-feed.mjs`, so a failing check can be investigated in a real
// session afterwards without inventing another account.
writeFileSync(
  new URL('./.e2e-accounts.json', import.meta.url),
  JSON.stringify({ a: { email: A.email, password: A.password }, b: { email: B.email, password: B.password } }),
);

const cdp = await connect();
let exitCode = 0;

try {
  step('opening two isolated browser contexts');
  const pageA = await openPage(cdp, WEB);
  const pageB = await openPage(cdp, WEB);

  /* ---------------------------------------------------------- 5/6: both homes */

  step('signing User A in');
  await signIn(pageA, A);
  await pageA.waitFor(`document.body.innerText.includes('Stories')`, {
    label: "User A's home content",
    timeoutMs: 60_000,
  });

  step('signing User B in');
  await signIn(pageB, B);
  await pageB.waitFor(`document.body.innerText.includes('Stories')`, {
    label: "User B's home content",
    timeoutMs: 60_000,
  });

  // The two contexts must not share a session. If they did, every realtime check
  // below would be testing one user against themselves.
  //
  // **The whole token is compared, not a prefix.** A JWT's header segment is the
  // same literal base64 for every token the server ever issues
  // (`eyJhbGciOi...`), so a 16-character prefix is identical for A and B and the
  // check would pass for two users or fail for one, either way wrongly.
  const tokenA = await pageA.eval(
    `return window.sessionStorage.getItem('mahajob.access_token') || '';`,
  );
  const tokenB = await pageB.eval(
    `return window.sessionStorage.getItem('mahajob.access_token') || '';`,
  );
  record(
    'User B is an independent session',
    tokenA.length > 0 && tokenB.length > 0 && tokenA !== tokenB,
    'the two contexts hold different access tokens',
  );

  const homeA = await pageA.eval(SNAPSHOT);
  record('User A home loads', homeA.path === '/home' && homeA.text.length > 0, `${homeA.text.length} chars`);
  const homeB = await pageB.eval(SNAPSHOT);
  record('User B home loads', homeB.path === '/home', homeB.path);

  /* ------------------------------------------- 5/23: home structure & entries */

  // The feed section is deliberately **headingless** — `home.tsx` puts the feed
  // "directly under the Stories row and no heading, intro copy, or composer card
  // in between" — so it is located by its `community-feed` test id rather than by
  // text. Asserting on a heading that was deliberately omitted would be the test
  // disagreeing with the design, not the app being wrong.
  const structure = await pageA.eval(`
    const text = document.body.innerText;
    const feed = document.querySelector('[data-testid="community-feed"]')
      || Array.from(document.querySelectorAll('div')).find((d) =>
        d.getAttribute('data-testid') === 'community-feed');
    const rect = (el) => el ? el.getBoundingClientRect() : null;
    const composer = document.querySelector('[data-testid="home-composer-card"]');
    const stories = document.querySelector('[data-testid="opportunity-stories"]');
    return {
      hasStoriesSection: Boolean(stories),
      hasComposer: Boolean(composer),
      hasFeed: Boolean(feed),
      hasYourStory: /your story/i.test(text),
      // Stories, then the composer, then the feed, top to bottom.
      order: Boolean(stories && composer && feed)
        && rect(stories).top <= rect(composer).top
        && rect(composer).top <= rect(feed).top,
      positions: [rect(stories)?.top, rect(composer)?.top, rect(feed)?.top]
        .map((v) => (v === undefined ? null : Math.round(v))),
    };
  `);
  record('Home shows the Stories section', structure.hasStoriesSection);
  record('Home shows the create composer card', structure.hasComposer);
  record('Home shows the Community Feed', structure.hasFeed);
  record('Stories, then composer, then feed', structure.order, `top offsets ${JSON.stringify(structure.positions)}`);
  record('Story tray has a "Your Story" entry', structure.hasYourStory);

  // The section headings are not the words this file guessed, so read what the
  // page actually calls its sections rather than asserting against a guess.
  const headings = await pageA.eval(`
    return Array.from(document.querySelectorAll('[role="header"], h1, h2, h3'))
      .map((h) => (h.innerText || '').trim())
      .filter((t) => t && t.length < 60);
  `);
  process.stdout.write(`\nsection headings on Home: ${JSON.stringify(headings)}\n`);

  const tokenProbe = await pageA.eval(`
    return {
      keys: Object.keys(window.sessionStorage),
      len: (window.sessionStorage.getItem('mahajob.access_token') || '').length,
    };
  `);
  process.stdout.write(`session storage in User A: ${JSON.stringify(tokenProbe)}\n`);

  process.stdout.write(`\n${results.filter((r) => r.ok).length}/${results.length} checks so far\n`);

  /* ------------------------------------------- 19: every Home creation entry */

  // Each chip must open the composer for the type that was tapped. The bug this
  // guards is specific: "Project" used to open a blank *text* draft, so the
  // check is on the resulting query parameter, not merely on landing somewhere.
  const chipTargets = {};
  // The chip's test id is the **composer's own value**, not the label shown on
  // screen: the type is `image` and the label is "Images". Mapping through the
  // label alone would miss the chip entirely, which is how this first failed.
  const CHIPS = [
    { label: 'Images', value: 'image' },
    { label: 'Video', value: 'video' },
    { label: 'Project', value: 'project' },
    { label: 'Achievement', value: 'achievement' },
  ];
  for (const { label, value } of CHIPS) {
    // **Go back rather than re-navigate to Home.** The chip test lives on Home and
    // the previous iteration left the page on `/add-post`; a full load of Home per
    // chip re-runs the whole React tree four times for no added assurance, and it
    // is the single largest cost in this run.
    await pageA.goto(`${WEB}/home`, { timeoutMs: 60_000 });
    await pageA.waitFor(`!!document.querySelector('[data-testid^="home-composer-type-"]')`, {
      label: 'the Home composer chips',
      timeoutMs: 30_000,
    });
    const clicked = await pageA.eval(`
      const chip = document.querySelector('[data-testid="home-composer-type-${value}"]');
      if (!chip) {
        return { found: false, available: Array.from(
          document.querySelectorAll('[data-testid^="home-composer-type-"]'))
          .map((el) => el.getAttribute('data-testid')) };
      }
      if (chip.disabled === true) return { found: true, disabled: true };
      chip.click();
      return { found: true };
    `);
    if (!clicked.found) {
      chipTargets[label] = `chip missing (available: ${JSON.stringify(clicked.available)})`;
      continue;
    }
    if (clicked.disabled) {
      chipTargets[label] = 'disabled';
      continue;
    }
    await pageA.waitFor(`location.pathname.startsWith('/add-post')`, {
      label: `the ${label} composer`,
      timeoutMs: 30_000,
    });
    chipTargets[label] = await pageA.eval('return location.pathname + location.search;');
  }
  process.stdout.write(`composer chip targets: ${JSON.stringify(chipTargets)}\n`);
  record(
    'every Home type chip opens /add-post',
    CHIPS.every(({ label }) => String(chipTargets[label] ?? '').startsWith('/add-post')),
    JSON.stringify(chipTargets),
  );
  record(
    'the Project chip opens a Project draft, not a blank text one',
    String(chipTargets.Project ?? '').includes('type=project'),
    chipTargets.Project ?? 'not opened',
  );
  record(
    'the Video chip opens a Video draft',
    String(chipTargets.Video ?? '').includes('type=video'),
    chipTargets.Video ?? 'not opened',
  );
  record(
    'the Images chip opens an Images draft',
    String(chipTargets.Images ?? '').includes('type=image'),
    chipTargets.Images ?? 'not opened',
  );

  // "Story" is a different record, so it has its own screen.
  await pageA.goto(`${WEB}/home`, { timeoutMs: 60_000 });
  await pageA.waitFor(`!!document.querySelector('[data-testid="your-story-button"], [aria-label*="Your story" i]')`, {
    label: 'the Your Story entry',
    timeoutMs: 30_000,
  });
  const storyEntry = await pageA.eval(`
    const entry = document.querySelector('[data-testid="your-story-button"]')
      || Array.from(document.querySelectorAll('button, [role="button"]'))
        .find((b) => /your story/i.test(b.getAttribute('aria-label') || ''));
    if (!entry) return { found: false };
    entry.click();
    return { found: true, label: entry.getAttribute('aria-label') };
  `);
  let storyPath = 'not clicked';
  if (storyEntry.found) {
    await pageA.waitFor(`location.pathname === '/add-story'`, {
      label: '/add-story',
      timeoutMs: 30_000,
    }).catch(() => {});
    storyPath = await pageA.eval('return location.pathname;');
  }
  record('the Your Story entry opens /add-story', storyPath === '/add-story', storyEntry.label ?? 'no entry found');

  // A control that renders with neither a label nor text cannot be operated by a
  // screen-reader user either, so an unlabelled one is a dead button.
  const deadButtons = await pageA.eval(`
    return Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((b) => {
        const rect = b.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return (b.getAttribute('aria-label') || b.innerText || '').trim().length === 0;
      }).length;
  `);
  record('Home has no unlabelled (dead) buttons', deadButtons === 0, `${deadButtons} unlabelled`);
  await pageA.goto(`${WEB}/home`, { timeoutMs: 60_000 });

  /* --------------------------------------------- 5/21: sockets and URL hygiene */

  record('User A holds a WebSocket', auditNetwork(pageA).sockets > 0, `${auditNetwork(pageA).sockets} socket(s)`);
  record('User B holds a WebSocket', auditNetwork(pageB).sockets > 0, `${auditNetwork(pageB).sockets} socket(s)`);

  const doubled = [...auditNetwork(pageA).doubled, ...auditNetwork(pageB).doubled];
  record('no doubled /api/v1/api/v1/ URLs', doubled.length === 0, doubled.slice(0, 3).join(', '));

  const mediaFailures = [...auditNetwork(pageA).bad, ...auditNetwork(pageB).bad]
    .filter((b) => /\/media\//.test(b));
  record('no failed media requests on a fresh Home', mediaFailures.length === 0, mediaFailures.slice(0, 3).join(' | '));

  /* ====================================================================== *
   * 7-14: publish as User A, watch User B's Home without any refresh.      *
   * ====================================================================== *
   *
   * **From here to the reconnect test, `pageB` is never navigated.** No
   * `goto`, no `reload`, no re-login, no route-changing click. The only thing
   * that may touch it is `expectAppears`, which reads the DOM. If content
   * appears, it can only have arrived over the WebSocket and been rendered by
   * React Query's revalidation — which is the whole claim under test.
   */
  const bStartUrl = await pageB.eval('return location.href;');

  /* ---------------------------------------------------------- 7: image post */
  step('7: User A publishes an image post');
  const imageCaption = marker('IMG');
  const imagePost = await publishPost(pageA, {
    type: 'image',
    caption: imageCaption,
    files: [`${MEDIA}/photo.png`],
  });
  record('image post: the upload and the create both succeeded', imagePost.audit.bad.length === 0, imagePost.audit.bad.slice(0, 2).join(' | '));
  record('image post: POST /posts returned 201', imagePost.created);
  record(
    'image post: User A sees it immediately',
    await expectAppears(pageA, imageCaption, { timeoutMs: 20_000, label: 'the image post in User A Home' }),
  );

  const bSawImage = await expectAppears(pageB, imageCaption, {
    timeoutMs: 45_000,
    label: "User A's image post in User B Home",
  });
  const bUrlNow = await pageB.eval('return location.href;');
  record('A -> B image post: appears in User B Home with no refresh', bSawImage);
  record('User B never navigated during the realtime test', bUrlNow === bStartUrl, bUrlNow);

  // The card must be complete, not merely present: one copy, a loaded image, and
  // the right author.
  //
  // **The card is located from the feed, not from any ancestor.** Walking up from
  // a matching `<div>` lands on the whole page, whose first lines are the header
  // — so the "author" read that way is the app's search bar, and the author check
  // would be measuring the wrong element. The feed post is the element carrying a
  // `feed-post-` test id, and the caption must be inside that.
  const imageCard = await pageB.eval(`
    const caption = ${JSON.stringify(imageCaption)};
    const text = document.body.innerText;
    const count = text.split(caption).length - 1;

    const posts = Array.from(document.querySelectorAll('[data-testid^="feed-post"]'))
      .filter((el) => (el.innerText || '').includes(caption));
    const post = posts[0] || null;

    // Some cards put the body in a sibling rather than a descendant, so fall back
    // to the nearest ancestor that also holds the caption.
    const container = post || (() => {
      const leaf = Array.from(document.querySelectorAll('*'))
        .filter((el) => (el.innerText || '') === caption
          || (el.innerText || '').trim() === caption)
        .pop();
      return leaf ? leaf.closest('[data-testid]') || leaf.parentElement : null;
    })();

    const scope = post || container || document.body;

    /*
     * Media is looked for in three ways, because the app can render it three ways
     * and a check that only knows one of them reports a false failure:
     *
     *   1. an img element, for a plain image;
     *   2. a computed background-image, which is how expo-image paints on web;
     *   3. a video element, for a video post.
     *
     * Also inspected is the media request the page actually made, which is the
     * part that proves authorisation: a blob: or data: URI would mean the bytes
     * never came from the API at all.
     */
    const imgs = Array.from(scope.querySelectorAll('img')).map((img) => ({
      how: 'img',
      ok: img.complete && img.naturalWidth > 0,
      src: (img.currentSrc || img.src || '').slice(-45),
    }));
    const backgrounds = Array.from(scope.querySelectorAll('*'))
      .filter((el) => {
        const bg = getComputedStyle(el).backgroundImage;
        return bg && bg !== 'none' && bg.includes('url(');
      })
      .map((el) => ({
        how: 'background',
        ok: true,
        src: getComputedStyle(el).backgroundImage.slice(-45),
      }));
    const vids = Array.from(scope.querySelectorAll('video')).map((v) => ({
      how: 'video',
      ok: v.readyState >= 1 || v.videoWidth > 0,
      src: (v.currentSrc || v.src || '').slice(-45),
    }));

    // Any background-image anywhere on the page, for diagnosis when the card
    // scope turns out to be too narrow.
    const pageBackgrounds = Array.from(document.querySelectorAll('*'))
      .filter((el) => {
        const bg = getComputedStyle(el).backgroundImage;
        return bg && bg !== 'none' && bg.includes('url(');
      })
      .map((el) => getComputedStyle(el).backgroundImage.slice(-45));

    return {
      count,
      found: Boolean(post),
      scopeTestId: scope.getAttribute ? scope.getAttribute('data-testid') : null,
      media: [...imgs, ...backgrounds, ...vids],
      pageBackgroundCount: pageBackgrounds.length,
      pageBackgroundSample: pageBackgrounds.slice(0, 2),
      text: (scope.innerText || '').slice(0, 160),
      author: (scope.innerText || '').split(String.fromCharCode(10))
        .filter(Boolean).slice(0, 3).join(' | '),
    };
  `);
  record('image post: exactly one copy in User B Home', imageCard.count === 1, `${imageCard.count} copies`);
  record(
    'image post: the post card itself was found',
    imageCard.found,
    `scope ${imageCard.scopeTestId ?? 'none'}`,
  );
  record(
    'image post: media renders for User B',
    imageCard.media.length > 0 && imageCard.media.every((m) => m.ok),
    imageCard.media.length
      ? JSON.stringify(imageCard.media)
      : `no media node; page has ${imageCard.pageBackgroundCount} background-image node(s) ${JSON.stringify(imageCard.pageBackgroundSample)}`,
  );
  record(
    'image post: attributed to User A',
    /UI A|UI a|ui a/i.test(imageCard.author),
    imageCard.author.slice(0, 80),
  );

  process.stdout.write(`\n${results.filter((r) => r.ok).length}/${results.length} checks so far\n`);

  /* ---------------------------------------------------------- 9: text post */
  step('9: User A publishes a text post');
  const textCaption = marker('TXT');
  const textPost = await publishPost(pageA, { type: 'text', caption: textCaption });
  record('text post: POST /posts returned 201', textPost.created);
  record(
    'A -> B text post: appears in User B Home with no refresh',
    await expectAppears(pageB, textCaption, { timeoutMs: 45_000, label: "User A's text post in User B Home" }),
  );
  const textCount = await pageB.eval(countText(textCaption));
  record('text post: exactly one copy in User B Home', textCount === 1, `${textCount} copies`);

  /* -------------------------------------------------------- 10: project post */
  step('10: User A publishes a project post');
  const projectCaption = marker('PRJ');
  const projectPost = await publishPost(pageA, { type: 'project', caption: projectCaption });
  record('project post: POST /posts returned 201', projectPost.created);
  record(
    'A -> B project post: appears in User B Home with no refresh',
    await expectAppears(pageB, projectCaption, { timeoutMs: 45_000, label: "User A's project post in User B Home" }),
  );

  /* ---------------------------------------------------------- 8: video post */
  step('8: User A publishes a video post');
  const videoCaption = marker('VID');
  const videoPost = await publishPost(pageA, {
    type: 'video',
    caption: videoCaption,
    files: [`${MEDIA}/clip.mp4`],
  });
  record('video post: upload and create both succeeded', videoPost.audit.bad.length === 0, videoPost.audit.bad.slice(0, 2).join(' | '));
  record('video post: POST /posts returned 201', videoPost.created);
  record(
    'A -> B video post: appears in User B Home with no refresh',
    await expectAppears(pageB, videoCaption, { timeoutMs: 45_000, label: "User A's video post in User B Home" }),
  );

  /* ------------------------------------------------------- 11/12: a story */
  step('11/12: User A publishes a story');
  const storyCaption = marker('STY');
  const story = await publishStory(pageA, { caption: storyCaption, file: `${MEDIA}/second.png` });
  record('story: POST /stories returned 201', story.created);
  record(
    'A -> B story: appears in User B story tray with no refresh',
    await expectAppears(pageB, storyCaption, { timeoutMs: 45_000, label: "User A's story in User B's tray" }),
  );

  // The socket must actually have carried the invalidations.
  const eventsB = receivedEvents(pageB);
  process.stdout.write(`User B received socket events: ${JSON.stringify([...new Set(eventsB)])}\n`);
  record(
    'User B received post.created over the WebSocket',
    eventsB.includes('post.created'),
    `${eventsB.filter((e) => e === 'post.created').length} frame(s)`,
  );
  record(
    'User B received story.created over the WebSocket',
    eventsB.includes('story.created'),
    `${eventsB.filter((e) => e === 'story.created').length} frame(s)`,
  );

  /* -------------------------------------------- 8: video behaviour in the feed */

  const videoState = await pageB.eval(`
    const caption = ${JSON.stringify(videoCaption)};
    const post = Array.from(document.querySelectorAll('[data-testid^="feed-post-"]'))
      .find((p) => (p.innerText || '').includes(caption));
    const video = post ? post.querySelector('video') : null;
    return {
      found: Boolean(post),
      hasVideo: Boolean(video),
      // The API serves bytes only to authorised readers, so a blob: source is
      // proof the fetch was authorised; an api/media URL would be proof it was not
      // served at all.
      src: video ? (video.currentSrc || video.src || '').slice(0, 40) : '',
      readyState: video ? video.readyState : -1,
      videoWidth: video ? video.videoWidth : 0,
      duration: video && Number.isFinite(video.duration) ? Number(video.duration.toFixed(1)) : null,
      muted: video ? video.muted : null,
      paused: video ? video.paused : null,
      error: video && video.error ? video.error.code : null,
    };
  `);
  record('video post: a video element renders in User B Home', videoState.hasVideo, `readyState=${videoState.readyState}`);
  record(
    'video post: the bytes were fetched and decoded',
    videoState.videoWidth > 0 && videoState.readyState >= 1,
    `${videoState.videoWidth}px wide, duration ${videoState.duration}s, src ${videoState.src}`,
  );
  record(
    'video post: no playback error',
    videoState.error === null,
    `error code ${videoState.error}`,
  );
  record('video post: playback starts muted', videoState.muted === true, `muted=${videoState.muted}`);

  const playingNow = await pageB.eval(`
    return Array.from(document.querySelectorAll('video'))
      .filter((v) => !v.paused && v.readyState >= 2).length;
  `);
  record('at most one video plays at a time', playingNow <= 1, `${playingNow} playing`);

  // Autoplay is a browser policy as much as an app behaviour, so a refusal is
  // recorded as such rather than as a defect.
  const autoplayBlocked = await pageB.eval(`
    return Array.from(document.querySelectorAll('video')).every((v) => v.paused);
  `);
  record(
    'video autoplay: the browser is not blocking playback',
    autoplayBlocked === false || videoState.paused === false,
    autoplayBlocked
      ? 'every video is paused; this may be browser autoplay policy, not an app fault'
      : 'at least one video is playing',
  );

  // Scrolling the video out of view must pause it.
  const afterScroll = await pageB.eval(`
    const scroller = Array.from(document.querySelectorAll('div'))
      .find((d) => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 200);
    if (!scroller) return { scrolled: false, playing: null };
    scroller.scrollTop = scroller.scrollHeight;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1500));
    return {
      scrolled: true,
      top: scroller.scrollTop,
      playing: Array.from(document.querySelectorAll('video'))
        .filter((v) => !v.paused && v.readyState >= 2).length,
    };
  `);
  record(
    'scrolling away pauses the video',
    afterScroll.playing === 0,
    `${afterScroll.playing} still playing after scrolling to ${afterScroll.top}`,
  );
  await pageB.eval(`
    const scroller = Array.from(document.querySelectorAll('div'))
      .find((d) => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 200);
    if (scroller) {
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    return true;
  `);

  /* =================== 13/14: does PostgreSQL, not the socket, hold it? ====== */
  step('13/14: User B signs out and back in');

  // Signing out and back in destroys every trace of the live session, so
  // anything still on screen afterwards came from GET /posts and GET /stories.
  await signOut(pageB);
  await signIn(pageB, B);
  await pageB.waitFor(`document.body.innerText.includes('Stories')`, {
    label: "User B's Home after signing back in",
    timeoutMs: 60_000,
  });

  const afterRelogin = await pageB.eval(`
    const text = document.body.innerText;
    return {
      image: text.includes(${JSON.stringify(imageCaption)}),
      text: text.includes(${JSON.stringify(textCaption)}),
      project: text.includes(${JSON.stringify(projectCaption)}),
      video: text.includes(${JSON.stringify(videoCaption)}),
      story: text.includes(${JSON.stringify(storyCaption)}),
      imageCopies: text.split(${JSON.stringify(imageCaption)}).length - 1,
    };
  `);
  record('after re-login: the image post is still there', afterRelogin.image, `${afterRelogin.imageCopies} copy/copies`);
  record('after re-login: the text post is still there', afterRelogin.text);
  record('after re-login: the project post is still there', afterRelogin.project);
  record('after re-login: the video post is still there', afterRelogin.video);
  record('after re-login: the story is still there', afterRelogin.story);
  record('after re-login: no duplicates appeared', afterRelogin.imageCopies === 1, `${afterRelogin.imageCopies} copies`);

  /* --------------------------------- 15: an event missed while offline recovers */

  step('15: User B loses the socket while User A publishes');
  // The WebSocket is blocked at the network layer, so the event that follows
  // genuinely cannot arrive. Nothing else is touched: the page stays on Home,
  // the session stays valid, and no REST request is forced.
  await cdp.send(
    'Network.setBlockedURLs',
    { urls: ['*ws://*', '*wss://*'] },
    pageB.sessionId,
  );
  await pageB.eval(`
    const scroller = Array.from(document.querySelectorAll('div'))
      .find((d) => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 200);
    if (scroller) { scroller.scrollTop = 0; scroller.dispatchEvent(new Event('scroll', { bubbles: true })); }
    return true;
  `);

  const missedCaption = marker('MISS');
  step('15: User A publishes a post User B cannot hear');
  await publishPost(pageA, { type: 'text', caption: missedCaption });

  const whileOffline = await pageB.eval(`
    return document.body.innerText.includes(${JSON.stringify(missedCaption)});
  `);
  process.stdout.write(`  (User B saw the missed post while the socket was blocked: ${whileOffline})\n`);

  // Reconnect: unblock the socket, then trigger the same refetch-on-return a real
  // reconnect performs. A window focus is an event the app already handles, so no
  // application code is bypassed.
  await cdp.send('Network.setBlockedURLs', { urls: [] }, pageB.sessionId);
  await pageB.eval(`
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  `);
  const recovered = await expectAppears(pageB, missedCaption, {
    timeoutMs: 60_000,
    label: 'the missed post to arrive after reconnection',
  });
  record('reconnect recovery: the missed post appears', recovered);
  record(
    'reconnect recovery: the missed post is not duplicated',
    (await pageB.eval(countText(missedCaption))) === 1,
  );

  /* ------------------------------------------ 18: rapid double-tap publishes */

  step('18: User A double-taps Publish');
  const doubleCaption = marker('TAP');
  markNetwork(pageA);
  await pageA.goto(`${WEB}/add-post?type=text`, { timeoutMs: 90_000 });
  await fillByLabel(pageA, '/post caption|caption/i', doubleCaption);
  await pageA.waitFor(`
    Array.from(document.querySelectorAll('button, [role="button"]'))
      .some((b) => /^publish$/i.test((b.innerText || '').trim()) && b.disabled !== true)
  `, { label: 'Publish to become enabled', timeoutMs: 30_000 });

  // Both presses are dispatched in the same task, which is the closest a test can
  // get to a double tap and is strictly harder to survive than two slow clicks.
  const doubleTapped = await pageA.eval(`
    const publish = Array.from(document.querySelectorAll('button, [role="button"]'))
      .find((b) => /^publish$/i.test((b.innerText || '').trim()));
    if (!publish) return { pressed: 0 };
    publish.click();
    publish.click();
    publish.click();
    return { pressed: 3 };
  `);
  process.stdout.write(`  (pressed Publish ${doubleTapped.pressed} times in one task)\n`);

  await pageA.waitFor(`location.pathname === '/home'`, {
    label: 'the composer to close after the double tap',
    timeoutMs: 60_000,
  });
  const doubleCopies = await pageA.eval(countText(doubleCaption));
  record('rapid taps: exactly one post is created', doubleCopies === 1, `${doubleCopies} copies in User A Home`);

  const postsCreated = pageA.network.filter(
    (n) => n.type === 'response' && /\/posts$/.test(n.url) && n.status === 201,
  ).length;
  record('rapid taps: the server received exactly one create', postsCreated === 1, `${postsCreated} POST /posts 201(s)`);

  /* ------------------------------------------------ 20: an invalid upload */

  step('20: User A tries to upload a file that is not an image');
  markNetwork(pageA);
  await pageA.goto(`${WEB}/add-post?type=image`, { timeoutMs: 90_000 });
  const badCaption = marker('BAD');
  await fillByLabel(pageA, '/post caption|caption/i', badCaption);
  await tap(pageA, 'Add image', { timeoutMs: 20_000 });
  await attachFiles(pageA, [`${MEDIA}/not-really.jpg`]);

  // The app must explain the problem in its own words, and must let the person
  // carry on. A generic apology, or a form that cleared itself, would both fail.
  const badOutcome = await pageA.eval(`
    const text = document.body.innerText;
    const fields = Array.from(document.querySelectorAll('input, textarea'))
      .map((el) => (el.value || '').slice(0, 40));
    return {
      stillInComposer: location.pathname.startsWith('/add-post'),
      draftKept: fields.some((v) => v.includes(${JSON.stringify(badCaption)})),
      // The server's own reason, or at least a specific one.
      specific: /image|photo|file|type|format|supported|jpeg|png|webp|not a|unsupported/i.test(text),
      generic: /something went wrong/i.test(text),
      notices: Array.from(document.querySelectorAll('div, span, p'))
        .map((el) => (el.innerText || '').trim())
        .filter((t) => t && t.length < 300
          && /did not|not upload|could not|unsupported|not a valid|too large|try again|skipped/i.test(t))
        .slice(0, 4),
    };
  `);
  record('invalid upload: the composer stays open', badOutcome.stillInComposer, badOutcome.notices.join(' | ').slice(0, 160));
  record('invalid upload: the draft is not lost', badOutcome.draftKept);
  record('invalid upload: the message is specific, not a generic apology', badOutcome.specific && !badOutcome.generic, badOutcome.notices.join(' | ').slice(0, 160));

  /* --------------------------------------- 17: media authorisation, unchanged */

  // Read as User A (the owner), as User B (another member), and anonymously.
  const ownedMedia = await pageA.network.filter(
    (n) => n.type === 'request' && /\/media\//.test(n.url),
  );
  const ownedPath = ownedMedia[0]?.url ?? null;
  if (ownedPath) {
    const asOwner = await fetch(ownedPath, { headers: { Authorization: `Bearer ${A.token}` } });
    const asOther = await fetch(ownedPath, { headers: { Authorization: `Bearer ${B.token}` } });
    const asAnonymous = await fetch(ownedPath);

    record('media: the owner can read their own media', asOwner.ok, `status ${asOwner.status}`);
    record(
      'media: another signed-in member can read a post-referenced media',
      asOther.ok,
      `status ${asOther.status}`,
    );
    record('media: an anonymous reader is refused', !asAnonymous.ok, `status ${asAnonymous.status}`);
  } else {
    record('media: an owner request was observed', false, 'no /media/ request recorded');
  }

  /* ------------------------------------------------- 22: console and network */

  const consoleErrors = [...pageA.pageErrors, ...pageB.pageErrors];
  const consoleWarnings = [...pageA.consoleLog, ...pageB.consoleLog].filter(
    (c) => c.level === 'error' || c.level === 'warning',
  );
  record(
    'no uncaught React errors in either session',
    consoleErrors.length === 0,
    consoleErrors.slice(0, 2).map((e) => e.slice(0, 120)).join(' | '),
  );
  process.stdout.write(
    `\nconsole errors/warnings: ${JSON.stringify(consoleWarnings.slice(0, 6).map((c) => c.text.slice(0, 140)))}\n`,
  );

  const allBad = [...auditNetwork(pageA).bad, ...auditNetwork(pageB).bad];
  process.stdout.write(`\nfailed requests during the run:\n${JSON.stringify([...new Set(allBad)].slice(0, 12), null, 1)}\n`);

  const allDoubled = [...auditNetwork(pageA).doubled, ...auditNetwork(pageB).doubled];
  record('no doubled /api/v1/api/v1/ anywhere in the run', allDoubled.length === 0, allDoubled.slice(0, 2).join(', '));

  process.stdout.write(`\n${results.filter((r) => r.ok).length}/${results.length} checks so far\n`);
} catch (error) {
  process.stdout.write(`\nHARNESS ERROR: ${error.stack ?? error.message}\n`);
  exitCode = 1;
} finally {
  cdp.close();
}

const failed = results.filter((r) => !r.ok);
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
for (const f of failed) process.stdout.write(`  FAILED: ${f.name}\n`);
process.exit(exitCode || (failed.length ? 1 : 0));