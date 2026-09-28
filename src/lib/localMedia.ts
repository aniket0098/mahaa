/**
 * Local file measurement.
 *
 * The image picker reports `fileSize` and `mimeType` as **optional**, and
 * `width`/`height` as "can be 0 if the system did not provide the width". The
 * first release of the composer treated a missing size as an empty file and
 * refused it, so on those devices every image was rejected and an image post
 * could never be published.
 *
 * This module closes that gap honestly: when the picker gives no size, the real
 * size is read from the file itself. Nothing is guessed, and a file that really
 * cannot be read still returns 0 so the caller's own check can report it.
 */

import { File } from 'expo-file-system';

/**
 * The real byte size of a local file, or 0 when it cannot be read.
 *
 * Returning 0 means "unknown", never "empty" — callers must not treat it as a
 * rejection on its own, which is precisely the bug this replaces.
 */
export function measureLocalFileSize(uri: string): number {
  try {
    const file = new File(uri);
    const size = file.size;
    return typeof size === 'number' && size > 0 ? size : 0;
  } catch {
    return 0;
  }
}
