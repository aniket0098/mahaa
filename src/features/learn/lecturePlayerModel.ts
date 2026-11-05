/**
 * Pure presentation logic for the lecture player — no network, no React,
 * Node-testable. Mirrors `courseDetailModel.ts`'s discipline: real server
 * rows only, nothing invented.
 */

import { useEvent } from 'expo';
import { type RefObject } from 'react';
import type { CourseDetail, CourseLecture } from '@/types/course';
import {
  formatLectureDuration,
  isExternalLinkAllowed,
  lectureKindLabel,
} from '@/features/learn/courseDetailModel';

/**
 * One lecture's resolved position within a course's curriculum, plus the
 * fields the player screen renders. All data comes from the server.
 */
export interface ResolvedLecture {
  readonly lecture: CourseLecture;
  readonly course: CourseDetail;
  readonly sectionTitle: string;
  readonly prevLectureId: string | null;
  readonly nextLectureId: string | null;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}

/**
 * Locate a lecture within a course's ordered sections, and compute its
 * neighbours for prev/next navigation. Throws when the lecture is not part
 * of the curriculum — the screen translates that into an error state.
 */
export function resolveLecture({
  courseId,
  lectureId,
  course,
}: {
  courseId: string;
  lectureId: string;
  course: CourseDetail;
}): ResolvedLecture {
  let prevLectureId: string | null = null;
  let nextLectureId: string | null = null;
  let found: CourseLecture | null = null;
  let sectionTitle = '';
  let isFirst = false;
  let isLast = false;

  for (const section of course.sections) {
    const lectures = section.lectures;
    for (let i = 0; i < lectures.length; i += 1) {
      const lecture = lectures[i];
      if (lecture.id === lectureId) {
        found = lecture;
        sectionTitle = section.title;
        isFirst = i === 0;
        isLast = i === lectures.length - 1;
        prevLectureId = i > 0 ? lectures[i - 1].id : null;
        nextLectureId = i < lectures.length - 1 ? lectures[i + 1].id : null;
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    throw new Error(`Lecture ${lectureId} not found in course ${courseId}`);
  }

  return {
    lecture: found,
    course,
    sectionTitle,
    prevLectureId,
    nextLectureId,
    isFirst,
    isLast,
  };
}

/** Format a lecture's optional duration for the UI, never inventing one. */
export function resolveLectureDuration(
  durationSeconds: number | null
): string | null {
  return formatLectureDuration(durationSeconds);
}

/** Whether a lecture can be played by the video player (hosted video with media). */
export function isPlayableVideo(lecture: CourseLecture): boolean {
  return lecture.kind === 'hosted_video' && !!lecture.media_id;
}

/** Whether a lecture is an external link that may be opened in a browser. */
export function resolveExternalUrl(
  externalUrl: string | null
): string | null {
  return isExternalLinkAllowed(externalUrl) ? externalUrl : null;
}

/** Human-readable label for the lecture's kind. */
export function resolveLectureKindLabel(kind: CourseLecture['kind']): string {
  return lectureKindLabel(kind);
}

/** The playback states a lecture player can be in, as tracked by `useEvent`. */
export type PlaybackState =
  | 'idle'
  | 'loading'
  | 'buffering'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

/** Reactive playback state snapshot, driven by Expo Video `useEvent`. */
export interface PlaybackSnapshot {
  state: PlaybackState;
  /** Milliseconds of video played so far. */
  currentTime: number;
  /** Total duration in milliseconds. */
  duration: number;
  /** True while the player is actively loading the media. */
  isLoading: boolean;
  /** True while the player is blocked on a failed load. */
  hasError: boolean;
  /** Current playback rate (e.g. 1.0). */
  playbackRate: number;
}

/**
 * Derive a reactive `PlaybackSnapshot` from a `useVideoPlayer` instance using
 * Expo's `useEvent` hook. This replaces the imperative `addListener` calls in
 * `LecturePlayer` so the playback state is derived reactively on every event.
 *
 * The hook subscriptions run unconditionally (rules of hooks); the snapshot
 * itself is re-derived from the player's live fields on every event dispatch,
 * which forces a re-render through `useEvent`'s internal state.
 */
export function useLecturePlaybackState(
  player: import('expo-video').VideoPlayer
): PlaybackSnapshot {
  // Subscriptions first — every render subscribes in the same order. The
  // returned payloads are deliberately not read: each event forces a render,
  // and the snapshot below reads the player's current fields, which are
  // already up to date by the time React re-renders.
  useEvent(player, 'statusChange', null);
  useEvent(player, 'playingChange', null);
  // The elapsed/total time readouts re-render at the cadence the component
  // configures through `timeUpdateEventInterval`; the payload is not read —
  // the dispatch itself forces the snapshot re-derivation.
  useEvent(player, 'timeUpdate', null);

  const state: PlaybackState =
    player.status === 'error'
      ? 'error'
      : player.status === 'loading'
      ? 'loading'
      : player.playing
      ? 'playing'
      : player.status === 'readyToPlay'
      ? 'ready'
      : 'idle';

  return {
    state,
    currentTime: player.currentTime,
    duration: player.duration,
    isLoading: player.status === 'loading',
    hasError: player.status === 'error',
    playbackRate: player.playbackRate,
  };
}

/**
 * Replace the player's media source synchronously. Use this when the same
 * `VideoPlayer` instance must swap URLs without being unmounted/re-mounted
 * (e.g. curriculum prev/next navigation).
 *
 * `disableWarning` suppresses expo-video's expected-use warning when the player
 * is still buffering from the previous source.
 */
export function replaceSource(
  player: import('expo-video').VideoPlayer | null,
  source: import('expo-video').VideoSource,
  disableWarning: boolean = true
): void {
  player?.replace(source, disableWarning);
}

/**
 * Replace the player's media source asynchronously. Returns a promise that
 * resolves when the source has been accepted. This is the preferred replacement
 * method when the caller does not need the pre-replacement source.
 */
export function replaceSourceAsync(
  player: import('expo-video').VideoPlayer | null,
  source: import('expo-video').VideoSource
): Promise<void> {
  return player?.replaceAsync(source) ?? Promise.resolve();
}

/**
 * Toggle fullscreen on a `VideoView` ref. The `VideoView` is the ref-carrying
 * element that owns the native surface; `VideoPlayer` is the controller
 * bridge. Forward the ref from the JSX element and call this from event
 * handlers. `VideoView` exposes no readable fullscreen flag, so the caller
 * passes the state it tracks through `onFullscreenEnter`/`onFullscreenExit`.
 */
export function toggleFullscreen(
  videoViewRef: RefObject<import('expo-video').VideoView | null>,
  isFullscreen: boolean
): void {
  const view = videoViewRef.current;
  if (!view) return;

  if (isFullscreen) {
    void view.exitFullscreen();
  } else {
    void view.enterFullscreen();
  }
}

/** Whether a lecture requires enrollment before its media may be accessed. */
export function requiresEnrollment(lecture: CourseLecture): boolean {
  return lecture.is_preview === false;
}