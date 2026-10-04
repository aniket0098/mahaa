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
    expect(post).toContain(
      'avatarUrl: wire.author.avatar_url ? absoluteMediaUri(wire.author.avatar_url) : null',
    );
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
