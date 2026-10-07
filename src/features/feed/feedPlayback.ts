/**
 * The one feed video allowed to play.
 *
 * **A module-level singleton, deliberately, because the players live in separate
 * component instances that never see each other.** "Only one video plays at a
 * time" is a rule about the *screen*, not about any one card, so the rule has to
 * live somewhere both cards can reach.
 *
 * **It is a coordinator, not a state store.** Nothing here is React state: a
 * registering video is handed callbacks and the coordinator calls them. Holding
 * "the active video id" in component state instead would re-render every
 * subscriber on every scroll frame, which is the jank autoplay exists to remove.
 *
 * **Visibility is computed from real measurements.** Each video reports where it
 * actually is, so one plays when it is genuinely on screen rather than when a
 * card guesses.
 */

/** One video's geometry, as measured by its own card. */
export interface VideoSlot {
  /** Stable per-post id. The key every decision is made on. */
  readonly id: string;
  /** Top of the frame relative to the scroll content. */
  readonly top: number;
  /** Frame height in the same units. */
  readonly height: number;
}

/** The scroll viewport: where the reader is looking. */
export interface Viewport {
  /** Current scroll offset from the top of the content. */
  readonly offset: number;
  /** Height of the visible area. */
  readonly height: number;
}

/**
 * How much of a video must be on screen before it plays.
 *
 * **50% is deliberate rather than "any part".** A video peeking in at the bottom
 * would otherwise start playing a frame the reader cannot see, and two posts
 * half-visible mid-fling would both qualify - exactly the "two videos talking
 * over each other" outcome this module prevents.
 */
export const AUTOPLAY_VISIBLE_RATIO = 0.5;

/** What the coordinator tells a video to do. */
export interface PlaybackTarget {
  /** Pause without giving up the slot, e.g. when a load fails. */
  pause: () => void;
  /** Begin or resume playback. Must be safe to call when already playing. */
  play: () => void;
}

/** Returned by {@link registerVideo}; call it when the card unmounts. */
export type Unregister = () => void;

let activeId: string | null = null;

/**
 * True while the feed must stay silent — Home blurred or the app backgrounded.
 * One switch for every card, kept here so the rule cannot be forgotten by any
 * single player instance.
 */
let suspended = false;

/**
 * Measured slots, by id.
 *
 * **A `Map`, not an array.** Registering and unregistering happens constantly
 * while scrolling, and an array would make every lookup a scan per scroll frame.
 */
const slots = new Map<string, VideoSlot>();

/** The live viewport. Null until the feed reports one. */
let viewport: Viewport | null = null;

/** Every registered target, so the current one can be paused when the slot moves. */
const targets = new Map<string, PlaybackTarget>();

/** Notified when the active slot changes, so React can re-render just that card. */
const listeners = new Set<() => void>();

/**
 * How much of one slot is inside the viewport, 0..1.
 *
 * Exported and pure so the arithmetic is testable in Node without a renderer. The
 * overlap is the smaller bottom edge minus the larger top edge, over the frame's
 * height.
 *
 * A zero or negative height yields 0 rather than dividing by zero, which would
 * make the comparison below false for the wrong reason and leave a video stuck on.
 */
export function visibleRatio(slot: VideoSlot, view: Viewport): number {
  if (slot.height <= 0) return 0;

  const overlapTop = Math.max(slot.top, view.offset);
  const overlapBottom = Math.min(slot.top + slot.height, view.offset + view.height);
  const overlap = overlapBottom - overlapTop;

  if (overlap <= 0) return 0;
  return Math.min(1, overlap / slot.height);
}

/**
 * True when a slot is visible enough to play.
 *
 * An unmeasured slot reports 0 and therefore does not qualify. Guessing "yes"
 * would start playback for a card whose position is unknown, which is how a video
 * ends up playing while off screen.
 */
export function qualifiesForAutoplay(slot: VideoSlot, view: Viewport): boolean {
  return visibleRatio(slot, view) >= AUTOPLAY_VISIBLE_RATIO;
}

/**
 * Picks the single slot that should be playing.
 *
 * **When several qualify - mid-fling, or on a tablet where two posts fit - the
 * most visible one wins and the rest are paused.** Any rule returning several
 * would reintroduce overlapping audio. Returning null when nothing qualifies is
 * what makes scrolling past a video stop it rather than freeze it on.
 */
