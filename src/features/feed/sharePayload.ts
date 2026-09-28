/**
 * Share payload rules — the pure half of sharing.
 *
 * Split from `sharePost.ts` on purpose, exactly as `demoStories.ts` separates
 * `shouldShowDemoStories` (pure, tested in Node) from `isDemoStoriesEnabled`
 * (reads the runtime). Importing `react-native` at module scope would make this
 * file unloadable in the test environment, and the "never invent a URL" rule is
 * precisely the rule that must be tested.
 *
 * Two rules drive it:
 *
 *  - **Never a broken URL.** A post has no URL of its own — there is no
 *    post-detail route in the app — so a link is shared **only** when the post
 *    already carries a real one. Otherwise the share is plain text.
 *  - **Attribution is always present**, so shared text is never mistaken for
 *    something the reader wrote.
 */

import type { FeedPost } from './feedModel';

/** Text appended to every share so the source of the content is clear. */
export const SHARE_ATTRIBUTION = 'Shared from MahaJob';

/** Longest body excerpt included in a share, so the message stays readable. */
export const SHARE_BODY_LIMIT = 180;

export interface SharePayload {
  /** The message body. Always carries at least the attribution line. */
  message: string;
  /**
   * A real URL the post already carries, or undefined.
   *
   * This is the field that must never be filled with a constructed address: an
   * absent link means the share is text-only, which is the honest outcome.
   */
  url?: string;
}

/**
 * The real link a post carries, if it carries one: a project's repository or
 * live demo first, then a certificate's verification URL. Returns null when the
 * record holds no link at all.
 */
export function postLinkFor(post: FeedPost): string | null {
  return (
    post.project?.sourceUrl ?? post.project?.liveUrl ?? post.achievement?.verificationUrl ?? null
  );
}

/** Builds the share payload. Pure: no platform call, no clock, no randomness. */
export function buildSharePayload(post: FeedPost): SharePayload {
  const text = [post.title, post.body]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n\n');

  const excerpt =
    text.length > SHARE_BODY_LIMIT ? `${text.slice(0, SHARE_BODY_LIMIT).trimEnd()}…` : text;

  const message = [excerpt, SHARE_ATTRIBUTION].filter((part) => part.length > 0).join('\n\n');

  const url = postLinkFor(post);
  return url ? { message, url } : { message };
}
