/**
 * Composer model — the pure rules behind the Create Post screen.
 *
 * Everything here is plain data and pure functions: no React, no React Native, no
 * API import. That is what lets `composerModel.test.ts` prove the rules that
 * matter — a post cannot be published empty, Publish stays disabled until it is
 * valid, the counter matches the server's limit, and the video option is disabled
 * with a stated reason rather than hidden or half-built.
 *
 * **The video type is deliberately unavailable.** Video upload needs a
 * server-side duration check, and the API publishes
 * `video_duration_enforced: false` because no decoder is installed. So the option
 * is shown, clearly marked, and cannot be selected — rather than letting someone
 * pick it and hit a wall, or hiding a type the roadmap has.
 */

import type { CreatePostInput, WireAchievement, WireProject } from '@/api/posts';

export type ComposerType = 'text' | 'image' | 'video' | 'project' | 'achievement';

export interface ComposerTypeOption {
  readonly value: ComposerType;
  readonly label: string;
  readonly hint: string;
  readonly icon: { readonly ios: string; readonly android: string };
  /** False only for video, and only while the server cannot verify a duration. */
  readonly enabled: boolean;
  /** Why it is unavailable. Shown verbatim; never blank. */
  readonly unavailableReason?: string;
}

export const VIDEO_UNAVAILABLE_REASON =
  'Video uploads arrive with the next stage — a 30-second limit needs a server-side duration check that does not exist yet.';

export const COMPOSER_TYPES: readonly ComposerTypeOption[] = [
  {
    value: 'text',
    label: 'Text',
    hint: 'Share a thought or a question',
    icon: { ios: 'text.alignleft', android: 'notes' },
    enabled: true,
  },
  {
    value: 'image',
    label: 'Images',
    hint: 'Up to 10 images from your gallery',
    icon: { ios: 'photo.on.rectangle', android: 'photo_library' },
    enabled: true,
  },
  {
    value: 'video',
    label: 'Video',
    hint: 'A short demo of your work',
    icon: { ios: 'video', android: 'videocam' },
    enabled: false,
    unavailableReason: VIDEO_UNAVAILABLE_REASON,
  },
  {
    value: 'project',
    label: 'Project',
    hint: 'Showcase something you built',
    icon: { ios: 'hammer', android: 'build' },
    enabled: true,
  },
  {
    value: 'achievement',
    label: 'Achievement',
    hint: 'A certificate, award, or course',
    icon: { ios: 'rosette', android: 'workspace_premium' },
    enabled: true,
  },
];

/** The limits the server publishes, defaulted to the documented values. */
export interface ComposerLimits {
  readonly maxBodyChars: number;
  readonly maxItems: number;
  readonly maxImageBytes: number;
  readonly imageMimeTypes: readonly string[];
  readonly videoDurationEnforced: boolean;
}

export const DEFAULT_LIMITS: ComposerLimits = {
  maxBodyChars: 5000,
  maxItems: 10,
  maxImageBytes: 8 * 1024 * 1024,
  imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  videoDurationEnforced: false,
};

/** One picked image, before it is uploaded. */
export interface DraftMedia {
  readonly localUri: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
}

export interface DraftProject {
  title: string;
  description: string;
  technologies: string;
  category: string;
  status: string;
  team: string;
  sourceUrl: string;
  liveUrl: string;
}

export interface DraftAchievement {
  title: string;
  issuer: string;
  achievedOn: string;
  description: string;
  verificationUrl: string;
}

export interface Draft {
  type: ComposerType;
  body: string;
  project: DraftProject;
  achievement: DraftAchievement;
  media: DraftMedia[];
}

export function emptyProject(): DraftProject {
  return {
    title: '',
    description: '',
    technologies: '',
    category: '',
    status: '',
    team: '',
    sourceUrl: '',
    liveUrl: '',
  };
}

