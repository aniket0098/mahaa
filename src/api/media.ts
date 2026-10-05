/**
 * Media API — upload and authenticated reads.
 *
 * Uploads are a **raw request body** (`UploadType.BINARY_CONTENT`), not JSON and
 * not multipart. That is what lets `expo-file-system` report real byte progress
 * from a native upload task — `fetch` cannot report upload progress at all, so a
 * progress bar built on it would have to be a lie.
 *
 * Reads are the mirror image: the API serves bytes only to the uploader, from
 * `GET /media/{id}`, so an image in a post card cannot be a plain public URL.
 * `expo-image` takes a `headers` property, so the same token that authorises the
 * API authorises the image.
 *
 * The bearer token is mirrored into memory here because the token store is async
 * and a render cannot await it. {@link primeMediaAuth} fills that cache; until it
 * runs, a media source is still produced (with no header) so the card renders
 * rather than throwing.
 */

import { File, Paths, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';

import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import { tokenStorage } from '@/auth/tokenStorage';
import { env } from '@/lib/env';
import { resolveMediaUrl } from '@/lib/mediaUrls';

/** What the server publishes so the client never hard-codes a copy. */
export interface MediaLimits {
  readonly max_bytes: number;
  readonly max_items_per_post: number;
  readonly max_body_chars: number;
  readonly image_mime_types: readonly string[];
  readonly video_mime_types: readonly string[];
  /** The only private-document types the server accepts (a PDF resume or certificate). */
  readonly document_mime_types: readonly string[];
  /** The document ceiling, which is lower than the video one. */
  readonly max_document_bytes: number;
  /** False until the server can decode a duration, so the UI stays honest. */
  readonly video_duration_enforced: boolean;
}

export interface MediaRead {
  readonly id: string;
  readonly kind: string;
  readonly mime_type: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly size_bytes: number;
  readonly served_at: string;
}

/**
 * The media kinds the posts API accepts. `document` exists on the server but
 * has no composer surface, so it is deliberately not offered here.
 */
export type MediaKind = 'image' | 'video';

/** A file the user picked, ready to upload. */
export interface PickedMedia {
  /** Local `file://` uri from the picker. */
  readonly localUri: string;
  /** Which media slot this is for. Drives the `kind` sent to the server. */
  readonly kind: MediaKind;
  /**
   * Intrinsic size, when the picker knew it.
   *
   * **Nullable, because the server does not derive them for video** — `MediaRead`
   * documents `width`/`height` as "null for video and documents". Sending 0
   * for a video would be a claim of a real zero-size asset, so the field is
   * honest about being unknown and the upload URL simply omits it.
   */
  readonly width: number | null;
  readonly height: number | null;
  readonly mimeType: string;
  readonly fileName: string;
  readonly sizeBytes: number;
}

/** Progress reported by the native upload task, 0..1. */
export type UploadProgress = { readonly fraction: number };

/**
 * The mirrored bearer token, and who is interested in it changing.
 *
 * **Why this is a store and not a plain variable.** `cachedToken` is filled by
 * {@link primeMediaAuth}, which is async, while every media source is built
 * during a synchronous render. So the first render of a feed card happens *before*
 * the token is in memory, and the source it captured has no `Authorization` in it.
 * With a plain variable nothing ever told React that the value had changed, so the
 * card kept that headerless source for its whole life.
 *
 * That is exactly what the live two-user browser run caught: the post arrived in
 * real time with the right author and caption, and its image stayed an empty grey
 * box while the same session could fetch those very bytes with a token attached
 * (`200 image/png, 96146 bytes`).
 *
 * Subscribers let the surfaces re-render once the token lands, so the source they
 * build on the second pass carries the header. `useSyncExternalStore` is the
 * right shape for this: the token is external mutable state, and a version counter
 * is a stable snapshot for it to compare.
 */
let cachedToken: string | null = null;
const mediaAuthListeners = new Set<() => void>();
let mediaAuthVersion = 0;

/** Called when the cached token changes, so dependents can re-read it. */
function notifyMediaAuthChanged(): void {
  mediaAuthVersion += 1;
  for (const listener of mediaAuthListeners) listener();
}

/**
 * Subscribe to the token cache. Paired with {@link getMediaAuthVersion} for
 * `useSyncExternalStore`; the returned function unsubscribes.
 */
export function subscribeMediaAuth(listener: () => void): () => void {
  mediaAuthListeners.add(listener);
  return () => {
    mediaAuthListeners.delete(listener);
  };
}

/**
 * A number that changes whenever the token cache does.
 *
 * A version rather than the token itself, because `useSyncExternalStore` requires
 * a snapshot that is cheap and referentially stable between changes, and handing
 * out the token would put a credential in a value React compares and may retain.
 */
export function getMediaAuthVersion(): number {
  return mediaAuthVersion;
}

/** Loads the bearer token into the in-memory cache used for media reads. */
export async function primeMediaAuth(): Promise<void> {
  const token = await tokenStorage.get();
  if (token === cachedToken) return;
  cachedToken = token;
  notifyMediaAuthChanged();
}

/** Drops the cached token, so a signed-out user cannot read a stale feed's media. */
export function clearMediaAuth(): void {
  if (cachedToken === null) return;
  cachedToken = null;
  notifyMediaAuthChanged();
}

/**
 * An `expo-image` source for a media uri, with the bearer token attached when the
 * bytes come from the API.
 *
 * A served path such as `/api/v1/media/{id}` is joined onto the configured base
 * URL — never a hard-coded host — and the token is attached, because the API only
 * serves bytes to authenticated callers. Any other uri (a development demo image,
 * which is a `data:` string) is passed through untouched with no header, so demo
 * content renders through the same component without pretending to be server
 * media.
 *
 * **`headers` is omitted, not returned empty, when there is no token.**
 *
 * This is not a style preference. On web, `expo-image`'s `useHeaders` asks only
 * whether `source.headers` is *truthy*, not whether it contains anything:
 *
 *   if (!source?.headers) return source;   // plain <img src>, loads or fails visibly
 *   if (!objectURL)        return null;    // renders NOTHING until the fetch resolves
 *
 * An empty object is truthy, so returning `headers: {}` took the second branch
 * with no `Authorization` to send. The request was refused, `onError` fired, and
 * the card kept an **empty grey frame forever** — no image, no error message, no
 * request the page had logged. Confirmed live in Edge against a post whose bytes
 * the same session could fetch successfully (200, `image/png`, 96146 bytes) the
 * moment a real header was attached.
 *
 * Omitting the key lets `expo-image` fall back to a plain `<img>`, which either
 * loads (a public uri) or fails loudly through `onError` — so the card's own
 * "This image could not be loaded" state can actually appear. An empty frame that
 * can never resolve and never explains itself is the one outcome to avoid.
 */
export function authenticatedImageSource(uri: string): {
  uri: string;
  headers?: Record<string, string>;
} {
  if (uri.startsWith(env.apiBaseUrl)) {
    // No token yet: return the bare uri, and let the component surface a real
    // failure rather than waiting on a request that was never authorised.
    return cachedToken
      ? { uri, headers: { Authorization: `Bearer ${cachedToken}` } }
      : { uri };
  }
  return { uri };
}

/**
 * Upload a profile photo (camera or gallery).
 *
 * **Raw request body**, like {@link uploadPickedImage}: no multipart dependency
 * on the server, and the native upload task reports genuine progress — `fetch`
 * cannot, so a progress bar built on it would have to be a lie.
 *
 * The photo is stored through the validated media path and the account then
 * points at it, so the same image is not re-uploaded for every profile view.
 *
 * **Resolves to the stored media row, NOT the account.** The server answers
 * `PUT /users/me/photo` with `MediaRead` (§11.2), which has no `avatar_url`.
 * This function used to declare `Promise<Me>` and callers wrote the result into
 * the `users/me` cache — writing an object with no `avatar_url` field into the
 * one query the whole app renders avatars from, so a photo that saved correctly
 * on the server showed up nowhere. The account is re-read instead; see
 * {@link invalidateAfterAvatarChange}.
 */
/**
 * Upload a profile photo and return the account the server stored.
 *
 * Returns the updated `Me` rather than `void` so the caller can put the real
 * `avatar_url` on screen straight away. The previous `Promise<void>` left the UI
 * with nothing to display after a successful upload, which is what tempted a
 * caller into showing a local preview as though it were already stored.
 *
 * The server replaces any existing photo, so "upload" and "replace" are the same
 * call — no delete-then-upload race that could leave a person with no photo.
 */
export async function uploadProfilePhoto(
  picked: PickedMedia,
  onProgress?: (progress: UploadProgress) => void,
): Promise<MediaRead> {
  const result = await uploadRawFile(
    '/users/me/photo?kind=image',
    picked,
    onProgress,
    'Your photo could not be uploaded.',
    // **PUT, not POST.** The route is `PUT /users/me/photo` (plus DELETE); §11.2
    // makes upload and replace the same call precisely so there is no
    // delete-then-upload race that could leave a person with no photo. A POST here
    // is a `405 Method Not Allowed` from the router, which the live browser run
    // caught: the photo picker worked, the request left, and every upload failed
    // silently behind the failure banner.
    'PUT',
  );
  // The route returns the stored asset (`MediaRead`). It is deliberately not
  // treated as an account: the caller must re-read `GET /users/me` for the new
  // `avatar_url`, because caching this row under the account's key is exactly
  // what made a saved photo invisible.
  return result as MediaRead;
}

/**
 * Remove the stored photo.
 *
 * Binds to `DELETE /users/me/photo`, which the server serves for every role and
 * which answers **204 with no body** — so unlike {@link uploadProfilePhoto} this
 * resolves to `null` and the caller must reconcile from the server rather than
 * from a returned account. The UI clears only after the delete has resolved.
 */
export function deleteProfilePhoto(): Promise<null> {
  return apiClient.delete<null>('/users/me/photo');
}

/**
 * Upload a private PDF (a resume or a certificate).
 *
 * The bytes are stored privately and served only to their owner, so this is not
 * a public link and nothing here claims the document is verified.
 */
export async function uploadDocument(
  path: string,
  picked: PickedMedia,
  onProgress?: (progress: UploadProgress) => void,
): Promise<void> {
  await uploadRawFile(path, picked, onProgress, 'That file could not be uploaded.', 'POST');
}

/**
 * The one raw-body upload, shared by the photo and document paths.
 *
 * Resolves only on a 2xx, so a caller can never treat an unfinished upload as
 * finished; a non-2xx body is parsed into the app's standard {@link ApiError} so
 * the screen shows the server's own message rather than a generic apology.
 *
 * **Two transports, one contract — and this function used to have only one.**
 * It called `File.createUploadTask` unconditionally, which is `expo-file-system`'s
 * native API with **no web implementation at all**. In a browser the call threw
 * `this.validatePath is not a function` (or, where it resolved at all, resolved
 * `status: 0`), so `PUT /users/me/photo` was never sent and the account's
 * `avatar_media_id` was never set: picking a profile photo in the web build
 * appeared to work, showed the local preview, and left the account with no avatar.
 * The composer's {@link uploadPickedMedia} had already been given a browser
 * transport for exactly this reason — see {@link uploadInBrowser} — and the photo
 * and document paths were simply missed. The dispatch below is the same one, so
 * every upload in the app now works on every platform.
 */
async function uploadRawFile(
  path: string,
  picked: PickedMedia,
  onProgress: ((progress: UploadProgress) => void) | undefined,
  failureMessage: string,
  method: UploadMethod,
): Promise<unknown> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new ApiError({ message: 'Your session expired. Sign in again to upload.' });
  }

  const url = `${env.apiBaseUrl}${path}`;
  // The file's real type: the server rejects a generic one rather than guessing.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': picked.mimeType,
  };

  const result =
    Platform.OS === 'web'
      ? await uploadInBrowser(url, headers, picked.localUri, method, onProgress)
      : await uploadOnDevice(url, headers, picked.localUri, method, onProgress);

  if (result.status < 200 || result.status >= 300) {
    throw new ApiError({ message: failureMessage, status: result.status });
  }
  // The server answers with the updated record (an avatar upload returns `MeRead`).
  // Parsed here rather than discarded, because the caller needs the stored URL to
  // display — a successful upload it cannot see is indistinguishable from a failure.
  try {
    return result.body ? JSON.parse(result.body) : null;
  } catch {
    return null;
  }
}

