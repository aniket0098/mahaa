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

const ROOT = new URL('../dist/', import.meta.url).pathname.replace(/^\//, '');
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
 * In `web.output: "single"` (SPA) mode, `expo export` writes a single
 * `index.html` and every route (`/login`, `/home`, ...) resolves client-side
 * via `expo-router`. A plain static server would 404 those paths, so every
 * request that does not map to a real file on disk falls back to `index.html`,
 * letting the router mount the matching screen.
 *
 * Asset paths (`.js`, `.css`, `.png`, ...) are served directly from disk.
 * Everything else — including unknown routes — gets `index.html` so a page
 * refresh or a direct `/login` navigation keeps working.
 */
const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://x');
  // `normalize` collapses `..` so a request cannot escape the build directory.
  const requested = normalize(decodeURIComponent(pathname)).replace(/^\/+/, '');
  const filePath = join(ROOT, requested || 'index.html');

  try {
    const info = await stat(filePath);
    if (info.isFile()) {
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
    }
  } catch {
    // Fall through to the SPA fallback below.
  }

  // SPA history fallback: only path-shaped requests (no file extension) get
  // `index.html`, letting `expo-router` render the correct route client-side.
  // A request with a file extension that doesn't exist on disk is a missing
  // asset and must return 404, not HTML disguised as the asset.
  if (extname(requested)) {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end(`not found: ${pathname}`);
    return;
  }

  const indexPath = join(ROOT, 'index.html');
  const body = await readFile(indexPath);
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  response.end(body);
});

server.listen(PORT, () => {
  process.stdout.write(`serving ${ROOT} on http://localhost:${PORT}\n`);
});