export function emptyAchievement(): DraftAchievement {
  return { title: '', issuer: '', achievedOn: '', description: '', verificationUrl: '' };
}

export function emptyDraft(): Draft {
  return {
    type: 'text',
    body: '',
    project: emptyProject(),
    achievement: emptyAchievement(),
    media: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/** A URL is only accepted when it is one the card can actually open. */
export function isUsableUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true; // Empty is "not provided", not "invalid".
  return /^https?:\/\/[^\s]+$/i.test(trimmed);
}

/** Per-field messages. An empty object means the draft may be published. */
export type DraftErrors = Partial<
  Record<'body' | 'media' | 'project' | 'achievement' | 'links', string>
>;

export function validateDraft(
  draft: Draft,
  limits: ComposerLimits = DEFAULT_LIMITS,
): DraftErrors {
  const errors: DraftErrors = {};
  const body = draft.body.trim();

  if (draft.type === 'text' && !body) {
    errors.body = 'Write something before publishing.';
  }

  if (draft.type === 'image') {
    if (draft.media.length === 0) {
      errors.media = 'Add at least one image, or write a caption.';
    } else if (draft.media.length > limits.maxItems) {
      errors.media = `A post can have up to ${limits.maxItems} images.`;
    }
  }

  if (draft.type === 'project') {
    if (!draft.project.title.trim()) {
      errors.project = 'Give the project a title.';
    } else if (!draft.project.description.trim()) {
      errors.project = 'Describe what you built.';
    }
    const urls = [draft.project.sourceUrl, draft.project.liveUrl].filter((value) => value.trim());
    if (urls.some((value) => !isUsableUrl(value))) {
      errors.links = 'Links must start with http:// or https://';
    }
  }

  if (draft.type === 'achievement') {
    if (!draft.achievement.title.trim()) {
      errors.achievement = 'Name the achievement or certificate.';
    }
    if (draft.achievement.verificationUrl.trim() && !isUsableUrl(draft.achievement.verificationUrl)) {
      errors.links = 'Links must start with http:// or https://';
    }
  }

  if (body.length > limits.maxBodyChars) {
    errors.body = `Keep it under ${limits.maxBodyChars} characters.`;
  }

  return errors;
}

/** Whether Publish may be pressed. The one gate the screen asks for. */
export function canPublish(draft: Draft, limits: ComposerLimits = DEFAULT_LIMITS): boolean {
  return Object.keys(validateDraft(draft, limits)).length === 0;
}

/** True when the draft holds anything worth protecting from a discard. */
export function isDirty(draft: Draft): boolean {
  if (draft.body.trim()) return true;
  if (draft.media.length > 0) return true;
  if (draft.project.title.trim() || draft.project.description.trim()) return true;
  if (draft.achievement.title.trim()) return true;
  return false;
}

/** Splits a comma-separated list into clean tags, dropping blanks. */
export function parseTechnologies(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 20);
}

/**
 * Best-effort MIME type from a file name, used **only** when the system picker
 * does not report one (`mimeType` is optional in `ImagePickerAsset`).
 *
 * The extension is not trusted for *validation* — the allow-list check still
 * runs on whatever this returns, and the server independently refuses anything
 * outside its list. It is a fallback so an image is not rejected for a missing
 * label, not a way to smuggle a type past the check.
 */
export function mimeTypeFromName(fileName?: string | null): string {
  const extension = (fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
    case 'heif':
      // The server does not accept HEIC yet, so it is reported as a type it will
      // refuse — the user gets a clear message instead of a silent failure.
      return 'image/heic';
    default:
      // Nothing to go on. The allow-list check passes (nothing is claimed) and
      // the server decides; `image/jpeg` is the most common gallery format.
      return 'image/jpeg';
  }
}

/**
 * How many more images this post type can take.
 *
 * An image post takes a gallery up to the server's item limit; a project takes
 * one cover image and an achievement one certificate image.
 */
