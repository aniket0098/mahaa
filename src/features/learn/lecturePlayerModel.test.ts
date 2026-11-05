/**
 * lecturePlayerModel — the pure + near-pure logic behind the lecture player.
 *
 * `expo` is mocked to a no-op `useEvent`: the hook's subscriptions only force
 * re-renders in the app, and every value it returns is derived from the
 * player's live fields — which is exactly what these tests feed it. The
 * fullscreen/source helpers are exercised against plain objects that stand in
 * for the native view/player, so the contract (which method is called, in
 * which direction) is pinned in Node.
 */
import { describe, expect, it, vi } from 'vitest';

import type { CourseDetail, CourseLecture } from '@/types/course';
import {
  isPlayableVideo,
  requiresEnrollment,
  resolveExternalUrl,
  resolveLecture,
  replaceSourceAsync,
  toggleFullscreen,
  useLecturePlaybackState,
} from '@/features/learn/lecturePlayerModel';

// Hoisted above every import by vitest before the module graph resolves, so
// `lecturePlayerModel`'s `import { useEvent } from 'expo'` never loads Expo.
vi.mock('expo', () => ({ useEvent: vi.fn() }));

type Player = import('expo-video').VideoPlayer;

function player(fields: Record<string, unknown>): Player {
  return fields as unknown as Player;
}

function lecture(overrides: Partial<CourseLecture>): CourseLecture {
  return {
    id: 'lec-1',
    title: 'Lesson',
    description: null,
    position: 0,
    kind: 'hosted_video',
    media_id: 'media-1',
    external_url: null,
    duration_seconds: null,
    is_preview: false,
    status: 'published',
    ...overrides,
  };
}

function course(sections: { lectures: CourseLecture[] }[]): CourseDetail {
  return {
    id: 'course-1',
    sections: sections.map((s, i) => ({
      id: `sec-${i + 1}`,
      title: `Section ${i + 1}`,
      description: null,
      position: i,
      lectures: s.lectures,
    })),
  } as unknown as CourseDetail;
}

describe('useLecturePlaybackState', () => {
  it('derives the state from the live player fields', () => {
    const base = { playing: false, currentTime: 0, duration: 0, playbackRate: 1 };
    expect(
      useLecturePlaybackState(player({ ...base, status: 'idle' })).state,
    ).toBe('idle');
    expect(
      useLecturePlaybackState(player({ ...base, status: 'loading' })).state,
    ).toBe('loading');
    expect(
      useLecturePlaybackState(player({ ...base, status: 'readyToPlay' })).state,
    ).toBe('ready');
    expect(
      useLecturePlaybackState(
        player({ ...base, status: 'readyToPlay', playing: true }),
      ).state,
    ).toBe('playing');
    expect(
      useLecturePlaybackState(player({ ...base, status: 'error' })).state,
    ).toBe('error');
  });

  it('maps the timing, buffering, error, and rate fields onto the snapshot', () => {
    const snapshot = useLecturePlaybackState(
      player({
        status: 'readyToPlay',
        playing: false,
        currentTime: 12.5,
        duration: 90,
        playbackRate: 1.5,
      }),
    );
    expect(snapshot).toMatchObject({
      currentTime: 12.5,
      duration: 90,
      isLoading: false,
      hasError: false,
      playbackRate: 1.5,
    });
    expect(
      useLecturePlaybackState(player({ status: 'loading' })).isLoading,
    ).toBe(true);
    expect(
      useLecturePlaybackState(player({ status: 'error' })).hasError,
    ).toBe(true);
  });
});