export function chooseActive(
  candidates: readonly VideoSlot[],
  view: Viewport,
): VideoSlot | null {
  let best: VideoSlot | null = null;
  let bestRatio = 0;

  for (const slot of candidates) {
    const ratio = visibleRatio(slot, view);
    if (ratio >= AUTOPLAY_VISIBLE_RATIO && ratio > bestRatio) {
      best = slot;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Recomputes which slot should play and applies the change.
 *
 * `force` re-applies the current winner even when it has not changed — the path
 * `resumePlayback` takes after a background/foreground or blur/focus cycle, where
 * the active id is already correct but the player was paused underneath it.
 */
function reconcile(force = false): void {
  if (!viewport) return;

  // Suspended (blurred or backgrounded): keep the current slot silent and decide
  // nothing new until `resumePlayback` re-opens the switch.
  if (suspended) {
    if (activeId) {
      try {
        targets.get(activeId)?.pause();
      } catch {
        // A player released underneath us is not worth failing a scroll over.
      }
    }
    return;
  }

  const nextId = chooseActive([...slots.values()], viewport)?.id ?? null;

  // The common case: a scroll frame that does not change the winner costs one
  // comparison and no player calls at all.
  if (!force && nextId === activeId) return;

  const previousId = activeId;
  activeId = nextId;

  // Pause the outgoing slot first, then start the incoming one. Releasing the
  // audio device before the next claims it keeps two players from overlapping.
  if (previousId) {
    try {
      targets.get(previousId)?.pause();
    } catch {
      // A player released underneath us is not worth failing a scroll over.
    }
  }

  if (nextId) {
    try {
      targets.get(nextId)?.play();
    } catch {
      // Autoplay being refused by the platform is not a crash.
    }
  }

  for (const listener of listeners) listener();
}

/**
 * Registers a video with the coordinator.
 *
 * Called once per mounted card. The returned unsubscribe must be called on
 * unmount: a leaked registration keeps a player "active" forever and blocks every
 * other video in the feed from playing.
 */
export function registerVideo(slot: VideoSlot, target: PlaybackTarget): Unregister {
  slots.set(slot.id, slot);
  targets.set(slot.id, target);

  // A card that mounts already on screen should start without waiting for a
  // scroll event, which is the common case on first load.
  reconcile();

  return () => {
    slots.delete(slot.id);
    targets.delete(slot.id);
    if (activeId === slot.id) activeId = null;
    // The freed slot may have been the active one, so another has to take over.
    reconcile();
  };
}

/** Reports a slot's new geometry. Cheap enough to call on every layout pass. */
export function updateVideoSlot(id: string, top: number, height: number): void {
  const current = slots.get(id);
  if (!current) return;
  if (current.top === top && current.height === height) return;

  slots.set(id, { id, top, height });
  reconcile();
}

/**
 * Reports the scroll viewport. Called on every scroll event.
 *
 * **This is the hot path, so it is deliberately cheap**: `reconcile` returns
 * immediately when the winner has not changed.
 */
export function setViewport(next: Viewport): void {
  viewport = next;
  reconcile();
}

/** The slot currently allowed to play, or null. Read by a card on render. */
export function getActiveVideoId(): string | null {
  return activeId;
}

/** Subscribes to active-slot changes. */
export function subscribePlayback(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Silences the feed: Home blurred or the app backgrounded.
 *
 * A pure function here so the coordinator stays free of React Native imports and
 * remains testable in Node — the caller (Home) wires the focus/AppState events.
 * Idempotent, so overlapping blur + background events cost exactly one pause.
 */
export function suspendPlayback(): void {
  if (suspended) return;
  suspended = true;
  if (activeId) {
    try {
      targets.get(activeId)?.pause();
    } catch {
      // A player released underneath us is not worth failing a suspend over.
    }
  }
  for (const listener of listeners) listener();
}

/**
 * Re-opens the switch after {@link suspendPlayback} and re-applies the winner, so
 * the still-visible video resumes without waiting for a scroll. No-op if not
 * suspended, which is the common case on first focus.
 */
export function resumePlayback(): void {
  if (!suspended) return;
  suspended = false;
  reconcile(true);
}

/**
 * Clears every registration.
 *
 * **Needed on sign-out**, for the same reason the query cache is cleared: a video
 * registered by the previous account's feed would otherwise stay active, leaving
 * the next account's feed with nothing that can play.
 */
export function resetPlayback(): void {
  slots.clear();
  targets.clear();
  viewport = null;
  activeId = null;
  suspended = false;
  for (const listener of listeners) listener();
  listeners.clear();
}