/** What a raw-body upload actually is: §11.2 routes are not all POSTed to. */
export type UploadMethod = 'POST' | 'PUT';

/** `GET /media` — the server's own limits. */
export async function fetchMediaLimits(): Promise<MediaLimits> {
  return apiClient.get<MediaLimits>('/media');
}

/**
 * Turns a served path into the absolute uri a media component can load.
 *
 * **A wrapper on purpose.** The rule lives in `@/lib/mediaUrls` so it can be unit
 * tested without a React Native runtime, and so there is exactly one copy of it.
 * Every media surface  images, avatars and video playback  goes through here.
 */
export function absoluteMediaUri(servedAt: string): string {
  return resolveMediaUrl(env.apiBaseUrl, servedAt);
}

/**
 * Builds the upload URL, carrying the metadata as query parameters.
 *
 * **`kind` comes from the picked file, not from the function name.** The old
 * version hard-coded `image`, so a video could only ever have been uploaded
 * as an image — the server would then have rejected on a MIME mismatch, or
 * worse, stored under the wrong kind and rendered as a broken thumbnail.
 *
 * The dimensions are a cross-check the server rejects on a mismatch, so they
 * are sent **only when actually known**. A video has none, and `0` would be
 * a false claim rather than an honest "unknown".
 */
function uploadUrl(picked: PickedMedia): string {
  const query = new URLSearchParams({ kind: picked.kind });
  if (picked.width != null && picked.width > 0 && picked.height != null && picked.height > 0) {
    query.set('width', String(picked.width));
    query.set('height', String(picked.height));
  }
  return `${env.apiBaseUrl}/media?${query.toString()}`;
}
/**
 * Turns a served media path into a URI a **video player** can actually open.
 *
 * **Why this exists at all.** `authenticatedImageSource()` solves the same problem
 * for `expo-image`, because `expo-image` takes a `headers` property. No video
 * player does: `expo-video`'s `VideoSource` is `{ uri }` with nowhere to put a
 * bearer token, and the API deliberately serves bytes **only to the uploader**
 * (`get_media` has no unsigned variant, on purpose). So the bytes have to be
 * fetched through the authenticated client *first*, and the player is handed the
 * local copy.
 *
 * **The cost is real and is not hidden:** playback cannot begin until the whole
 * file has arrived, because there is no range-request or presigned-URL mechanism
 * to stream from. That is a direct consequence of authenticating media reads,
 * not a choice made here. The server caps video at `max_bytes` (10 MB), which is
 * what makes a full download tolerable. Removing the download would mean letting
 * the player fetch the url unauthenticated, which would mean adding an unsigned
 * media route — an open door to anybody holding the id.
 *
 * On native the download lands in the cache directory through
 * `File.downloadFileAsync`, which accepts headers. On web there is no cache
 * directory, so the bytes are fetched and wrapped in an object url instead.
 */