describe('toggleFullscreen', () => {
  it('enters fullscreen through the VideoView when currently windowed', () => {
    const view = {
      enterFullscreen: vi.fn().mockResolvedValue(undefined),
      exitFullscreen: vi.fn().mockResolvedValue(undefined),
    };
    toggleFullscreen({ current: view } as never, false);
    expect(view.enterFullscreen).toHaveBeenCalledTimes(1);
    expect(view.exitFullscreen).not.toHaveBeenCalled();
  });

  it('exits fullscreen when the tracked state says fullscreen', () => {
    const view = {
      enterFullscreen: vi.fn().mockResolvedValue(undefined),
      exitFullscreen: vi.fn().mockResolvedValue(undefined),
    };
    toggleFullscreen({ current: view } as never, true);
    expect(view.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(view.enterFullscreen).not.toHaveBeenCalled();
  });

  it('does nothing when the view is not mounted', () => {
    expect(() =>
      toggleFullscreen({ current: null } as never, false),
    ).not.toThrow();
  });

describe('requiresEnrollment', () => {
  it('marks non-preview lectures as enrolment-gated', () => {
    expect(requiresEnrollment(lecture({ is_preview: false }))).toBe(true);
  });

  it('leaves previews playable without enrolment', () => {
    expect(requiresEnrollment(lecture({ is_preview: true }))).toBe(false);
  });
});

describe('isPlayableVideo', () => {
  it('admits only hosted video with real media', () => {
    expect(isPlayableVideo(lecture({ kind: 'hosted_video', media_id: 'm' }))).toBe(true);
    expect(isPlayableVideo(lecture({ kind: 'hosted_video', media_id: null }))).toBe(false);
    expect(isPlayableVideo(lecture({ kind: 'external_video', media_id: null }))).toBe(false);
    expect(isPlayableVideo(lecture({ kind: 'reading', media_id: null }))).toBe(false);
  });
});

describe('resolveExternalUrl', () => {
  it('admits only https links', () => {
    expect(resolveExternalUrl('https://example.com/v')).toBe('https://example.com/v');
    expect(resolveExternalUrl('http://example.com/v')).toBeNull();
    expect(resolveExternalUrl('file:///etc/passwd')).toBeNull();
    expect(resolveExternalUrl(null)).toBeNull();
  });
});

describe('resolveLecture', () => {
  const fixture = course([
    { lectures: [lecture({ id: 'a' }), lecture({ id: 'b' })] },
    { lectures: [lecture({ id: 'c' })] },
  ]);

  it('locates a lecture and computes its section-scoped neighbours', () => {
    const resolved = resolveLecture({ courseId: 'course-1', lectureId: 'b', course: fixture });
    expect(resolved.sectionTitle).toBe('Section 1');
    expect(resolved.prevLectureId).toBe('a');
    // Neighbours are scoped to the lecture's own section; the curriculum
    // sheet is what crosses section boundaries.
    expect(resolved.nextLectureId).toBeNull();
    expect(resolved.isFirst).toBe(false);
    expect(resolved.isLast).toBe(true);
  });

  it('marks the boundaries of the curriculum', () => {
    const first = resolveLecture({ courseId: 'course-1', lectureId: 'a', course: fixture });
    expect(first.isFirst).toBe(true);
    expect(first.prevLectureId).toBeNull();
    const last = resolveLecture({ courseId: 'course-1', lectureId: 'c', course: fixture });
    // A single-lecture section is simultaneously first and last of its section.
    expect(last.isFirst).toBe(true);
    expect(last.isLast).toBe(true);
    expect(last.nextLectureId).toBeNull();
  });

  it('throws when the lecture is not in the curriculum', () => {
    expect(() =>
      resolveLecture({ courseId: 'course-1', lectureId: 'zzz', course: fixture }),
    ).toThrow(/not found/);
  });
});

});

describe('replaceSourceAsync', () => {
  it('delegates to the player replaceAsync API', async () => {
    const replaceAsync = vi.fn().mockResolvedValue(undefined);
    await replaceSourceAsync(player({ replaceAsync }), { uri: 'file:///v.mp4' });
    expect(replaceAsync).toHaveBeenCalledWith({ uri: 'file:///v.mp4' });
  });

  it('resolves harmlessly without a player', async () => {
    await expect(replaceSourceAsync(null, { uri: 'x' })).resolves.toBeUndefined();
  });
});
