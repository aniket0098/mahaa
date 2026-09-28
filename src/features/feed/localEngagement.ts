/**
 * Local engagement state — the honest stand-in for a missing engagement API.
 *
 * There is no like, bookmark, or hide endpoint (see
 * `docs/feed-api-contract.md`). Rather than render controls that pretend, the
 * feed keeps this state **on the device, for the current session only**:
 *
 *  - nothing here is transmitted — this module imports no API and no transport,
 *    so a like cannot leave the phone even by mistake (asserted by
 *    `demoIsolation.test.ts`);
 *  - nothing is persisted — reloading the app clears it, so it can never be
 *    mistaken for a stored server value;
 *  - every surface that shows it also says so, via
 *    {@link LOCAL_ENGAGEMENT_NOTE}.
 *
 * `revertLike` / `revertSave` exist because the API-backed version will be an
 * optimistic mutation that must roll back on failure. The rollback primitive and
 * its test are written now, so adding the request later does not mean inventing
 * the failure path at the same time.
 *
 * Pure module: no React, no React Native, testable in Node.
 */

/** Shown next to any state this module owns, so it is never read as server data. */
export const LOCAL_ENGAGEMENT_NOTE = 'Saved on this device only';

/** Which post ids are liked, saved, or hidden in this session. */
export interface LocalEngagementSnapshot {
  liked: ReadonlySet<string>;
  saved: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
}

const liked = new Set<string>();
const saved = new Set<string>();
const hidden = new Set<string>();

const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Ignores a blank id, so no state can be recorded against a missing post. */
function isValidId(postId: string): boolean {
  return typeof postId === 'string' && postId.trim().length > 0;
}

function toggle(set: Set<string>, postId: string): boolean {
  if (!isValidId(postId)) return false;
  if (set.has(postId)) {
    set.delete(postId);
    notify();
    return false;
  }
  set.add(postId);
  notify();
  return true;
}

/* ----------------------------------- like ---------------------------------- */

/** Toggles the like; returns the new state. A blank id changes nothing. */
export function toggleLike(postId: string): boolean {
  return toggle(liked, postId);
}

export function isLiked(postId: string): boolean {
  return liked.has(postId);
}

/** Rolls a like back to unliked — the failure path of a future API mutation. */
export function revertLike(postId: string): void {
  if (!liked.delete(postId)) return;
  notify();
}

/* ----------------------------------- save ---------------------------------- */

/** Toggles the bookmark; returns the new state. A blank id changes nothing. */
export function toggleSave(postId: string): boolean {
  return toggle(saved, postId);
}

export function isSaved(postId: string): boolean {
  return saved.has(postId);
}

/** Rolls a save back to unsaved — the failure path of a future API mutation. */
export function revertSave(postId: string): void {
  if (!saved.delete(postId)) return;
  notify();
}

/* ----------------------------------- hide ---------------------------------- */

/**
 * Hides a post for this session.
 *
 * Scoped to the session because "hide" would otherwise be a claim about a
 * server-side preference that does not exist. It is the only overflow action
 * besides Copy link that can work without a backend.
 */
export function hidePost(postId: string): void {
  if (!isValidId(postId) || hidden.has(postId)) return;
  hidden.add(postId);
  notify();
}

export function isHidden(postId: string): boolean {
  return hidden.has(postId);
}

/* ------------------------------- subscription ------------------------------ */

/** Subscribe to changes; returns the unsubscribe function. */
export function subscribeLocalEngagement(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Monotonic counter, so `useSyncExternalStore` re-renders on a real change. */
export function getLocalEngagementVersion(): number {
  return version;
}

/** The current sets, for a caller that needs all three at once. */
export function snapshotLocalEngagement(): LocalEngagementSnapshot {
  return { liked, saved, hidden };
}

/** Test-only: return the session state to the point it started from. */
export function resetLocalEngagement(): void {
  liked.clear();
  saved.clear();
  hidden.clear();
  notify();
}