export function remainingMediaSlots(
  type: ComposerType,
  alreadyChosen: number,
  maxItems: number,
): number {
  if (type === 'image') return Math.max(0, maxItems - alreadyChosen);
  return alreadyChosen > 0 ? 0 : 1;
}

/** Whether this post type can carry an image at all. Video cannot, yet. */
export function acceptsMedia(type: ComposerType): boolean {
  return type === 'image' || type === 'project' || type === 'achievement';
}

/**
 * The images a post may still carry once its type changes.
 *
 * Switching type has to reconcile the chosen images with what the new type can
 * hold, and this is the rule for it:
 *
 *  - **Text and video** carry none. Keeping a gallery here would upload every
 *    image and then leave it out of the request, spending the user's data for
 *    nothing.
 *  - **Project and achievement** keep exactly one — a cover or a certificate.
 *    A project with three images is not a project with a cover.
 *  - **Image** keeps everything, because that is the type that has a gallery.
 *
 * Everything the type does carry is preserved in its original order, so nothing
 * is silently reordered or re-picked. The caller reports anything that was
 * dropped and must drop the matching upload slots too.
 */
export function mediaForType(type: ComposerType, media: readonly DraftMedia[]): DraftMedia[] {
  if (!acceptsMedia(type)) return [];
  if (type === 'image') return [...media];
  return media.slice(0, 1);
}

/**
 * A picked image rejected before upload, with the reason to show — or null.
 *
 * **Unknown metadata is not a rejection.** The system picker documents
 * `fileSize` and `mimeType` as optional and `width`/`height` as "can be 0 if the
 * system did not provide the width". An earlier version of this file rejected all
 * three, which meant that on any device that omits them *every* image was
 * refused and an image post could never be published. So:
 *
 *  - an **unknown size** (0) is accepted, and the caller measures the real size
 *    from the file before uploading;
 *  - **unknown dimensions** (0) are accepted, and the card falls back to a 4:3
 *    box;
 *  - a size that is known and **over the limit** is still refused, because that
 *    is a real answer the user can act on;
 *  - a **type outside the allow-list** is still refused, since the server would
 *    reject it too and the user deserves to know before spending their data.
 */
