/**
 * Isolation guarantees for the Community Feed.
 *
 * These are structural checks on the source rather than assertions about a
 * rendered screen, because the thing being protected is a *capability*: demo
 * content and local engagement state must be incapable of reaching the network.
 * The rules are enforced by reading the files, so a future edit that adds a
 * request to the feed fails the suite instead of quietly shipping.
 */

import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEMO_FEED_IMAGES } from '@/features/feed/demoFeedAssets';

// Resolved relative to this test file, which lives in `src/features/feed/`, so
// `.` is the feature directory and `../..` is the `src` root.
const FEED_DIR = fileURLToPath(new URL('.', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../../', import.meta.url));
const API_DIR = `${SRC_DIR}api/`;
const ASSET_DIR = fileURLToPath(new URL('../../../assets/demo/', import.meta.url));

/** Every TypeScript/TSX file directly in the feed feature. */
function feedFiles(): string[] {
  return readdirSync(FEED_DIR, { withFileTypes: true })
    .filter((entry: Dirent) => /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts'))
    .map((entry) => `${FEED_DIR}${entry.name}`);
}

const sources = feedFiles().map((path) => ({ path, source: readFileSync(path, 'utf8') }));

describe('the feed reaches the API only through the api layer', () => {
  it('has no HTTP client, no fetch, and no transport import anywhere in the feature', () => {
    for (const { path, source } of sources) {
      expect(source, `${path} must not reference apiClient`).not.toMatch(/\bapiClient\b/);
      expect(source, `${path} must not call fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(source, `${path} must not import the client`).not.toMatch(
        /from '@\/api\/client'/,
      );
    }
  });

  it('reads the feed through @/api/posts, never by calling the transport itself', () => {
    // The feed may legitimately read real posts now, but only through the one
    // module that owns the request — the layering rule this project enforces.
    const hook = readFileSync(`${FEED_DIR}useFeedPosts.ts`, 'utf8');
    expect(hook).toContain("from '@/api/posts'");
    expect(hook).toContain('fetchPosts(');
  });

  it('has a posts module that talks to the endpoints the API actually serves', () => {
    expect(existsSync(`${API_DIR}posts.ts`)).toBe(true);
    const source = readFileSync(`${API_DIR}posts.ts`, 'utf8');
    // Only real routes. A path that is not in the backend's router is a 404.
    for (const call of source.match(/apiClient\.\w+<[^>]*>\(`?([^`',)]+)/g) ?? []) {
      expect(call, `unexpected request target: ${call}`).toMatch(
        /`?\/posts(\/\$\{\w+\})?`?/,
      );
    }
  });

  it('never sends a demo id to the API', () => {
    const posts = readFileSync(`${API_DIR}posts.ts`, 'utf8');
    expect(posts).not.toMatch(/DEMO_POST_ID_PREFIX|demoFeedPosts/);

    // The composer may say "demo" in English copy; what it must not do is import
    // the demo dataset or mint an id in the demo namespace.
    const composer = readFileSync(
      fileURLToPath(new URL('../composer/composerModel.ts', import.meta.url)),
      'utf8',
    );
    expect(composer).not.toMatch(/demoFeed|DEMO_POST|'demo-|\"demo-/);
  });

  it('has query keys for the interaction routes the API actually serves', () => {
    const keys = readFileSync(`${API_DIR}queryKeys.ts`, 'utf8');
    expect(keys).toMatch(/posts:/);
    // Likes and comments are real now, so their keys exist. There is deliberately
    // still no saving key: saving is session-scoped device state with no server
    // route, and a key for it would be a promise the API does not keep. Asserted
    // against the *key names* rather than the file text, because these docs
    // legitimately explain why saving has none.
    expect(keys).toMatch(/postComments\s*:/);
    expect(keys).not.toMatch(/^\s*\w*[Bb]ookmarks?\w*\s*:/m);
  });

  it('talks only to the engagement routes the backend really has', () => {
    const source = readFileSync(`${API_DIR}posts.ts`, 'utf8');
    // Every call must resolve under `/posts`. A like at `/likes/{id}` or a comment
    // at `/post-comments` would be a route the server does not serve, and would
    // only be discovered as a 404 at runtime.
    for (const call of source.matchAll(/apiClient\.\w+<[^>]*>\(`([^`]+)`/g)) {
      expect(call[1], `unexpected request target: ${call[1]}`).toMatch(/^\/posts/);
    }
    expect(source).toContain('/like');
    expect(source).toContain('/comments');
  });
});

describe('demo content cannot be transmitted', () => {
  const demoFiles = ['demoFeedPosts.ts', 'demoFeedAssets.ts', 'localEngagement.ts'];

  it('imports neither react-native nor any API module in the demo and local-only modules', () => {
    for (const name of demoFiles) {
      const source = readFileSync(`${FEED_DIR}${name}`, 'utf8');
      expect(source, `${name} must stay platform-free`).not.toMatch(/from 'react-native'/);
      expect(source, `${name} must stay offline`).not.toMatch(/fetch|apiClient|@\/api/);
    }
  });

  it('namespaces every demo id so it can be recognised before a request', () => {
    const source = readFileSync(`${FEED_DIR}demoFeedPosts.ts`, 'utf8');
    expect(source).toMatch(/export const DEMO_POST_ID_PREFIX = 'demo-'/);
  });

  it('re-imports the demo set only through a name it can test', () => {
    // `useFeedPosts` is the single place the dataset is read, so the merge
    // cannot be re-implemented somewhere that forgets the demo gate.
    const hook = readFileSync(`${FEED_DIR}useFeedPosts.ts`, 'utf8');
    expect(hook).toContain('isDemoFeedEnabled()');
    expect(hook).toContain('mergeFeed(');
  });
});

describe('the generated demo assets are real files', () => {
  it('writes one image file per embedded key, so the module cannot drift from disk', () => {
    for (const key of Object.keys(DEMO_FEED_IMAGES)) {
      expect(existsSync(`${ASSET_DIR}${key}.png`), `missing asset for ${key}`).toBe(true);
    }
  });

  it('marks the generated module as generated', () => {
    const source = readFileSync(`${FEED_DIR}demoFeedAssets.ts`, 'utf8');
    expect(source).toContain('GENERATED FILE');
  });
});