export async function loadPlayableVideoUri(servedAt: string): Promise<string> {
  const absolute = absoluteMediaUri(servedAt);
  const token = cachedToken ?? (await tokenStorage.get());

  if (Platform.OS === 'web') {
    const response = await fetch(absolute, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      throw new ApiError({
        message: 'This video could not be loaded.',
        status: response.status,
      });
    }
    return URL.createObjectURL(await response.blob());
  }

  // `idempotent` because a re-render re-runs this, and a second download into an
  // existing path would throw rather than replace.
  const destination = new File(Paths.cache, videoCacheName(servedAt));
  if (destination.exists) destination.delete();
  const downloaded = await File.downloadFileAsync(absolute, destination, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    idempotent: true,
  });
  return downloaded.uri;
}

/** A stable cache file name for one asset, so a re-render reuses the same path. */
function videoCacheName(servedAt: string): string {
  const tail = servedAt.split('/').pop() ?? 'video';
  return `mahaa-media-${tail.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}
/**
 * Uploads one image **or one video** with real progress.
 *
 * One function for both kinds, deliberately: two upload functions would mean
 * two places that could forget the bearer token, the `Content-Type`, or the rule
 * that a non-2xx must be an error rather than a silent success.
 *
 * **Two transports, one contract.** `POST /media?kind=…` with a raw binary body
 * and a bearer token is the same on both, so the URL and the headers are built
 * once and only the transport differs:
 *
 * - **native** — `File.createUploadTask`, unchanged, because it reports real byte progress.
 * - **web** — `XMLHttpRequest`, because `expo-file-system` has no web
 *   implementation. See {@link uploadInBrowser} for why that is not a preference.
 *
 * Resolves only when the server has answered 2xx, so a caller can never treat an
 * unfinished upload as uploaded. A non-2xx body is parsed into the app's standard
 * {@link ApiError} so the composer shows the server's own message.
 */
export async function uploadPickedMedia(
  picked: PickedMedia,
  onProgress?: (progress: UploadProgress) => void,
): Promise<MediaRead> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new ApiError({ message: 'Your session expired. Sign in again to upload.' });
  }

  const url = uploadUrl(picked);
  // The file's real type: the server rejects a generic one rather than guessing.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': picked.mimeType,
  };

  const result =
    Platform.OS === 'web'
      ? await uploadInBrowser(url, headers, picked.localUri, 'POST', onProgress)
      : await uploadOnDevice(url, headers, picked.localUri, 'POST', onProgress);

  if (result.status < 200 || result.status >= 300) {
    throw new ApiError({
      message: `The ${picked.kind} could not be uploaded. Check your connection and try again.`,
      status: result.status,
    });
  }

  return JSON.parse(result.body) as MediaRead;
}

/** What both transports resolve to: the server's own answer, unparsed. */
interface UploadResult {
  readonly status: number;
  readonly body: string;
}

/**
 * The native transport: `expo-file-system`'s upload task, unchanged.
 *
 * Kept exactly as it was, because it reports genuine byte progress on the platforms
 * that need it and there was no reason to disturb it.
 */
async function uploadOnDevice(
  url: string,
  headers: Record<string, string>,
  localUri: string,
  method: UploadMethod,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  const task = new File(localUri).createUploadTask(url, {
    httpMethod: method,
    uploadType: UploadType.BINARY_CONTENT,
    headers,
    onProgress: (event) => {
      // `bytesSent` / `totalBytes` are the real counters the native task reports,
      // so the fraction moves because bytes moved.
      const total = event.totalBytes;
      if (!total) return;
      onProgress?.({ fraction: event.bytesSent / total });
    },
  });

  const result = await task.uploadAsync();
  return { status: result.status, body: result.body };
}

/**
 * The web transport: `XMLHttpRequest`, with real progress.
 *
 * **`expo-file-system` has no web implementation.** Its web build is a stub whose
 * `FileSystemFile` constructor only logs "expo-file-system is not supported on
 * web", and whose upload task resolves `status: 0`. Calling the native API there
 * therefore threw `this.validatePath is not a function` and **no media could be
 * published from the browser at all** — images included, so this is a
 * pre-existing gap rather than anything video introduced.
 *
 * **Why XHR rather than `fetch`.** `fetch` reports no upload progress at all, so a
 * progress bar built on it would have to be invented — and a fake progress bar
 * is worse than none. `xhr.upload.onprogress` reports genuine bytes sent, so the
 * composer's existing fraction is real on the web too, and the native path keeps
 * its real progress as well.
 */
async function uploadInBrowser(
  url: string,
  headers: Record<string, string>,
  localUri: string,
  method: UploadMethod,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  // The picker hands over a `blob:` uri, which the browser can already read. This
  // is why no Node or React Native API is needed on this path.
  const response = await fetch(localUri);
  const blob = await response.blob();

  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) return;
      onProgress?.({ fraction: event.loaded / event.total });
    };
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.onerror = () => reject(new ApiError({ message: 'The upload could not reach the server.' }));
    xhr.onabort = () => reject(new ApiError({ message: 'The upload was cancelled.' }));
    xhr.send(blob);
  });
}
