import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8081';
const WEB_API_ORIGIN = 'http://localhost:8000';

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200));
});

async function state(label) {
  const url = page.url();
  const testids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid')),
  );
  console.log(`\n=== ${label} ===`);
  console.log('url:', url);
  console.log('testids:', JSON.stringify(testids));
}

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForTimeout(8000);
await state('landing loaded');

const btn = page.getByRole('button', { name: 'I already have an account' }).first();
console.log('button count:', await page.getByRole('button', { name: 'I already have an account' }).count());
await btn.click();
await page.waitForTimeout(6000);
await state('after click sign-in');

console.log('\nbody text head:', (await page.evaluate(() => document.body.innerText)).slice(0, 800));

await browser.close();
