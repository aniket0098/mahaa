/**
 * Sharing — the one feed action that can genuinely work without a backend.
 *
 * This is the platform half: it opens the system share sheet. The rules about
 * *what* may be shared live in the pure `sharePayload.ts` module, which the tests
 * load instead of this one.
 *
 * `Share.share` is unavailable on some web targets, so the outcome is returned
 * rather than swallowed, and the card shows a persistent inline notice instead of
 * a toast. A user dismissing the sheet is not a failure: they already know what
 * they did.
 */

import { Share } from 'react-native';

import type { FeedPost } from './feedModel';
import { buildSharePayload } from './sharePayload';

export interface ShareOutcome {
  ok: boolean;
  /** Shown to the user when sharing could not start. Empty when it could. */
  errorMessage: string;
}

/** Opens the platform share sheet with the post's real content. */
export async function sharePost(post: FeedPost): Promise<ShareOutcome> {
  const payload = buildSharePayload(post);

  try {
    await Share.share(payload);
    return { ok: true, errorMessage: '' };
  } catch (error) {
    const dismissed =
      typeof error === 'object' &&
      error !== null &&
      String((error as { message?: string }).message ?? '')
        .toLowerCase()
        .includes('dismiss');

    if (dismissed) return { ok: true, errorMessage: '' };

    return {
      ok: false,
      errorMessage:
        'Sharing did not start on this device. On the web, sharing needs a browser that supports ' +
        'the system share sheet.',
    };
  }
}
