/**
 * Feed playback arithmetic — the rule that decides *which* video may play.
 *
 * **Pure and therefore testable without a renderer.** `feedPlayback.ts` is mostly
 * module state, but the decision it makes is arithmetic over rectangles, and that
 * arithmetic is what this file pins. A bug here is the one users notice first:
 * two videos talking over each other, or none playing at all.
 *
 * The threshold is asserted directly rather than through a playing/paused count,
 * because the coordinator's own state is reset between tests and asserting on it
 * would test the bookkeeping instead of the rule.
 */

import { describe, expect, it } from 'vitest';

import {
  AUTOPLAY_VISIBLE_RATIO,
  chooseActive,
  qualifiesForAutoplay,
  visibleRatio,
  type VideoSlot,
  type Viewport,
} from '@/features/feed/feedPlayback';

/** A viewport 800 tall, scrolled to `offset`. */
const view = (offset: number, height = 800): Viewport => ({ offset, height });

/** A slot 400 tall starting at `top` in the content. */
const slot = (id: string, top: number, height = 400): VideoSlot => ({ id, top, height });

describe('visibleRatio', () => {
  it('reports 1 for a slot entirely inside the viewport', () => {
    expect(visibleRatio(slot('a', 100), view(0))).toBe(1);
  });

  it('reports 0 for a slot entirely above the viewport', () => {
    // Scrolled past it: 0..400 is above a viewport that starts at 500.
    expect(visibleRatio(slot('a', 0), view(500))).toBe(0);
  });

  it('reports 0 for a slot entirely below the viewport', () => {
    expect(visibleRatio(slot('a', 1000), view(0))).toBe(0);
  });

  it('reports the fraction for a slot straddling the top edge', () => {
    // Slot 0..400, viewport 200..1000: 200 of the 400 pixels are visible.
    expect(visibleRatio(slot('a', 0), view(200))).toBe(0.5);
  });

  it('reports the fraction for a slot straddling the bottom edge', () => {
    // Slot 700..1100, viewport 0..800: the first 100 pixels are visible.
    expect(visibleRatio(slot('a', 700), view(0))).toBeCloseTo(0.25);
  });

  it('never exceeds 1 for a slot taller than the viewport', () => {
    // A 2000px video in an 800px window: 800 of its 2000 pixels are on screen, so
    // 40% of it is visible. The clamp is what stops a short window reporting a
    // ratio above 1 for a slot it can only partly show.
    expect(visibleRatio(slot('a', 0, 2000), view(0, 800))).toBeCloseTo(0.4);
    // And a slot the viewport covers completely is exactly 1, never more.
    expect(visibleRatio(slot('a', 0, 400), view(0, 800))).toBe(1);
  });

  it('reports 0 rather than dividing by zero for an unmeasured height', () => {
    // The first layout has no height yet. Returning NaN would make every
    // comparison below false for the wrong reason and leave a video stuck on.
    expect(visibleRatio(slot('a', 0, 0), view(0))).toBe(0);
    expect(visibleRatio(slot('a', 0, -50), view(0))).toBe(0);
  });
});

describe('the autoplay threshold', () => {
  it('is half the video, and that is the documented number', () => {
    // Not "any part": a peeking video must not start, and two half-visible posts
    // mid-fling must not both qualify.
    expect(AUTOPLAY_VISIBLE_RATIO).toBe(0.5);
  });

  it('qualifies a slot that is exactly half visible', () => {
    expect(qualifiesForAutoplay(slot('a', 0), view(200))).toBe(true);
  });

  it('does not qualify a slot just under half', () => {
    // Slot 780..1180 in an 800px window: only the top 20 of its 400 pixels show,
    // which is 5% - a video peeking in from the bottom must not start playing.
    expect(visibleRatio(slot('a', 780), view(0))).toBeCloseTo(0.05);
    expect(qualifiesForAutoplay(slot('a', 780), view(0))).toBe(false);
  });

  it('does not qualify an unmeasured slot, so nothing plays at an unknown position', () => {
    expect(qualifiesForAutoplay(slot('a', 0, 0), view(0))).toBe(false);
  });
});

describe('chooseActive', () => {
  it('picks the one fully visible video', () => {
    const winner = chooseActive([slot('a', 900), slot('b', 100)], view(0));
    expect(winner?.id).toBe('b');
  });

  it('picks nothing when every video is off screen', () => {
    // Scrolling past everything must stop playback rather than freeze it on.
    expect(chooseActive([slot('a', 0), slot('b', 500)], view(5000))).toBeNull();
  });

  it('picks nothing for an empty feed', () => {
    expect(chooseActive([], view(0))).toBeNull();
  });

  it('picks the MOST visible one when two both qualify', () => {
    // The tablet case: two posts fit at once. `a` is fully visible and `b` is only
    // 60%, so `b` must be paused rather than left talking over `a`.
    const a = slot('a', 100, 400); // 100..500, fully inside 0..800
    const b = slot('b', 640, 400); // 640..1040, 160 of 400 visible = 40%
    expect(chooseActive([b, a], view(0))?.id).toBe('a');
  });

  it('returns exactly one winner even when several qualify equally', () => {
    const slots = [slot('a', 0, 400), slot('b', 0, 400), slot('c', 0, 400)];
    const winner = chooseActive(slots, view(0));
    expect(winner).not.toBeNull();
    // Never an array: a rule that returned several would reintroduce the
    // overlapping-audio bug this whole module exists to prevent.
    expect(Array.isArray(winner)).toBe(false);
  });

  it('follows the reader: scrolling transfers the slot from one video to the next', () => {
    const a = slot('a', 0, 400);
    const b = slot('b', 400, 400);

    expect(chooseActive([a, b], view(0))?.id).toBe('a');
    // Once scrolled past `a`, `b` becomes the visible one — the transition the
    // coordinator turns into pause-then-play.
    expect(chooseActive([a, b], view(400))?.id).toBe('b');
  });

  it('ignores a slot with no measured height rather than dividing by zero', () => {
    const winner = chooseActive([slot('measured', 0, 400), slot('unmeasured', 0, 0)], view(0));
    expect(winner?.id).toBe('measured');
  });
});
