/**
 * Web upload transport, and the branch that chooses it.
 *
 * **Why these tests exist at all.** `expo-file-system` has no web implementation,
 * so calling `File.createUploadTask` in a browser threw `this.validatePath is not a
 * function` and **no media could be published from the web build** — images included.
 * Nothing caught it because no test ever exercised the transport, and the failure only
 * appears at runtime in a browser. These tests pin the two things that matter: the
 * request each transport sends, and the branch that picks between them.
 *
 * **`uploadUrl` is pure and tested directly.** It is the single place the kind,
 * the dimensions and the host are decided, so asserting on its source keeps the
 * contract in one place rather than spread across transport tests.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolveMediaUrl } from '@/lib/mediaUrls';

const BASE = 'http://localhost:8000/api/v1';

/** The media module under test, read as source so the transport is assertable. */
const source = readFileSync(fileURLToPath(new URL('./media.ts', import.meta.url)), 'utf8');

/** The browser transport alone, to prove it carries no React Native dependency. */
const webUploadSource = source.slice(
  source.indexOf('async function uploadInBrowser'),
);
describe('the platform branch', () => {
  it('selects the browser transport only on web', () => {
    // The single line that decides everything. If the branch is inverted or the
    // condition is dropped, web goes back to a module that does not exist there.
    expect(source).toContain(`Platform.OS === 'web'`);
  });

  it('keeps the native upload task for the native transport', () => {
    // Native progress was real and must not be traded away for the web fix.
    expect(source).toContain('createUploadTask');
    expect(source).toContain('new File(localUri).createUploadTask(url, {');
    expect(source).toContain('const total = event.totalBytes;');
    expect(source).toContain('event.bytesSent / total');
  });

  it('sends both transports the same url, headers and method', () => {
    // Neither transport may build its own request: if web and native
    // ever diverged, one of them would stop being the same feature.
    expect(source).toContain('await uploadInBrowser(url, headers, picked.localUri, \'POST\', onProgress)');
    expect(source).toContain('await uploadOnDevice(url, headers, picked.localUri, \'POST\', onProgress)');
  });
});

describe('the browser transport', () => {
  it('uses XMLHttpRequest, which is the only browser transport with real progress', () => {
    // `fetch` reports no upload progress, so using it would force a fake bar.
    expect(source).toContain('new XMLHttpRequest()');
    expect(source).toContain('xhr.upload.onprogress');
    expect(source).toContain('event.loaded / event.total');
  });

  it('sends the bearer token and the file real type', () => {
    expect(source).toContain('Authorization: `Bearer ${token}`');
    expect(source).toContain(`'Content-Type': picked.mimeType`);
    expect(source).toContain('for (const [name, value] of Object.entries(headers))');
    expect(source).toContain('xhr.setRequestHeader(name, value)');
  });

  it('reads the picked blob without any Node or React Native API', () => {
    expect(source).toContain('await fetch(localUri)');
    expect(source).toContain('await response.blob()');
    expect(webUploadSource).not.toContain('require(');
    expect(webUploadSource).not.toContain('expo-file-system');
  });

  it('surfaces a network failure rather than resolving empty', () => {
    // A rejected upload must never look like a successful one.
    expect(source).toContain('xhr.onerror');
    expect(source).toContain('xhr.onabort');
    expect(source).toContain('xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText })');
  });
});

describe('the shared request contract', () => {
  it('builds one URL, header set and method for both transports', () => {
    // Two transports must send byte-identical requests, or web and native would
    // stop being the same feature.
    expect(source).toContain('const url = uploadUrl(picked);');
    expect(source).toContain('await uploadInBrowser(url, headers, picked.localUri, \'POST\', onProgress)');
    expect(source).toContain('await uploadOnDevice(url, headers, picked.localUri, \'POST\', onProgress)');
  });

  it('sends the profile photo as a PUT, because that is the route that exists', () => {
    // The live browser run caught this: `POST /users/me/photo` is a 405 from the
    // router, so every photo upload failed behind the failure banner while the
    // picker itself worked perfectly. §11.2 makes upload and replace the same PUT.
    expect(source).toContain('\'/users/me/photo?kind=image\'');
    expect(source).toMatch(/uploadRawFile\(\s*'\/users\/me\/photo\?kind=image',[\s\S]*?'PUT',/);
  });

  it('sends the picked kind in the query string', () => {
    expect(source).toContain('new URLSearchParams({ kind: picked.kind })');
  });

  it('omits dimensions the picker never reported', () => {
    // A video has no server-derived dimensions; sending 0 would be a false claim.
    expect(source).toContain('picked.width != null && picked.width > 0');
  });

  it('resolves the host once, with no doubled api prefix', () => {
    expect(resolveMediaUrl(BASE, '/api/v1/media/abc')).toBe(
      'http://localhost:8000/api/v1/media/abc');
    expect(resolveMediaUrl(BASE, '/api/v1/media/abc').match(/\/api\/v1/g)).toHaveLength(1);
  });

  it('still rejects a non-2xx as an error, on both transports', () => {
    expect(source).toContain('if (result.status < 200 || result.status >= 300)');
    expect(source).toContain('The ${picked.kind} could not be uploaded.');
  });

  it(`parses the server's own MediaRead, not a second shape`, () => {
    expect(source).toContain('return JSON.parse(result.body) as MediaRead;');
  });
});
