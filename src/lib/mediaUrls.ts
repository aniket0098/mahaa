/**
 * Media URL resolution — pure, so it can be tested without a React Native runtime.
 *
 * This mirrors `apiBaseUrl.ts`, which is a pure module for exactly the same
 * reason: `media.ts` reaches `expo-file-system`, which reaches `react-native`,
 * and the React Native entry point is Flow-annotated source that a plain Node
 * test runner cannot parse. Keeping the rule here means it is unit tested for
 * real instead of asserted by reading the source.
 *
 * **One rule, one place.** `media.ts` re-exports a thin wrapper that supplies the
 * configured base, so no caller grows a second way of building a media url.
 *
 * **Plain string work on purpose.** In React Native, `URL` resolves to a
 * hand-rolled `react-native/Libraries/Blob/URL` that never throws and parses the
 * protocol with a regex. A guard written against Node's WHATWG parser passes its
 * unit tests and then behaves differently on a device. See `apiBaseUrl.ts`.
 */

/** `scheme://authority` of an absolute http(s) url, or an empty string. */
function originOf(absolute: string): string {
  return /^([a-zA-Z][a-zA-Z\d+.-]*:\/\/[^/?#\s]+)/.exec(absolute)?.[1] ?? '';
}

/** The path component of an absolute url: '/api/v1', or an empty string. */
function pathOf(absolute: string): string {
  return (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\/[^/?#\s]+([^?#\s]*)/.exec(absolute)?.[1] ?? '').replace(
    /\/+$/,
    '',
  );
}

/**
 * Turns a server `served_at` path into a url that can actually be fetched.
 *
 * **Why the path is joined onto the origin rather than onto the base.** The server
 * stores `served_at` as a complete path from its own root (`/api/v1/media/{id}`),
 * while the configured base also ends in `/api/v1`, because that is also the
 * prefix for `/posts` and `/profile`. Concatenating the two produced
 * `.../api/v1/api/v1/media/{id}`, which the router does not match, so every
 * image, avatar and video in the app 404ed. Verified live against the local API:
 * `GET /api/v1/api/v1/media/{id}` -> 404, `GET /api/v1/media/{id}` -> 200.
 *
 * **Both shapes are handled.** A path that already repeats the base prefix joins
 * the origin; one that does not gets the prefix added. That is a join with a
 * fallback, not an assumption about one server's convention.
 *
 * **An already-absolute url is returned untouched**, so a server that starts
 * returning full urls needs no change here.
 */
export function resolveMediaUrl(apiBaseUrl: string, servedAt: string): string {
  if (/^https?:\/\//i.test(servedAt)) return servedAt;

  const basePath = pathOf(apiBaseUrl);
  const path = servedAt.startsWith('/') ? servedAt : `/${servedAt}`;

  if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) {
    return `${originOf(apiBaseUrl)}${path}`;
  }
  return `${apiBaseUrl.replace(/\/+$/, '')}${path}`;
}
