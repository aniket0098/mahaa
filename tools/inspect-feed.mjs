/**
 * Find the most recent post card in a page and report how its media is rendered.
 *
 *   node tools/inspect-feed.mjs <caption>
 *
 * Written because the aggregate "is the image there?" question had three possible
 * answers — an img, a background-image, or a canvas — and guessing wrong reports a
 * working image as broken. This prints what is actually in the DOM so the check
 * can be written against reality rather than against an assumption.
 */

import { connect, openPage } from './cdp.mjs';

const caption = process.argv[2] ?? '';
const WEB = 'http://localhost:8082';
const write = (m) => process.stdout.write(`${m}\n`);

const cdp = await connect();
const page = await openPage(cdp, WEB);

try {
  await page.goto(`${WEB}/home`, { timeoutMs: 60_000 });
  // The sign-in form appears first; a token is needed to read the feed.
  const onLogin = await page.eval('return location.pathname === "/login";');
  if (onLogin) {
    const email = process.argv[3];
    const password = process.argv[4];
    if (!email || !password) {
      write('need an email and password to read the feed');
      process.exit(2);
    }
    await page.eval(`
      const setNative = (el, value) => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
          .set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setNative(document.querySelector('input[type="email"]'), ${JSON.stringify(email)});
      setNative(document.querySelector('input[type="password"]'), ${JSON.stringify(password)});
      Array.from(document.querySelectorAll('button'))
        .find((b) => /sign in/i.test(b.innerText)).click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 4000));
  }

  const report = await page.eval(`
    const caption = ${JSON.stringify(caption)};
    const posts = Array.from(document.querySelectorAll('[data-testid^="feed-post-"]'));
    const post = posts.find((p) => (p.innerText || '').includes(caption)) || posts[0] || null;
    if (!post) {
      return { error: 'no feed post found', postCount: posts.length,
        text: document.body.innerText.slice(0, 300) };
    }
    const describe = (el) => ({
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute('data-testid'),
      w: el.getBoundingClientRect().width,
      h: el.getBoundingClientRect().height,
      bg: getComputedStyle(el).backgroundImage.slice(0, 60),
      src: el.currentSrc || el.src || '',
      natural: el.naturalWidth || el.videoWidth || el.width || 0,
    });
    return {
      postTestId: post.getAttribute('data-testid'),
      postText: (post.innerText || '').slice(0, 200),
      imgs: Array.from(post.querySelectorAll('img')).map(describe),
      videos: Array.from(post.querySelectorAll('video')).map(describe),
      canvases: Array.from(post.querySelectorAll('canvas')).map(describe),
      // The media wrapper the card actually renders into.
      mediaWrapper: post.querySelector('[data-testid="feed-post-media"]')
        ? describe(post.querySelector('[data-testid="feed-post-media"]')) : null,
      descendants: Array.from(post.querySelectorAll('*'))
        .filter((el) => {
          const bg = getComputedStyle(el).backgroundImage;
          return (bg && bg !== 'none') || el.tagName === 'CANVAS' || el.tagName === 'IMG';
        })
        .map(describe).slice(0, 6),
      // The media wrapper's own markup, which is where a load failure would say so.
      mediaHtml: post.querySelector('[data-testid="feed-post-media"]')
        ? post.querySelector('[data-testid="feed-post-media"]').outerHTML.slice(0, 700)
        : null,
      // The image node expo-image actually creates, wherever it lives.
      imageNodes: Array.from(post.querySelectorAll(
        '[data-testid^="feed-post-image"], [data-testid*="expo-image"]'
      )).map(describe),
    };
  `);
  write(JSON.stringify(report, null, 2));

  // And the requests the page made for media, which is the part that proves the
  // bytes were actually authorised and fetched.
  const media = page.network
    .filter((n) => (n.type === 'request' || n.type === 'response') && /\/media\//.test(n.url))
    .map((n) => ({ kind: n.type, status: n.status, url: n.url.replace(WEB, '') }));
  write(`\nmedia traffic: ${JSON.stringify(media.slice(-10), null, 2)}`);

  // The decisive question: does the card have a media url at all? An empty frame
  // with no request is a client that never asked, which is a different defect
  // from a request that was refused.
  const src = await page.eval(`
    const caption = ${JSON.stringify(caption)};
    const post = Array.from(document.querySelectorAll('[data-testid^="feed-post-"]'))
      .find((p) => (p.innerText || '').includes(caption));
    const wrapper = post ? post.querySelector('[data-testid="feed-post-media"]') : null;
    return {
      frameHtml: wrapper ? wrapper.innerHTML.slice(0, 400) : null,
      // expo-image on web keeps its source on a data attribute of its own node.
      innerDivs: wrapper
        ? Array.from(wrapper.querySelectorAll('div')).map((d) => ({
            cls: d.className,
            style: d.getAttribute('style'),
            bg: getComputedStyle(d).backgroundImage.slice(0, 50),
            children: d.childElementCount,
          }))
        : [],
    };
  `);
  write(`\ncard media internals: ${JSON.stringify(src, null, 2)}`);

  /*
   * Does a plain <img> with the same URL load? If it does, the bytes and the URL
   * are both fine and the fault is in how the image component is being fed. If it
   * does not, the request itself is the problem. This separates the two, which is
   * the difference between fixing a component and fixing a URL.
   */
  const probe = await page.eval(`
    const url = 'http://localhost:8000/api/v1/media/57c2f304-cdc4-4119-a245-7f4a6d1db64d';
    const token = window.sessionStorage.getItem('mahajob.access_token');
    return await new Promise((resolve) => {
      // 1. no header at all, which must be refused by design.
      const anonymous = new Image();
      anonymous.onload = () => resolve({ case: 'anonymous', ok: true });
      anonymous.onerror = () => {
        // 2. with the bearer attached, which must succeed.
        const authorised = new Image();
        authorised.crossOrigin = 'anonymous';
        authorised.onload = () => resolve({ case: 'with bearer', ok: true, w: authorised.naturalWidth });
        authorised.onerror = () => resolve({ case: 'with bearer', ok: false });
        // A cross-origin img cannot send an Authorization header at all, so this
        // is expected to fail; it is here to document the browser's limit.
        authorised.src = url;
      };
      anonymous.src = url;
      setTimeout(() => resolve({ case: 'timeout', ok: false }), 8000);
    });
  `);
  write(`\nplain <img> probe: ${JSON.stringify(probe)}`);

  // And a fetch with the header, which is the shape the app is meant to use.
  const fetched = await page.eval(`
    const url = 'http://localhost:8000/api/v1/media/57c2f304-cdc4-4119-a245-7f4a6d1db64d';
    const token = window.sessionStorage.getItem('mahajob.access_token');
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const blob = await response.blob();
    return { status: response.status, type: blob.type, size: blob.size };
  `);
  write(`fetch with bearer: ${JSON.stringify(fetched)}`);

  /*
   * Does the media request go out at all, and if it does, with what headers?
   *
   * expo-image's web `useHeaders` fetches the bytes itself when the source
   * carries headers, and renders nothing until that fetch resolves. So an empty
   * frame can mean either "the fetch never went out" or "the fetch went out and
   * was refused". Watching the request stream distinguishes them, and the
   * distinction is the whole diagnosis.
   */
  await page.eval(`
    window.__mediaLog = [];
    const originalFetch = window.fetch;
    window.fetch = function patched(...args) {
      const url = String(args[0] && args[0].url ? args[0].url : args[0]);
      if (url.includes('/media/')) {
        window.__mediaLog.push({ url, hasAuth: !!(args[1] && args[1].headers && args[1].headers.Authorization) });
      }
      return originalFetch.apply(this, args);
    };
    return true;
  `);

  // Force a fresh render of the feed by scrolling it out and back.
  await page.eval(`
    const scroller = Array.from(document.querySelectorAll('div'))
      .find((d) => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 200);
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
      await new Promise((r) => setTimeout(r, 1200));
      scroller.scrollTop = 0;
    }
    return true;
  `);
  await new Promise((r) => setTimeout(r, 3000));

  const observed = await page.eval('return window.__mediaLog;');
  write(`\nfetches made for media: ${JSON.stringify(observed, null, 2)}`);

  /*
   * Reproduce the app's own source shape, without the app's module graph.
   *
   * `authenticatedImageSource` is a two-line pure function, so the exact thing
   * the card is handed can be rebuilt here and handed to a real expo-image-shaped
   * consumer. If a source with no Authorization produces an empty frame and one
   * with it produces pixels, the defect is isolated to the headers the app
   * supplies — not to expo-image, not to the server, and not to the URL.
   */
  const reproduction = await page.eval(`
    const url = 'http://localhost:8000/api/v1/media/57c2f304-cdc4-4119-a245-7f4a6d1db64d';
    const token = window.sessionStorage.getItem('mahajob.access_token');

    // Does the app's module-level token cache agree with sessionStorage? If
    // sessionStorage holds a token but the cache is empty, primeMediaAuth has
    // not populated it by the time the feed renders, and every media source the
    // app builds is an empty-headers source that 401s.
    const apiBase = 'http://localhost:8000/api/v1';
    const buildLikeApp = (uri) => (uri.startsWith(apiBase)
      ? { uri, headers: token ? { Authorization: 'Bearer ' + token } : {} }
      : { uri, headers: {} });

    const sample = ${JSON.stringify('http://localhost:8000/api/v1/media/57c2f304-cdc4-4119-a245-7f4a6d1db64d')};
    return {
      sessionStorageHasToken: Boolean(token),
      tokenLength: token ? token.length : 0,
      // The object the app would hand expo-image right now.
      sourceAppBuilds: buildLikeApp(sample),
      headersAreTruthyButEmpty: (() => {
        const s = buildLikeApp(sample);
        return Boolean(s.headers) && Object.keys(s.headers).length === 0;
      })(),
    };
  `);
  write(`\nreproduction: ${JSON.stringify(reproduction, null, 2)}`);

  // Reload the page, which re-runs primeMediaAuth, then re-check whether the
  // images appear. A defect that clears on reload is a first-paint ordering
  // problem; one that persists is a wrong source shape.
  //
  // Generously long settle: primeMediaAuth is async and the feed query is async,
  // and which of the two finishes first decides whether the source the card keeps
  // is the one with the bearer in it. Waiting a beat and concluding "broken"
  // would misreport a slow first paint as a defect.
  await page.goto(`${WEB}/home`, { timeoutMs: 60_000 });
  const afterReload = [];
  for (const waitMs of [3000, 7000, 15000]) {
    await new Promise((r) => setTimeout(r, waitMs));
    afterReload.push(await page.eval(`
      const caption = ${JSON.stringify(caption)};
      const post = Array.from(document.querySelectorAll('[data-testid^="feed-post-"]'))
        .find((p) => (p.innerText || '').includes(caption));
      const wrapper = post ? post.querySelector('[data-testid="feed-post-media"]') : null;
      return {
        waitedMs: ${waitMs},
        imgCount: post ? post.querySelectorAll('img').length : 0,
        loadedImgs: post ? Array.from(post.querySelectorAll('img'))
          .filter((i) => i.complete && i.naturalWidth > 0).length : 0,
        showsErrorText: post ? /could not be loaded/i.test(post.innerText) : false,
        mediaHtml: wrapper ? wrapper.innerHTML.slice(0, 160) : null,
      };
    `));
  }
  write(`\nafter a full reload, over time: ${JSON.stringify(afterReload, null, 2)}`);

  /*
   * Stop inferring and measure. Every hypothesis so far has been about *why* the
   * source lacks a header. This asks the question directly: is the token in the
   * app's own cache, and does a source built from it load?
   *
   * The app module is not reachable from the page, so this reads the observable
   * consequence instead: whether any media request has been made at all, and with
   * what. A fetch that never happens is a source that never carried a header.
   */
  const measured = await page.eval(`
    window.__log = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = (...args) => {
      const url = String(args[0] && args[0].url ? args[0].url : args[0]);
      if (url.includes('/media/')) {
        const headers = (args[1] && args[1].headers) || {};
        window.__log.push({ url: url.slice(-40), auth: headers.Authorization ? 'yes' : 'NO' });
      }
      return realFetch(...args);
    };
    return true;
  `);

  // Nudge a re-render of every feed card, which is what a token landing would do.
  await page.eval(`
    window.dispatchEvent(new Event('focus'));
    const scroller = Array.from(document.querySelectorAll('div'))
      .find((d) => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 200);
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
      await new Promise((r) => setTimeout(r, 1500));
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    return true;
  `);
  await new Promise((r) => setTimeout(r, 4000));

  const after = await page.eval(`
    const caption = ${JSON.stringify(caption)};
    const post = Array.from(document.querySelectorAll('[data-testid^="feed-post-"]'))
      .find((p) => (p.innerText || '').includes(caption));
    return {
      mediaFetches: window.__log,
      imgCount: post ? post.querySelectorAll('img').length : 0,
      loaded: post ? Array.from(post.querySelectorAll('img'))
        .filter((i) => i.complete && i.naturalWidth > 0).map((i) => i.naturalWidth) : [],
      showsError: post ? /could not be loaded/i.test(post.innerText) : false,
    };
  `);
  write(`\nMEASURED after a nudge: ${JSON.stringify(after, null, 2)}`);

  /*
   * Dump the card's whole subtree.
   *
   * The wrapper's own innerHTML was empty, which means the failure is upstream of
   * the image component: whatever should be inside the media band was never
   * rendered. Guessing which layer that is has been unproductive, so the entire
   * subtree is printed once and read directly.
   */
  const subtree = await page.eval(`
    const caption = ${JSON.stringify(caption)};
    const post = Array.from(document.querySelectorAll('[data-testid^="feed-post-"]'))
      .find((p) => (p.innerText || '').includes(caption));
    if (!post) return { error: 'post not found' };
    const walk = (el, depth) => {
      if (depth > 6) return null;
      const rect = el.getBoundingClientRect();
      return {
        d: depth,
        tag: el.tagName.toLowerCase(),
        tid: el.getAttribute('data-testid') || '',
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        kids: el.childElementCount,
        // The first few style declarations, which carry the layout intent.
        style: (el.getAttribute('style') || '').slice(0, 90),
      };
    };
    const nodes = [];
    const visit = (el, depth) => {
      nodes.push(walk(el, depth));
      for (const child of el.children) visit(child, depth + 1);
    };
    visit(post, 0);
    return { count: nodes.length, nodes };
  `);
  write(`\ncard subtree: ${JSON.stringify(subtree, null, 1)}`);
} catch (error) {
  write(`FAILED: ${error.stack ?? error.message}`);
} finally {
  await page.close();
  cdp.close();
}