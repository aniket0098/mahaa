/**
 * Draft persistence for the Create Post screen.
 *
 * A draft survives leaving the screen and restarting the app, which is the whole
 * point: an unfinished post is never discarded silently. Storage is a small JSON
 * file in the app's document directory, written with `expo-file-system` — already
 * a dependency — rather than adding a key-value store for one record.
 *
 * This module is **file access only**. What a draft contains, and whether a
 * stored file may be restored, live in `draftCodec.ts` so those rules are unit
 * tested in Node without a device.
 *
 * Every operation here is best-effort and never throws into the screen: a draft
 * is a convenience, so failing to save one must not break the composer, and
 * failing to remove one must not block the user.
 */

import { Directory, File, Paths } from 'expo-file-system';

import { parseDraft, serializeDraft } from '@/lib/draftCodec';
import type { Draft } from '@/features/composer/composerModel';

const DIRECTORY_NAME = 'drafts';

/** The file for one user. The id is in the name, so drafts never cross accounts. */
function draftFile(userId: string): File {
  return new File(Paths.document, DIRECTORY_NAME, `post-draft-${userId}.json`);
}

/** Writes the draft. Returns whether it landed, so the screen can say so. */
export async function saveDraft(userId: string, draft: Draft): Promise<boolean> {
  try {
    const directory = new Directory(Paths.document, DIRECTORY_NAME);
    if (!directory.exists) {
      directory.create({ intermediates: true, idempotent: true });
    }

    const file = draftFile(userId);
    file.create({ overwrite: true, intermediates: true });
    file.write(serializeDraft(userId, draft, new Date().toISOString()));
    return true;
  } catch {
    return false;
  }
}

/** The stored draft for this user, or null. Never throws. */
export async function loadDraft(userId: string): Promise<Draft | null> {
  try {
    const file = draftFile(userId);
    if (!file.exists) return null;
    return parseDraft(await file.text(), userId);
  } catch {
    return null;
  }
}

/** Removes the draft. Called on publish, on discard, and on sign-out. */
export async function clearDraft(userId: string): Promise<void> {
  try {
    const file = draftFile(userId);
    if (file.exists) file.delete();
  } catch {
    // A draft that cannot be removed is not worth interrupting the user for: the
    // next save overwrites it, and the next sign-out tries again.
  }
}
