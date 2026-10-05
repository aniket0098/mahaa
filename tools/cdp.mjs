/**
 * A minimal Chrome DevTools Protocol client, for driving the real web build.
 *
 * **Only what the UI verification needs**, and nothing more: connect to a
 * running Edge, open a page, evaluate JavaScript in it, collect console output
 * and network events, and read back what the app actually rendered.
 *
 * Written by hand rather than pulled in as a dependency, because the
 * alternative (`puppeteer`/`playwright`) would add a browser-automation stack to
 * a project that has none, for the sake of a one-off verification. Node 22's
 * global `WebSocket` is the only transport needed; CDP is JSON over that socket.
 *
 *   const cdp = await connect(9222);
 *   const page = await openPage(cdp, 'http://localhost:8081');
 *   await page.eval('return document.title');
 *   await page.close();
 */

/** Connect to a browser's CDP endpoint and return a small handle. */
export async function connect(port = 9222) {
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = [];

  socket.addEventListener('message', (event) => {
    const frame = JSON.parse(event.data);
    if (frame.id !== undefined) {
      const entry = pending.get(frame.id);
      if (!entry) return;
      pending.delete(frame.id);
      clearTimeout(entry.timer);
      if (frame.error) entry.reject(new Error(`${frame.error.message} (${frame.error.code})`));
      else entry.resolve(frame.result);
      return;
    }
    for (const listener of listeners) listener(frame);
  });

  /**
   * One CDP command, returning its `result`.
   *
   * **Every command is bounded by a timeout.** Without one, a command whose
   * response never arrives — a renderer busy parsing the dev bundle, a target
   * detached mid-navigation — leaves its promise pending forever, and the run
   * hangs silently instead of reporting which step stalled. A timeout turns an
   * unanswerable question into an error naming the command.
   */
  const send = (method, params = {}, sessionId, timeoutMs = 60_000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  return {
    info,
    send,
    /** Subscribe to every event; returns an unsubscribe function. */
    on(listener) {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    },
    close() {
      socket.close();
    },
  };
}

/**
 * Wait for the page to finish loading, using CDP's own events.
 *
 * **Events, not polling.** The obvious implementation — navigate, then call
 * `Runtime.evaluate` every 500ms until it answers — deadlocks: a navigation
 * destroys the execution context an in-flight evaluation belongs to, and Chrome
 * never sends that evaluation's response. Polling therefore hangs on precisely
 * the page it is waiting for. `Page.loadEventFired` is delivered regardless of
 * which contexts have been torn down, so waiting on it is the only way to know
 * the page is ready without a call that the navigation can cancel.
 *
 * `frameStoppedLoading` is the safety net for a page whose load event already
 * fired before this listener was attached.
 */
function waitForLoad(cdp, sessionId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let frameId;
    const finish = () => {
      clearTimeout(timer);
      off();
      resolve();
    };

    const off = cdp.on((frame) => {
      if (frame.sessionId !== sessionId) return;
      const { method, params } = frame;
      if (method === 'Page.frameNavigated' && frameId === undefined && !params.frame?.parentId) {
        frameId = params.frame?.id;
      }
      if (method === 'Page.loadEventFired') return finish();
      if (
        method === 'Page.frameStoppedLoading' &&
        (frameId === undefined || params.frameId === frameId)
      ) {
        return finish();
      }
      return undefined;
    });

    const timer = setTimeout(() => {
      off();
      reject(new Error(`page did not finish loading in ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/**
 * Open a new tab in its **own browser context**, and return a page handle.
 *
 * The context is what makes two handles two independent sessions. Creating the
 * context *after* the target is useless — a target belongs to whatever context
 * existed when it was created — so the order here is load-bearing: context
 * first, then the target inside it. Getting it backwards leaves both tabs in the
 * default context, where they share cookies and `sessionStorage`, which on web is
 * where the access token lives: the two-user test would then pass while proving
 * nothing at all.
 */
export async function openPage(cdp, url) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext', {
    disposeOnDetach: false,
  });
  const { targetId } = await cdp.send('Target.createTarget', {
    url: 'about:blank',
    browserContextId,
  });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  const consoleLog = [];
  const network = [];
  const pageErrors = [];

  cdp.on((frame) => {
    if (frame.sessionId !== sessionId) return;
    const { method, params } = frame;
    if (method === 'Runtime.consoleAPICalled') {
      consoleLog.push({
        level: params.type,
        text: (params.args ?? [])
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
          .join(' '),
      });
    } else if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails ?? {};
      pageErrors.push(d.exception?.description ?? d.text ?? 'unknown exception');
    } else if (method === 'Network.requestWillBeSent') {
      network.push({ type: 'request', method: params.request?.method, url: params.request?.url ?? '' });
    } else if (method === 'Network.responseReceived') {
      network.push({
        type: 'response',
        status: params.response?.status,
        url: params.response?.url ?? '',
        mimeType: params.response?.mimeType ?? '',
      });
    } else if (method === 'Network.webSocketCreated') {
      network.push({ type: 'ws_created', url: params.url });
    } else if (method === 'Network.webSocketFrameReceived') {
      network.push({ type: 'ws_frame', payload: params.response?.payloadData });
    } else if (method === 'Network.webSocketClosed') {
      network.push({ type: 'ws_closed', url: params.url ?? '' });
    }
  });

  await Promise.all([
    cdp.send('Runtime.enable', {}, sessionId),
    cdp.send('Network.enable', {}, sessionId),
    cdp.send('Page.enable', {}, sessionId),
  ]);

  const page = {
    targetId,
    sessionId,
    consoleLog,
    network,
    pageErrors,

    /**
     * Evaluate an async body in the page and return its JSON value.
     *
     * The `awaitPromise` wrapper means every caller can write `await page.eval(...)`
     * even when the body is synchronous, and a body that rejects surfaces as a
     * thrown error here rather than a silent `undefined`.
     *
     * **Bounded on purpose.** An evaluation whose execution context is destroyed
     * mid-flight — which is exactly what happens if the app's own router
     * navigates while a check is running — never gets a response from Chrome. With
     * no timeout the caller waits forever, so the timeout is what turns that into
     * a retryable error instead of a stuck run.
     */
    async eval(expression, { timeoutMs = 30_000 } = {}) {
      const result = await cdp.send(
        'Runtime.evaluate',
        {
          expression: `(async () => { ${expression} })()`,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        },
        sessionId,
        timeoutMs,
      );
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
        );
      }
      return result.result?.value;
    },

    /**
     * Navigate and wait for the page to be ready to be driven.
     *
     * See {@link waitForLoad} for why this waits on a CDP event instead of
     * polling with `eval`.
     */
    async goto(target, { timeoutMs = 240_000 } = {}) {
      const loaded = waitForLoad(cdp, sessionId, timeoutMs);
      void cdp.send('Page.navigate', { url: target }, sessionId, timeoutMs + 30_000).catch(() => {});
      await loaded;
      // The bundle mounts and React Router redirects after `load` fires, so give
      // the app a beat to render before anything tries to read the DOM.
      await new Promise((r) => setTimeout(r, 1500));
    },

    /** Poll an expression until it is truthy. */
    async waitFor(expression, { timeoutMs = 30000, intervalMs = 500, label = 'condition' } = {}) {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        try {
          last = await page.eval(`return (${expression});`);
          if (last) return last;
        } catch (error) {
          last = `threw: ${error.message}`;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
    },

    /**
     * Give a local file to a file input, as the OS file dialog would.
     *
     * The input is located by **object id from a live evaluation**, not by
     * `DOM.querySelector` against a document snapshot. The picker appends its
     * input at runtime, and a snapshot taken with a shallow `depth` does not
     * contain nodes added after it was taken, so the query reports "no such
     * input" for an element that is plainly in the page. An object id handed
     * back by `Runtime.evaluate` is always current.
     */
    async setFiles(path, selector = 'input[type="file"]') {
      const { result } = await cdp.send(
        'Runtime.evaluate',
        { expression: `document.querySelector(${JSON.stringify(selector)})` },
        sessionId,
      );
      if (!result?.objectId) throw new Error(`no file input matching ${selector}`);
      await cdp.send(
        'DOM.setFileInputFiles',
        { files: [path], objectId: result.objectId },
        sessionId,
      );
      return result.objectId;
    },

    /** Click the first button-ish node whose text or aria-label contains `text`. */
    async clickText(text, { exact = false } = {}) {
      return page.eval(`
        const needle = ${JSON.stringify(text)};
        const exact = ${exact ? 'true' : 'false'};
        const nodes = Array.from(document.querySelectorAll(
          'button, [role="button"], a, [role="link"], [role="radio"], [role="menuitem"]'
        ));
        const hit = nodes.find((node) => {
          const label = (node.innerText || node.getAttribute('aria-label') || '').trim();
          return exact ? label === needle : label.includes(needle);
        });
        if (!hit) {
          return { clicked: false, labels: nodes.map((n) =>
            (n.innerText || n.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 40) };
        }
        hit.click();
        return { clicked: true, label: hit.getAttribute('aria-label') || hit.innerText };
      `);
    },

    /** Every visible line of text, for reading what the page actually shows. */
    text() {
      return page.eval(
        'return document.body ? document.body.innerText : "";',
      );
    },

    async close() {
      await cdp.send('Target.closeTarget', { targetId });
    },
  };

  return page;
}