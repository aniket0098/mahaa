/**
 * The screen-space rectangle of the story bubble that opened the viewer.
 *
 * A module store, not React state: the bubble measures itself at press time
 * (on one screen) and the viewer reads the value at close time (on another),
 * and no component subscribes to it — it is a one-shot fact about the last
 * open, read once per close. Stale values are harmless: the viewer falls back
 * to a centred shrink-and-fade when no origin was recorded (deep links,
 * hardware-back without a measured tap).
 */

export interface StoryOrigin {
  /** Left edge in window coordinates, from `measureInWindow`. */
  readonly x: number;
  /** Top edge in window coordinates. */
  readonly y: number;
  /** Bubble width in the same units. */
  readonly width: number;
  /** Bubble height in the same units. */
  readonly height: number;
}

let current: StoryOrigin | null = null;

/** Recorded by the bubble at press time, read by the viewer at close time. */
export function setStoryOrigin(origin: StoryOrigin): void {
  current = origin;
}

/** The recorded rectangle, or null when the open was not measured. */
export function getStoryOrigin(): StoryOrigin | null {
  return current;
}
