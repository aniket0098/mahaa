/**
 * Media URL resolution regression tests.
 *
 * **This rule had no coverage at all before Phase 4.6**, which is how a doubled
 * `/api/v1` survived three phases and a 575-test suite while making every image,
 * avatar and video in the app 404. These tests exist so it cannot come back.
 *
 * **The base is varied per case** because the whole defect was the *interaction*
 * between a base that carries `/api/v1` and a served path that carries it too.
 * One fixed base would have passed with the broken implementation whenever the
 * two shapes happened to agree.
 *
 * **`mediaUrls.ts` is imported rather than `media.ts`** because `media.ts` reaches
 * `expo-file-system` and therefore `react-native`, whose Flow-annotated entry
 * point a Node runner cannot parse. The tested module is the one that holds the
 * rule; `media.ts` is a two-line wrapper around it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolveMediaUrl } from '@/lib/mediaUrls';

const LOCAL = 'http://127.0.0.1:8000/api/v1';
const PROD = 'https://mahaa-backend.onrender.com/api/v1';
const EMULATOR = 'http://10.0.2.2:8000/api/v1';
const SERVED = '/api/v1/media/abc';

describe('absoluteMediaUri', () => {
  it('Test A: a local base and a served path yield the prefix exactly once', () => {
    const url = resolveMediaUrl(LOCAL, SERVED);
    expect(url).toBe('http://127.0.0.1:8000/api/v1/media/abc');
    expect(url.match(/\/api\/v1/g)).toHaveLength(1);
  });

  it('Test B: a production-shaped base does not double the prefix', () => {
    const url = resolveMediaUrl(PROD, SERVED);
    expect(url).toBe('https://mahaa-backend.onrender.com/api/v1/media/abc');
    expect(url.match(/\/api\/v1/g)).toHaveLength(1);
  });

  it('the Android emulator base behaves identically', () => {
    const url = resolveMediaUrl(EMULATOR, SERVED);
    expect(url).toBe('http://10.0.2.2:8000/api/v1/media/abc');
  });

  it('Test C: an already-absolute url is returned untouched', () => {
    expect(resolveMediaUrl(LOCAL, 'https://cdn.example.com/a/b.mp4')).toBe(
      'https://cdn.example.com/a/b.mp4',
    );
    expect(resolveMediaUrl(LOCAL, 'http://127.0.0.1:8000/api/v1/media/x')).toBe(
      'http://127.0.0.1:8000/api/v1/media/x',
    );
  });

  it('adds the prefix when the server returns a path that lacks it', () => {
    // Defensive rather than speculative: a future convention must not silently
    // produce a url with no prefix at all.
    expect(resolveMediaUrl(LOCAL, '/media/abc')).toBe(
      'http://127.0.0.1:8000/api/v1/media/abc',
    );
  });

  it('tolerates a trailing slash and a missing leading slash', () => {
    expect(resolveMediaUrl('http://127.0.0.1:8000/api/v1/', 'api/v1/media/abc')).toBe(
      'http://127.0.0.1:8000/api/v1/media/abc',
    );
  });

  it('works when the base carries no path at all', () => {
    expect(resolveMediaUrl('http://127.0.0.1:8000', SERVED)).toBe(
      'http://127.0.0.1:8000/api/v1/media/abc',
    );
  });
});
describe('one rule, reached through every media surface', () => {
  it('Test D: the post image and the avatar go through the same function', () => {
    // Both fields arrive as served paths and must resolve identically. Before the
    // fix, avatars were passed through raw while images were joined, which is how
    // the two could drift apart unnoticed.
    const post = readFileSync(fileURLToPath(new URL('../api/posts.ts', import.meta.url)), 'utf8');
    expect(post).toContain('uri: absoluteMediaUri(item.uri),');
    // The avatar now lives in the shared `mapAuthor`, which posts *and* comments
    // both use. Asserting the helper rather than one call site is what keeps a
    // third surface from re-deriving the rule — and it is the reason the helper
    // exists at all.
    expect(post).toContain('avatarUrl: wire.avatar_url ? absoluteMediaUri(wire.avatar_url) : null');
    expect(post).toMatch(/function mapAuthor\(/);
  });

  it('Test E: video playback builds its request from the same function', () => {
    const api = readFileSync(fileURLToPath(new URL('../api/media.ts', import.meta.url)), 'utf8');
    expect(api).toContain('export function absoluteMediaUri(servedAt: string): string {');
    expect(api).toContain('return resolveMediaUrl(env.apiBaseUrl, servedAt);');
    expect(api).toContain('const absolute = absoluteMediaUri(servedAt);');

    // No *second* copy of the rule. `uploadUrl` legitimately uses the full base,
    // because the upload path is relative to the base prefix; what must not
    // reappear here is the origin/path splitting the read path needs.
    expect(api).not.toContain('function originOf');
    expect(api).not.toContain('function pathOf');
  });

  it('the Home composer avatar uses the same function as everything else', () => {
    const card = readFileSync(
      fileURLToPath(new URL('../features/home/HomeComposerCard.tsx', import.meta.url)),
      'utf8',
    );
    expect(card).toContain('absoluteMediaUri(avatarUrl)');
    expect(card).not.toMatch(/apiBaseUrl/);
  });
});

/**
 * The empty-headers regression.
 *
 * **Found by the live two-user browser run, not by reasoning.** User A published
 * an image post; it arrived in User B's Home in real time with the right author
 * and the right caption, and rendered as an empty grey box. The bytes were
 * reachable — the same session fetched them with a bearer attached and got
 * `200 image/png, 96146 bytes` — and `expo-image` had issued no request at all.
 *
 * The cause is a one-character difference that no unit test could have called a
 * bug by inspection: `headers: {}` versus no `headers` key. `expo-image`'s web
 * `useHeaders` branches on truthiness, and `{}` is truthy, so an unauthenticated
 * source was treated as an authenticated one, the fetch it attempted was refused,
 * and the component rendered `null` — permanently, with no `onError` the card
 * could show.
 *
 * `media.ts` cannot be imported here (it reaches `expo-file-system` and therefore
 * `react-native`, whose Flow entry point a Node runner cannot parse), so the
 * source is read and its shape asserted. That is the same trade
 * {@link fileURLToPath} is used for above, and it is worth it: the alternative is
 * no coverage at all for a defect that shipped.
 */
