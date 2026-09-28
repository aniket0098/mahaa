/**
 * Draft serialisation — the pure half of draft storage.
 *
 * Split from `draftStore.ts` because that module imports `expo-file-system`, which
 * cannot be loaded in the Node test environment. Everything that decides *what* a
 * draft file contains and whether it may be restored lives here, so it is
 * unit tested without a device; `draftStore.ts` only does the file I/O.
 *
 * Three rules:
 *  - **A draft belongs to one user.** The user id is part of the record, and a
 *    file whose id does not match the signed-in user is refused — so one person's
 *    draft can never be restored into another's session.
 *  - **Only references are stored, never bytes.** Picked images are recorded by
 *    their local uri; a gallery original is never copied, moved, or deleted.
 *  - **A corrupt, partial, or newer file is treated as no draft.** Returning null
 *    opens the composer empty, which is a far better failure than a half-restore.
 */

import {
  emptyDraft,
  type ComposerType,
  type Draft,
  type DraftMedia,
} from '@/features/composer/composerModel';

/** Bumped when the shape changes; an older file is then ignored, not migrated. */
export const DRAFT_VERSION = 1;

interface StoredDraft {
  version: number;
  userId: string;
  savedAt: string;
  draft: Draft;
}

/** JSON for the on-disk record. Pure, and the only place a draft becomes text. */
export function serializeDraft(userId: string, draft: Draft, nowIso: string): string {
  const record: StoredDraft = { version: DRAFT_VERSION, userId, savedAt: nowIso, draft };
  return JSON.stringify(record);
}

function isComposerType(value: unknown): value is ComposerType {
  return (
    value === 'text' ||
    value === 'image' ||
    value === 'video' ||
    value === 'project' ||
    value === 'achievement'
  );
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readMedia(value: unknown): DraftMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const item = entry as Record<string, unknown>;
    const localUri = readString(item.localUri);
    if (!localUri) return [];
    return [
      {
        localUri,
        fileName: readString(item.fileName),
        mimeType: readString(item.mimeType),
        sizeBytes: typeof item.sizeBytes === 'number' ? item.sizeBytes : 0,
        width: typeof item.width === 'number' ? item.width : 0,
        height: typeof item.height === 'number' ? item.height : 0,
      },
    ];
  });
}

/** Parses a stored draft for this user, or returns null. Never throws. */
export function parseDraft(raw: string, userId: string): Draft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  if (record.version !== DRAFT_VERSION) return null;
  if (record.userId !== userId) return null;

  const draft = record.draft;
  if (typeof draft !== 'object' || draft === null) return null;
  const value = draft as Record<string, unknown>;
  const project = (value.project ?? {}) as Record<string, unknown>;
  const achievement = (value.achievement ?? {}) as Record<string, unknown>;

  return {
    type: isComposerType(value.type) ? value.type : emptyDraft().type,
    body: readString(value.body),
    project: {
      title: readString(project.title),
      description: readString(project.description),
      technologies: readString(project.technologies),
      category: readString(project.category),
      status: readString(project.status),
      team: readString(project.team),
      sourceUrl: readString(project.sourceUrl),
      liveUrl: readString(project.liveUrl),
    },
    achievement: {
      title: readString(achievement.title),
      issuer: readString(achievement.issuer),
      achievedOn: readString(achievement.achievedOn),
      description: readString(achievement.description),
      verificationUrl: readString(achievement.verificationUrl),
    },
    media: readMedia(value.media),
  };
}
