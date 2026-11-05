/**
 * Lecture wiring — the player route stays honest, pinned against its source.
 *
 * The rules this file holds, each against the file that must keep them:
 *  - Playback state is derived reactively from the `VideoPlayer` through
 *    `useLecturePlaybackState` (status/playing/time events re-render; the
 *    snapshot reads live fields). The view state — loading/ready/error — is a
 *    pure derivation, including the `error` prop that carries authenticated
 *    media failures (401/403 not-enrolled, 404) into one persistent surface.
 *  - The player source is bound to the resolved `videoUri`; expo-video keys
 *    `useVideoPlayer` on the stringified source, so curriculum navigation
 *    swaps media instead of replaying a stale stream.
 *  - Fullscreen is the native VideoView API behind a ref, with the tracked
 *    state mirrored from onFullscreenEnter/onFullscreenExit — never an
 *    in-app fake expansion.
 *  - The screen calls no `fetch`: course data flows through the shared
 *    `apiClient` under `queryKeys.course(id)`, and media bytes through the
 *    authenticated `loadPlayableVideoUri` download.
 *  - Retry clears the previous failure and settles `isResolving`, so a
 *    successful retry can actually leave the error surface.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const screen = read('../../app/(candidate)/lecture/[id].tsx');
const player = read('./LecturePlayer.tsx');
const model = read('./lecturePlayerModel.ts');
const api = read('../../api/lectures.ts');

describe('playback state is derived reactively from the player', () => {
  it('takes its snapshot through the model hook, not imperative view state', () => {
    expect(player).toContain('useLecturePlaybackState(player)');
    expect(player).not.toContain('setViewState');
    expect(model).toContain("useEvent(player, 'statusChange', null)");
    expect(model).toContain("useEvent(player, 'playingChange', null)");
    expect(model).toContain("useEvent(player, 'timeUpdate', null)");
  });

  it('derives one error surface from both the resolve prop and the player', () => {
    expect(player).toContain('error != null || playback.hasError');
    // 'loading' is the pre-first-frame surface only; mid-play buffering keeps
    // the video mounted and shows the overlay instead.
    expect(player).toContain("playback.state === 'idle'");
    expect(player).toContain('playback.isLoading && currentTime <= 0');
    expect(player).toContain('onRetry={onRetry}');
    expect(player).toContain('testID="lecture-player-retry"');
  });

  it('surfaces controls on transitions from listener callbacks', () => {
    expect(player).toContain("player.addListener('statusChange'");
    expect(player).toContain("player.addListener('playingChange'");
    expect(player).toContain('const scheduleControlsHide = useCallback(');
  });
});

describe('source replacement follows curriculum navigation', () => {
  it('binds the player source to the resolved uri so the hook swaps sources', () => {
    // expo-video keys useVideoPlayer on JSON.stringify(parsedSource): a new
    // uri releases the old player and creates one for the new media.
    expect(player).toContain('videoUri ? { uri: videoUri } : null');
    expect(player).toContain('player={player}');
  });

  it('resolves each lecture through the shared authenticated download', () => {
    expect(screen).toContain('resolveLectureVideoUri(servedAt)');
    expect(screen).toContain('setVideoUri(');
    expect(api).toContain('loadPlayableVideoUri(servedAt)');
  });
});

describe('fullscreen runs through the VideoView ref', () => {
  it('wires the ref and mirrors state from the view callbacks', () => {
    expect(player).toContain('ref={videoViewRef}');
    expect(player).toContain('onFullscreenEnter={() => setIsFullscreen(true)}');
    expect(player).toContain('onFullscreenExit={() => setIsFullscreen(false)}');
    expect(player).toContain('toggleFullscreen(videoViewRef, isFullscreen)');
    expect(model).toContain('view.enterFullscreen()');
    expect(model).toContain('view.exitFullscreen()');
    // The stale claim that no native fullscreen API exists must not return.
    expect(player).not.toContain('no native fullscreen API');
  });
});

describe('enrolment denial is the server answer, shown persistently', () => {
  it('carries media resolve failures into the player with the server message', () => {
    expect(screen).toContain('error={resolveError}');
    expect(player).toContain('error?.message ??');
    expect(screen).toContain('setResolveError(');
  });

  it('keeps the preview rule in the model, never a client-side lock', () => {
    expect(model).toContain('lecture.is_preview === false');
    // The player itself never gates on enrolment — the server decides per
    // request, and its denial is the error surface above.
    expect(player).not.toContain('requiresEnrollment');
  });

  it('routes non-playable lectures to the honest non-video surface', () => {
    expect(screen).toContain('isPlayableVideo(lecture)');
    expect(screen).toContain('<LectureNonVideoSurface');
  });
});

describe('API failures stay honest', () => {
  it('course fetch failures render a persistent banner with a refetch path', () => {
    expect(screen).toContain('courseError != null || courseQuery.isError');
    expect(screen).toContain('StatusBanner');
    expect(screen).toContain('courseQuery.refetch()');
    expect(screen).not.toMatch(/[^a-zA-Z]fetch\(/);
  });

  it('shares the course cache key and one transport', () => {
    expect(screen).toContain('queryKeys.course(courseId');
    expect(api).toContain('apiClient.get<CourseDetail>');
    expect(api).not.toMatch(/[^a-zA-Z]fetch\(/);
  });

  it('retry clears the previous failure and settles the resolving flag', () => {
    expect(screen).toContain('setResolveError(null);');
    // Both the success and failure paths of the manual retry must settle
    // `isResolving`, or a successful retry would keep the skeleton up.
    const retry = screen.slice(screen.indexOf('onRetry={() => {'));
    const branch = retry.slice(0, retry.indexOf('}}'));
    expect(branch).toContain('setIsResolving(false);');
    expect(branch.indexOf('setResolveError(null);')).toBeLessThan(
      branch.indexOf('resolveLectureVideoUri'),
    );
  });
});