describe('authenticatedImageSource: an empty headers object is a real defect', () => {
  const media = readFileSync(fileURLToPath(new URL('../api/media.ts', import.meta.url)), 'utf8');

  /**
   * The file's executable code, with block and line comments removed.
   *
   * Comments are stripped because this file's own doc comment quotes the buggy
   * `headers: {}` in order to explain why it must never come back — so a naive
   * text search matches the explanation and fails forever. The property being
   * tested is about what the module *does*, not about what it says it used to do.
   */
  const code = media
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  it('does not return an empty headers object', () => {
    // The precise shape this bug was. `headers: {}` must not come back.
    expect(code).not.toMatch(/headers:\s*\{\s*\}/);
    expect(code).not.toMatch(/\?\{\s*Authorization:[^}]*\}\s*:\s*\{\s*\}/);
  });

  it('omits headers when no token is cached, rather than sending an empty set', () => {
    // The two shapes that must exist: a real header, or no key at all.
    expect(code).toContain(': { uri };');
    expect(code).toMatch(/headers\?:/);
  });

  it('every expo-image in the app goes through this one function', () => {
    // A surface that built its own source would reintroduce the empty object.
    for (const surface of [
      '../features/feed/PostMedia.tsx',
      '../features/feed/MediaViewer.tsx',
      '../components/ui/Avatar.tsx',
      '../features/onboarding/PhotoStep.tsx',
    ]) {
      const source = readFileSync(fileURLToPath(new URL(surface, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      expect(source, surface).toContain('authenticatedImageSource(');
      expect(source, surface).not.toMatch(/headers:\s*\{\s*\}/);
    }
  });

  /**
   * The second half of the same defect.
   *
   * Omitting the empty object stops `expo-image` from hanging, but on its own it
   * is not enough: the source is built during a synchronous render while the token
   * is mirrored into memory asynchronously, so the first render still produces a
   * headerless source. Without something telling React to rebuild it when the
   * token lands, the image stays blank and now fails *silently* instead of
   * loudly. The live run had both halves — the empty frame, and a session that
   * could fetch the very same bytes with a header attached.
   */
  it('the token cache notifies, so surfaces rebuild their source when it lands', () => {
    expect(code).toMatch(/export function subscribeMediaAuth\(/);
    expect(code).toMatch(/export function getMediaAuthVersion\(/);
    // Both mutators must notify, or a sign-out would leave stale media readable.
    expect(code).toMatch(/primeMediaAuth[\s\S]*?notifyMediaAuthChanged\(\)/);
    expect(code).toMatch(/clearMediaAuth[\s\S]*?notifyMediaAuthChanged\(\)/);
  });

  it('the surfaces that read private bytes subscribe to that store', () => {
    for (const surface of ['../features/feed/PostMedia.tsx', '../components/ui/Avatar.tsx']) {
      const source = readFileSync(fileURLToPath(new URL(surface, import.meta.url)), 'utf8');
      expect(source, surface).toContain('useSyncExternalStore(subscribeMediaAuth');
      expect(source, surface).toContain('getMediaAuthVersion');
    }
  });
});
