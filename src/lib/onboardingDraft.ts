/**
 * Onboarding step drafts — the half-finished step, not the finished one.
 *
 * The server owns the truth about *which step you are on* and *whether it is
 * done*; this file owns one thing the server cannot: the keystrokes in the field
 * you have not submitted yet. Without it, typing a headline and getting a call
 * would lose the headline, and "resume onboarding without losing progress" would
 * be true only for people who had not started typing.
 *
 * The rule that keeps the two from fighting: a draft is written on every change
 * and **deleted the moment the step saves successfully**. So a draft can only
 * ever hold work the server does not have, and a stale draft can never
 * overwrite what was saved. The step shown on reopen still comes from the server;
 * this only decides whether the text is already filled in.
 *
 * Keyed by user id, so two accounts on one device never see each other's drafts.
 */

import { Directory, File, Paths } from 'expo-file-system';

const DIRECTORY_NAME = 'onboarding-drafts';
const FILE_PREFIX = 'step-draft-';
const MAX_DRAFT_BYTES = 8 * 1024;

/** The field values one step has typed but not saved. */
export type StepDraft = Record<string, string | boolean | string[]>;

function draftFile(userId: string, stepKey: string): File {
  return new File(Paths.document, DIRECTORY_NAME, `${FILE_PREFIX}${userId}-${stepKey}.json`);
}

function directory(): Directory {
  return new Directory(Paths.document, DIRECTORY_NAME);
}

function isSerializable(value: unknown): value is string | boolean | string[] {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
  );
}

/** Write the in-progress values for one step. Never throws: a draft is a courtesy. */
export async function saveStepDraft(
  userId: string,
  stepKey: string,
  values: StepDraft,
): Promise<boolean> {
  try {
    const clean: StepDraft = {};
    for (const [key, value] of Object.entries(values)) {
      if (isSerializable(value)) clean[key] = value;
    }
    // An all-empty draft is not worth keeping; clearing it also stops a
    // "Skip" from leaving an empty form that would pre-fill on the way back.
    if (Object.values(clean).every((value) =>
      Array.isArray(value) ? value.length === 0 : value === '' || value === false,
    )) {
      await clearStepDraft(userId, stepKey);
      return true;
    }

    const dir = directory();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = draftFile(userId, stepKey);
    file.create({ overwrite: true, intermediates: true });
    const json = JSON.stringify({ step: stepKey, values: clean });
    if (json.length > MAX_DRAFT_BYTES) return false;
    file.write(json);
    return true;
  } catch {
    return false;
  }
}

/** The stored values for one step, or null. Never throws. */
export async function loadStepDraft(
  userId: string,
  stepKey: string,
): Promise<StepDraft | null> {
  try {
    const file = draftFile(userId, stepKey);
    if (!file.exists) return null;
    const parsed: unknown = JSON.parse(await file.text());
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('values' in parsed) ||
      typeof (parsed as { values: unknown }).values !== 'object'
    ) {
      return null;
    }
    const values = (parsed as { values: Record<string, unknown> }).values;
    const clean: StepDraft = {};
    for (const [key, value] of Object.entries(values)) {
      if (isSerializable(value)) clean[key] = value;
    }
    return clean;
  } catch {
    return null;
  }
}

/**
 * Remove one step's draft.
 *
 * Called immediately after a successful save, and on Skip — which is what
 * guarantees a draft can never hold work the server already has.
 */
export async function clearStepDraft(userId: string, stepKey: string): Promise<void> {
  try {
    const file = draftFile(userId, stepKey);
    if (file.exists) file.delete();
  } catch {
    // A draft that cannot be removed is not worth interrupting anyone for: the
    // next successful save overwrites it, and the next Skip tries again.
  }
}