export function validatePickedImage(
  picked: { mimeType: string; sizeBytes: number; width: number; height: number },
  limits: ComposerLimits = DEFAULT_LIMITS,
): string | null {
  if (picked.mimeType && !limits.imageMimeTypes.includes(picked.mimeType)) {
    const allowed = limits.imageMimeTypes
      .map((type) => type.replace('image/', '').toUpperCase())
      .join(', ');
    return `That image type is not supported. Use ${allowed}.`;
  }

  // Only a size we actually know can be compared with the ceiling.
  if (picked.sizeBytes > limits.maxImageBytes) {
    return `That image is larger than ${Math.floor(limits.maxImageBytes / (1024 * 1024))} MB.`;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Upload state machine                                                        */
/* -------------------------------------------------------------------------- */

export type UploadStatus = 'waiting' | 'uploading' | 'done' | 'failed';

export interface UploadSlot {
  readonly localUri: string;
  readonly status: UploadStatus;
  /** 0..1, only ever set from a real progress event. */
  readonly fraction: number;
  /** The server's media id, present only once the server has confirmed. */
  readonly mediaId?: string;
  readonly errorMessage?: string;
}

export function initialSlots(media: readonly DraftMedia[]): UploadSlot[] {
  return media.map((item) => ({ localUri: item.localUri, status: 'waiting', fraction: 0 }));
}

export function withStatus(
  slots: readonly UploadSlot[],
  localUri: string,
  patch: Partial<Omit<UploadSlot, 'localUri'>>,
): UploadSlot[] {
  return slots.map((slot) => (slot.localUri === localUri ? { ...slot, ...patch } : slot));
}

/**
 * True once every slot is confirmed by the server.
 *
 * This is a *state*, not a gate: it describes whether the media is already
 * uploaded so the screen can show it, and it is deliberately **not** what enables
 * the Publish button. See `canSubmit`.
 */
export function allUploaded(slots: readonly UploadSlot[]): boolean {
  return slots.every((slot) => slot.status === 'done' && Boolean(slot.mediaId));
}

/**
 * The confirmed media ids, **in the order the user arranged the images**.
 *
 * A slot only counts once the server has answered, so a half-finished upload is
 * never submitted and a failed one is never silently dropped from the post.
 */
export function confirmedMediaIds(
  slots: readonly UploadSlot[],
  media: readonly DraftMedia[],
): string[] {
  const byUri = new Map(slots.map((slot) => [slot.localUri, slot]));
  return media
    .map((item) => byUri.get(item.localUri))
    .filter((slot): slot is UploadSlot => slot?.status === 'done' && Boolean(slot.mediaId))
    .map((slot) => slot.mediaId as string);
}

/**
 * Whether the Publish button may be pressed right now.
 *
 * The gate is **the draft being valid, not the uploads being finished** — the
 * uploads start inside `publish()`. An earlier version also required every upload
 * slot to be `done`, which could never become true: slots begin as `waiting` and
 * only turn into `done` during the very press the gate was blocking. That
 * deadlocked the button, so no image post, project cover, or certificate could
 * ever be published while a text post worked normally.
 *
 * So a valid draft with a chosen-but-unuploaded image is publishable, and
 * `publish()` uploads first, then sends the post. A slot that failed last time is
 * retried by the same press, which is what makes the retry path work at all.
 * Double taps are prevented by the caller's busy state, not by this function.
 */
export function canSubmit(draft: Draft, limits: ComposerLimits = DEFAULT_LIMITS): boolean {
  return canPublish(draft, limits);
}

/* -------------------------------------------------------------------------- */
/* Request shaping                                                             */
/* -------------------------------------------------------------------------- */

function toWireProject(project: DraftProject): WireProject {
  return {
    title: project.title.trim(),
    description: project.description.trim() || null,
    technologies: parseTechnologies(project.technologies),
    category: project.category.trim() || null,
    status: project.status.trim() || null,
    team: project.team.trim() || null,
    role: null,
    source_url: project.sourceUrl.trim() || null,
    live_url: project.liveUrl.trim() || null,
  };
}

function toWireAchievement(achievement: DraftAchievement): WireAchievement {
  return {
    title: achievement.title.trim(),
    issuer: achievement.issuer.trim() || null,
    achieved_on: achievement.achievedOn.trim() || null,
    description: achievement.description.trim() || null,
    verification_url: achievement.verificationUrl.trim() || null,
  };
}

/**
 * The request body for `POST /posts`.
 *
 * Only the fields the chosen type actually uses are sent, so a text post carries
 * no empty project object and an image post carries no achievement. The body is
 * trimmed, because the server counts what it stores, not what was typed.
 *
 * A project or achievement that also has a chosen image sends `media_ids` as
 * well — that image becomes the cover or the certificate on the card. The server
 * derives the post kind from the payload and keeps the gallery either way, so
 * nothing is dropped and nothing is published as a text-only post.
 */
export function buildCreateInput(
  draft: Draft,
  slots: readonly UploadSlot[],
  limits: ComposerLimits = DEFAULT_LIMITS,
): CreatePostInput {
  const body = draft.body.trim() || null;
  const mediaIds = confirmedMediaIds(slots, draft.media);
  const media = mediaIds.length > 0 ? { mediaIds } : {};

  if (draft.type === 'project') {
    return { kind: 'project', body, project: toWireProject(draft.project), ...media };
  }
  if (draft.type === 'achievement') {
    return { kind: 'achievement', body, achievement: toWireAchievement(draft.achievement), ...media };
  }
  if (draft.type === 'image') {
    return { kind: 'image', body, mediaIds };
  }
  return { kind: 'text', body };
}


