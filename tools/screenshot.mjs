/**
 * Screenshot the page, so "it did not render" can be seen rather than inferred.
 *
 *   node tools/screenshot.mjs <url> <out.png> [email] [password]
 */

import { writeFileSync } from 'node:fs';
import { connect, openPage } from './cdp.mjs';

const [url, out, email, password] = process.argv.slice(2);
const write = (m) => process.stdout.write(`${m}\n`);

const cdp = await connect();
const page = await openPage(cdp, url);

try {
  // Wait for the page to load before looking for the login form: `openPage`
  // dispatches the navigation without waiting, so checking immediately reports
  // the blank document that was there first.
  await page.goto(url, { timeoutMs: 90_000 });

  if (email && password) {
    await page.eval(`
      const setNative = (el, value) => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
          .set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const emailEl = document.querySelector('input[type="email"]');
      const passEl = document.querySelector('input[type="password"]');
      if (emailEl && passEl) {
        setNative(emailEl, ${JSON.stringify(email)});
        setNative(passEl, ${JSON.stringify(password)});
        Array.from(document.querySelectorAll('button'))
          .find((b) => /sign in/i.test(b.innerText)).click();
      }
      return true;
    `);
    await new Promise((r) => setTimeout(r, 5000));
  }

  // Settle: images decode and the feed paints a beat after load.
  await new Promise((r) => setTimeout(r, 4000));

  // Scroll to a given caption, so a specific post can be captured rather than
  // whatever happened to be at the top of the feed.
  const caption = process.env.SCROLL_TO;
  if (caption) {
    await page.eval(`
      const needle = ${JSON.stringify(caption)};
      const scroller = Array.from(document.querySelectorAll('div'))
        .find((d) => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 200);
      const post = Array.from(document.querySelectorAll('[data-testid^="feed-post-"]'))
        .find((p) => (p.innerText || '').includes(needle));
      if (scroller && post) {
        scroller.scrollTop = post.offsetTop - 40 + 300;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
      return Boolean(post);
    `);
    await new Promise((r) => setTimeout(r, 4000));
  }

  const { data } = await cdp.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false },
    page.sessionId,
  );
  writeFileSync(out, Buffer.from(data, 'base64'));
  write(`screenshot written to ${out}`);

  const summary = await page.eval(`
    return {
      path: location.pathname,
      images: Array.from(document.querySelectorAll('img')).length,
      canvases: Array.from(document.querySelectorAll('canvas')).length,
      backgroundImages: Array.from(document.querySelectorAll('*')).filter((el) => {
        const bg = getComputedStyle(el).backgroundImage;
        return bg && bg !== 'none';
      }).length,
      text: document.body.innerText.slice(0, 200),
    };
  `);
  write(JSON.stringify(summary, null, 2));
} finally {
  await page.close();
  cdp.close();
}
