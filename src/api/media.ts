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

import { File, UploadType } from 'expo-file-system';

import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import { tokenStorage } from '@/auth/tokenStorage';
import { env } from '@/lib/env';
import type { Me } from '@/types/onboarding';

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

/** A file the user picked, ready to upload. */
export interface PickedMedia {
  /** Local `file://` uri from the picker. */
  readonly localUri: string;
  readonly width: number;
  readonly height: number;
  readonly mimeType: string;
  readonly fileName: string;
  readonly sizeBytes: number;
}

/** Progress reported by the native upload task, 0..1. */
export type UploadProgress = { readonly fraction: number };

let cachedToken: string | null = null;

/** Loads the bearer token into the in-memory cache used for media reads. */
export async function primeMediaAuth(): Promise<void> {
  cachedToken = await tokenStorage.get();
}

/** Drops the cached token, so a signed-out user cannot read a stale feed's media. */
export function clearMediaAuth(): void {
  cachedToken = null;
}

/**
 * An `expo-image` source for a media uri, with the bearer token attached when the
 * bytes come from the API.
 *
 * A served path such as `/api/v1/media/{id}` is joined onto the configured base
 * URL — never a hard-coded host — and the token is attached, because the API only
 * serves bytes to the uploader. Any other uri (a development demo image, which is
 * a `data:` string) is passed through untouched with no header, so demo content
 * renders through the same component without pretending to be server media.
 */
export function authenticatedImageSource(uri: string): {
  uri: string;
  headers: Record<string, string>;
} {
  if (uri.startsWith(env.apiBaseUrl)) {
    return {
      uri,
      headers: cachedToken ? { Authorization: `Bearer ${cachedToken}` } : {},
    };
  }
  return { uri, headers: {} };
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
): Promise<Me> {
  const result = await uploadRawFile(
    '/users/me/photo?kind=image',
    picked,
    onProgress,
    'Your photo could not be uploaded.',
  );
  return result as Me;
}

/**
 * Remove the stored photo.
 *
 * Binds to `DELETE /users/me/photo`, which the server serves for every role and
 * which returns the updated account — so a removal is as real and as
 * re-fetchable as an upload. The UI clears only after this resolves.
 */
export function deleteProfilePhoto(): Promise<Me> {
  return apiClient.delete<Me>('/users/me/photo');
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
  await uploadRawFile(path, picked, onProgress, 'That file could not be uploaded.');
}

/**
 * The one raw-body upload, shared by the photo and document paths.
 *
 * Resolves only on a 2xx, so a caller can never treat an unfinished upload as
 * finished; a non-2xx body is parsed into the app's standard {@link ApiError} so
 * the screen shows the server's own message rather than a generic apology.
 */
async function uploadRawFile(
  path: string,
  picked: PickedMedia,
  onProgress: ((progress: UploadProgress) => void) | undefined,
  failureMessage: string,
): Promise<unknown> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new ApiError({ message: 'Your session expired. Sign in again to upload.' });
  }
  const task = new File(picked.localUri).createUploadTask(`${env.apiBaseUrl}${path}`, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${token}`,
      // The file's real type: the server rejects a generic one rather than guessing.
      'Content-Type': picked.mimeType,
    },
    onProgress: (event) => {
      const { bytesSent, totalBytes } = event;
      if (!totalBytes) return;
      onProgress?.({ fraction: bytesSent / totalBytes });
    },
  });

  const result = await task.uploadAsync();
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

/** `GET /media` — the server's own limits. */
export async function fetchMediaLimits(): Promise<MediaLimits> {
  return apiClient.get<MediaLimits>('/media');
}

/** Turns a served path into the absolute uri a media component can load. */
export function absoluteMediaUri(servedAt: string): string {
  return servedAt.startsWith('http') ? servedAt : `${env.apiBaseUrl}${servedAt}`;
}

/** Builds the upload URL, carrying the metadata as query parameters. */
function uploadUrl(picked: PickedMedia): string {
  const query = new URLSearchParams({
    kind: 'image',
    width: String(picked.width),
    height: String(picked.height),
  });
  return `${env.apiBaseUrl}/media?${query.toString()}`;
}

/**
 * Uploads one image with real progress.
 *
 * Resolves only when the server has answered 2xx, so a caller can never treat an
 * unfinished upload as uploaded. A non-2xx body is parsed into the app's standard
 * {@link ApiError} so the composer shows the server's own message.
 */
export async function uploadPickedImage(
  picked: PickedMedia,
  onProgress?: (progress: UploadProgress) => void,
): Promise<MediaRead> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new ApiError({ message: 'Your session expired. Sign in again to upload.' });
  }

  const task = new File(picked.localUri).createUploadTask(uploadUrl(picked), {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${token}`,
      // The file's real type: the server rejects a generic one rather than guessing.
      'Content-Type': picked.mimeType,
    },
    onProgress: (event) => {
      // `bytesSent` / `totalBytes` are the real counters the native task reports,
      // so the fraction moves because bytes moved.
      const total = event.totalBytes;
      if (!total) return;
      onProgress?.({ fraction: event.bytesSent / total });
    },
  });

  const result = await task.uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError({
      message: 'The image could not be uploaded.',
      status: result.status,
    });
  }

  return JSON.parse(result.body) as MediaRead;
}
