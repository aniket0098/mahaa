/**
 * Story draft model — the pure rules behind the Create Story screen.
 *
 * Everything here is plain data and pure functions: no React, no React Native,
 * no API import. That is what lets `storyComposerModel.test.ts` prove the rules
 * that decide whether a story may be published, without a renderer or a network.
 *
 * **A story is not a post, and this is why it is not built out of
 * `composerModel.ts`.** The two have genuinely different shapes — a post's
 * `kind` is derived from its attachments by the server, a story's `content_type`
 * is a *category* the author chooses (`job`, `internship`, `announcement`,
 * `event`) — and they go to different endpoints with different envelopes
 * (`Page` vs `FastApiPage`). Reusing the post draft would have meant one model
 * with two meanings and a `kind` field that meant two unrelated things.
 *
 * **Media is optional and single.** `StoryCreate.media_id` is one nullable id, so
 * there is no gallery, no ordering and no per-slot progress: at most one image or
 * video, uploaded with the same `uploadPickedMedia` the composer uses, so the
 * upload architecture is not duplicated — the magic-byte sniffing, the size
 * ceiling and the server's own allow-list all apply unchanged.
 */

import type { Story, StoryContentType } from '@/types/story';
import type { CreateStoryInput } from '@/api/stories';
import type { MediaKind, PickedMedia } from '@/api/media';

/**
 * The categories a story may declare, with the label the picker shows.
 *
 * **Exactly the server's `StoryContentType`, no more and no fewer.** A fifth
 * option would be a 422 on publish, so the list is read off the same vocabulary
 * the server validates against rather than invented for the UI.
 */
export const STORY_CONTENT_TYPES: readonly {
  readonly value: StoryContentType;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    value: 'announcement',
    label: 'Announcement',
    hint: 'Something worth telling everybody about',
  },
  {
    value: 'job',
    label: 'Job',
    hint: 'An opening you want people to see',
  },
  {
    value: 'internship',
    label: 'Internship',
    hint: 'An internship you are offering',
  },
  {
    value: 'event',
    label: 'Event',
    hint: 'Something happening at a date and time',
  },
];

/** The server's own caption ceiling (`StoryCreate.caption`, §10.2). */
export const MAX_STORY_CAPTION_CHARS = 2000;

/** The window a story lives for (§10.2). Fixed rather than chosen in the UI. */
export const STORY_TTL_HOURS = 24;

export interface StoryDraft {
  readonly caption: string;
  readonly contentType: StoryContentType;
  /** At most one attachment; `null` for a text-only story. */
  readonly media: PickedMedia | null;
}

export function emptyStoryDraft(): StoryDraft {
  // `announcement` is the default because it is the one category that fits
  // anything: a story about an opening can still be an announcement, whereas the
  // reverse would mislabel it.
  return { caption: '', contentType: 'announcement', media: null };
}

/**
 * What is wrong with this draft, keyed by field. Empty means publishable.
 *
 * The same shape as the post composer's `validateDraft`, for the same reason: a
 * screen asks `Object.keys(validateStoryDraft(...)).length === 0` rather than
 * re-deriving the rule, so the gate lives in exactly one place.
 */
export function validateStoryDraft(draft: StoryDraft): Record<string, string> {
  const errors: Record<string, string> = {};

  const caption = draft.caption.trim();
  if (!caption) {
    // Required server-side (`min_length=1`), so the client says it before the
    // request rather than after a 422.
    errors.caption = 'Say something before publishing your story.';
  } else if (caption.length > MAX_STORY_CAPTION_CHARS) {
    errors.caption = `Keep it under ${MAX_STORY_CAPTION_CHARS} characters.`;
  }

  if (!STORY_CONTENT_TYPES.some((option) => option.value === draft.contentType)) {
    // Not reachable through the picker, which is the point: it is the guard for a
    // restored draft carrying a value this build no longer offers.
    errors.contentType = 'Choose one of the available story types.';
  }

  return errors;
}

/** Whether Publish may be pressed. The one gate the screen asks for. */
export function canPublishStory(draft: StoryDraft): boolean {
  return Object.keys(validateStoryDraft(draft)).length === 0;
}

/**
 * The request body for `POST /stories`, or `null` when the draft cannot be sent.
 *
 * **`null` rather than a partial body**, because a half-built request would be a
 * 422 the user has to interpret. Returning `null` lets the caller disable the
 * button instead, which is what the composer already does for posts.
 *
 * The caption is trimmed because the server counts what it stores, not what was
 * typed, and `mediaId` is omitted rather than sent as `null` when there is no
 * media — see `api/stories.createStory`.
 */
export function buildStoryInput(
  draft: StoryDraft,
  mediaId?: string | null,
): CreateStoryInput | null {
  if (!canPublishStory(draft)) return null;
  return {
    contentType: draft.contentType,
    caption: draft.caption.trim(),
    mediaId: mediaId ?? null,
  };
}

/**
 * Which upload slot a picked file belongs in, from the file itself.
 *
 * The same rule the post composer uses — the picker records the choice and the
 * server decides what the bytes really are — kept here so a video is never
 * uploaded as `?kind=image` and rejected by the magic-byte check for no visible
 * reason.
 */
export function storyMediaKindFor(mimeType: string | null | undefined): MediaKind {
  return mimeType?.startsWith('video/') ? 'video' : 'image';
}

/**
 * How long the caption is, as the screen counts it.
 *
 * Exposed so the number in "12 / 2000" is the same constant the validation uses
 * rather than a second literal that could disagree with it.
 */
export function storyCaptionLength(draft: StoryDraft): number {
  return draft.caption.trim().length;
}

export type StoryRingState = 'unread' | 'viewed';

export const STORY_AUTO_ADVANCE_DURATION_MS = 5000;

export function getStoryRingState(story: Story): StoryRingState {
  return story.viewed ? 'viewed' : 'unread';
}

export function nextStoryIndex(currentIndex: number, totalStories: number): number {
  if (currentIndex + 1 >= totalStories) {
    return -1;
  }
  return currentIndex + 1;
}

export function prevStoryIndex(currentIndex: number): number {
  if (currentIndex <= 0) {
    return 0;
  }
  return currentIndex - 1;
}

export function getStoryTypeBadgeLabel(type: StoryContentType): string {
  switch (type) {
    case 'job':
      return 'Job';
    case 'internship':
      return 'Internship';
    case 'announcement':
      return 'Announcement';
    case 'event':
      return 'Event';
    default:
      return 'Update';
  }
}

export function formatStoryRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs < 60 * 1000) {
    return 'just now';
  }
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}
