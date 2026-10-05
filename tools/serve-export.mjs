/**
 * Serve the exported web build, with the SPA fallback the router needs.
 *
 * **A plain static server is not enough.** This app uses file-based routing with
 * client-side navigation, so a request for `/login` is not a file on disk — it is
 * the same `index.html` the browser is already running, which then lets
 * `expo-router` resolve the path. Serving 404 for those paths would test the
 * server's configuration rather than the app.
 *
 * This exists because the dev server takes minutes to hand a browser its first
 * bundle (it compiles on demand, per context), which makes an iterative UI
 * session impractical. The exported build is the same application code, already
 * compiled, and loads in under a second.
 *
 *   node tools/serve-export.mjs [port]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../dist-ui/', import.meta.url).pathname.replace(/^\//, '');
const PORT = Number(process.argv[2] ?? 8082);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Serve the exported web build.
 *
 * **Two routing rules, both required by how `expo export` lays the output out.**
 *
 * The export writes one HTML file per route, named after the route
 * (`login.html`, `home.html`, `add-story.html`, `+not-found.html`), *not* a
 * single `index.html` behind a history fallback. So `/login` must be served
 * `login.html`. Handing it `index.html` instead makes React hydrate against the
 * wrong document — React error #418 — and the run then measures the test
 * server's routing bug rather than the app.
 *
 * What still needs the fallback is an asset path with no extension, because
 * `expo-router` pushes those client-side without ever asking the server again.
 */
const ROUTE_FILE = {
  '/': 'index.html',
  '/index': 'index.html',
};

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://x');
  // `normalize` collapses `..` so a request cannot escape the build directory.
  const requested = normalize(decodeURIComponent(pathname)).replace(/^\/+/, '');

  const candidates = requested
    ? [ROUTE_FILE[pathname], `${requested}.html`, requested, `${requested}/index.html`]
    : ['index.html'];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const filePath = join(ROOT, candidate);
    try {
      const info = await stat(filePath);
      if (!info.isFile()) continue;
      const body = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': TYPES[extname(filePath)] ?? 'application/octet-stream',
        'Content-Length': body.length,
        // No caching: the point of this server is to always serve what was just
        // exported, so a stale bundle can never explain a surprising result.
        'Cache-Control': 'no-store',
      });
      response.end(body);
      return;
    } catch {
      // Try the next shape.
    }
  }

  response.writeHead(404, { 'Content-Type': 'text/plain' });
  response.end(`not found: ${pathname}`);
});

server.listen(PORT, () => {
  process.stdout.write(`serving ${ROOT} on http://localhost:${PORT}\n`);
});