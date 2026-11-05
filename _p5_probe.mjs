/**
 * Throwaway exploration probe — NOT part of the committed suite.
 *
 * Dumps the accessible names and test ids the Expo Web build actually renders,
 * so the real E2E suite targets what exists rather than what the source
 * suggests. Deleted after the selectors are settled.
 */
import { chromium } from 'playwright';

const WEB = 'http://localhost:8081';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 200)));

async function dump(label) {
  const data = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll('[data-testid], button, a, input, [role="button"], [role="link"], h1, h2, h3'),
    );
    return nodes.map((n) => {
      const tag = n.tagName.toLowerCase();
      const testid = n.getAttribute('data-testid');
      const role = n.getAttribute('role');
      const aria = n.getAttribute('aria-label');
      const text = (n.textContent || '').trim().slice(0, 60);
      const ph = n.getAttribute('placeholder');
      const type = n.getAttribute('type');
      return [tag, testid, role, aria, ph, type, text].filter(Boolean).join(' | ');
    });
  });
  console.log('===== ' + label + ' (' + data.length + ') =====');
  for (const d of data) console.log('  ' + d);
}

await page.goto(WEB + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForSelector('[data-testid="login-screen"], [role="heading"]', { timeout: 180000 });
await page.waitForTimeout(4000);
await dump('LANDING /');

await page.goto(WEB + '/login', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForSelector('[data-testid="login-screen"]', { timeout: 60000 });
await page.waitForTimeout(1500);
await dump('LOGIN');
console.log('URL after sign-in click:', page.url());

// --- sign in for real ---
await page.getByLabel('Email address').fill(process.env.P5_EMAIL);
await page.getByLabel('Password').fill(process.env.P5_PASSWORD);
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.waitForTimeout(6000);
console.log('URL after login:', page.url());
await dump('AFTER LOGIN');

const body = await page.evaluate(() => document.body.innerText.slice(0, 1500));
console.log('--- BODY AFTER LOGIN ---\n' + body);

// storage
const storage = await page.evaluate(() => ({
  sessionToken: Boolean(window.sessionStorage.getItem('mahajob.access_token')),
  localToken: Boolean(window.localStorage.getItem('mahajob.access_token')),
  sessionKeys: Object.keys(window.sessionStorage),
  localKeys: Object.keys(window.localStorage),
}));
console.log('STORAGE:', JSON.stringify(storage));

await page.goto(WEB + '/learn', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(6000);
console.log('URL after direct /learn:', page.url());
await dump('LEARN');

console.log('CONSOLE ERRORS:', JSON.stringify(errors, null, 1));

// --- H1 probe: dead API on the login screen ---
console.log('\n########## H1 PROBE ##########');
const p2 = await browser.newPage();
await p2.route('http://127.0.0.1:8000/api/v1/**', (r) => r.abort('connectionrefused'));
await p2.goto(WEB + '/login', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p2.waitForSelector('[data-testid="login-screen"]', { timeout: 60000 });
await p2.waitForTimeout(2000);
await p2.getByLabel('Email address').fill('probe@example.com');
await p2.getByLabel('Password').fill('Passw0rd!2026');
const btn = p2.getByRole('button', { name: 'Sign in', exact: true });
console.log('button count', await btn.count());
console.log('button disabled?', await btn.isDisabled().catch((e) => 'ERR ' + e.message));
const vals = await p2.evaluate(() =>
  Array.from(document.querySelectorAll('input')).map((i) => ({
    label: i.getAttribute('aria-label'),
    value: i.value,
    type: i.type,
  })),
);
console.log('INPUTS', JSON.stringify(vals));
const bodyTxt = await p2.evaluate(() => document.body.innerText.slice(0, 1200));
console.log('BODY', bodyTxt);
await browser.close();
