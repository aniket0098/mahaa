/**
 * Log every CDP event a single navigation produces, unfiltered.
 *
 * The question this answers is narrow: does the page ever reach `load`, and if
 * not, what is it doing instead? Guessing from a hanging script is not
 * informative; the event stream is.
 *
 *   node tools/inspect-page.mjs <url>
 */

import { connect, openPage } from './cdp.mjs';

const url = process.argv[2] ?? 'about:blank';
const write = (m) => process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`);

const cdp = await connect();
write(`connected to ${cdp.info.Browser}`);

/** Only the lifecycle events worth reading; the rest is asset chatter. */
const LIFECYCLE = new Set([
  'Page.frameNavigated',
  'Page.frameStartedLoading',
  'Page.frameStoppedLoading',
  'Page.loadEventFired',
  'Page.domContentEventFired',
  'Runtime.executionContextCreated',
  'Runtime.executionContextDestroyed',
  'Runtime.exceptionThrown',
  'Network.webSocketCreated',
  'Network.loadingFailed',
]);

const seen = { requests: 0, finished: 0 };
cdp.on((frame) => {
  if (!LIFECYCLE.has(frame.method)) {
    if (frame.method === 'Network.requestWillBeSent') seen.requests += 1;
    if (frame.method === 'Network.loadingFinished') seen.finished += 1;
    return;
  }
  const detail = frame.params?.frame?.url
    ?? frame.params?.url
    ?? frame.params?.exceptionDetails?.exception?.description
    ?? frame.params?.exceptionDetails?.text
    ?? frame.params?.errorText
    ?? '';
  write(`${frame.method} ${String(detail).slice(0, 120)}`);
});

const page = await openPage(cdp, 'about:blank');

try {
  write(`navigating to ${url}`);
  const loaded = new Promise((resolve) => {
    const off = cdp.on((frame) => {
      if (frame.method === 'Page.loadEventFired') { off(); resolve(); }
    });
    setTimeout(() => { off(); resolve(); }, 180_000);
  });

  cdp.send('Page.navigate', { url }, page.sessionId, 200_000).catch((e) => write(`navigate error: ${e.message}`));
  write(`navigate dispatched; assets requested=${seen.requests} finished=${seen.finished}`);
  await loaded;
  write('load event fired');
  await new Promise((r) => setTimeout(r, 3000));
  write(`after settle: requested=${seen.requests} finished=${seen.finished}`);

  const snap = await page.eval(`
    return {
      path: location.pathname,
      ready: document.readyState,
      text: document.body ? document.body.innerText.slice(0, 400) : '(none)',
      inputs: Array.from(document.querySelectorAll('input')).map((i) =>
        i.type + '/' + (i.placeholder || i.name || i.getAttribute('aria-label') || '')),
      buttons: Array.from(document.querySelectorAll('button, [role="button"]'))
        .map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 40))
        .filter(Boolean).slice(0, 15),
    };
  `);
  write(JSON.stringify(snap, null, 2));
} catch (error) {
  write(`FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await page.close();
  cdp.close();
}