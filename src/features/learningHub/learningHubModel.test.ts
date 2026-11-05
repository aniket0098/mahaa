/**
 * learningHubModel — the pure decisions behind the Learning Hub Home feed.
 *
 * Every branch reads only what the server actually said: a failed fetch is a
 * failed fetch (never relabelled as an empty feed), cached rows survive a failed
 * refresh with the failure surfaced beside them, and the feed pairs each course
 * detail with its catalogue row in request order. These tests pin that logic in
 * Node — no network, no React.
 */
import { describe, expect, it } from 'vitest';

import {
  FEED_COURSE_LIMIT,
  buildLectureFeed,
  categoriesFromCourses,
  hubErrorMessage,
  hubFeedView,
  isVideoLecture,
  pickFeaturedLecture,
  type HubFeedInput,
  type LectureFeedItem,
} from '@/features/learningHub/learningHubModel';
import type { Course, CourseDetail, CourseLecture } from '@/types/course';

function lecture(overrides: Partial<CourseLecture> = {}): CourseLecture {
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

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: 'course-1',
    title: 'Course One',
    slug: 'course-one',
    description: null,
    category: 'Design',
    skill_level: 'beginner',
    language: 'English',
    estimated_duration_minutes: null,
    is_free: true,
    price: null,
    price_currency: null,
    thumbnail_media_id: null,
    instructor: { id: 'inst-1', name: 'Instructor', public_id: 'pub-1' },
    created_at: '2026-01-01T00:00:00Z',
    published_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function detail(base: Course, lectures: CourseLecture[]): CourseDetail {
  return {
    ...base,
    sections: [
      { id: 'sec-1', title: 'Section 1', description: null, position: 0, lectures },
    ],
  };
}

function feedItem(overrides: Partial<LectureFeedItem> = {}): LectureFeedItem {
  return {
    lectureId: 'lec-1',
    title: 'Lesson',
    kind: 'hosted_video',
    durationSeconds: null,
    isPreview: false,
    courseId: 'course-1',
    courseTitle: 'Course One',
    category: 'Design',
    instructorName: 'Instructor',
    ...overrides,
  };
}

function baseInput(overrides: Partial<HubFeedInput> = {}): HubFeedInput {
  return {
    coursesHasData: false,
    coursesLoading: false,
    coursesError: null,
    detailsPending: 0,
    detailsFailed: 0,
    detailError: null,
    items: [],
    ...overrides,
  };
}

describe('isVideoLecture', () => {
  it('treats both video kinds as video and reading as not', () => {
    expect(isVideoLecture('hosted_video')).toBe(true);
    expect(isVideoLecture('external_video')).toBe(true);
    expect(isVideoLecture('reading')).toBe(false);
  });
});

describe('buildLectureFeed', () => {
  it('flattens in catalogue order then curriculum order, carrying course context', () => {
    const c1 = course({ id: 'c1', category: 'Design' });
    const c2 = course({ id: 'c2', category: 'Business' });
    const d1 = detail(c1, [lecture({ id: 'l1', title: 'A' }), lecture({ id: 'l2', title: 'B' })]);
    const d2 = detail(c2, [lecture({ id: 'l3', title: 'C' })]);

    const items = buildLectureFeed([c1, c2], [d1, d2]);

    expect(items.map((item) => item.lectureId)).toEqual(['l1', 'l2', 'l3']);
    expect(items[0]).toMatchObject({
      courseId: 'c1',
      courseTitle: 'Course One',
      category: 'Design',
      instructorName: 'Instructor',
      durationSeconds: null,
    });
    expect(items[2].courseId).toBe('c2');
    expect(items[2].category).toBe('Business');
  });

  it('skips a course whose detail has not arrived rather than inventing context', () => {
    const c1 = course({ id: 'c1' });
    const c2 = course({ id: 'c2' });
    const d1 = detail(c1, [lecture({ id: 'l1' })]);

    expect(buildLectureFeed([c1, c2], [d1, undefined]).map((i) => i.lectureId)).toEqual(['l1']);
    expect(buildLectureFeed([c1], [null])).toEqual([]);
    expect(buildLectureFeed([], [])).toEqual([]);
  });

  it('keeps a real duration as-is and a missing duration as null', () => {
    const c1 = course({ id: 'c1' });
    const d1 = detail(c1, [
      lecture({ id: 'l1', duration_seconds: 42 }),
      lecture({ id: 'l2', duration_seconds: null }),
    ]);

    const items = buildLectureFeed([c1], [d1]);
    expect(items[0].durationSeconds).toBe(42);
    // NULL means unknown, never zero.
    expect(items[1].durationSeconds).toBeNull();
  });
});

describe('pickFeaturedLecture', () => {
  it('prefers a preview video, then any video, then any preview, then the first', () => {
    const videoPreview = feedItem({ lectureId: 'video-preview', kind: 'hosted_video', isPreview: true });
    const video = feedItem({ lectureId: 'video', kind: 'hosted_video', isPreview: false });
    const readingPreview = feedItem({ lectureId: 'reading-preview', kind: 'reading', isPreview: true });

    expect(pickFeaturedLecture([readingPreview, video, videoPreview])).toBe(videoPreview);
    // No preview video: a plain video beats a reading preview.
    expect(pickFeaturedLecture([readingPreview, video])).toBe(video);
    // No video at all: the preview wins.
    expect(
      pickFeaturedLecture([feedItem({ kind: 'reading', isPreview: false }), readingPreview]),
    ).toBe(readingPreview);
    // Nothing special: the first lecture.
    expect(pickFeaturedLecture([feedItem({ lectureId: 'only' })])?.lectureId).toBe('only');
  });

  it('returns null for an empty feed', () => {
    expect(pickFeaturedLecture([])).toBeNull();
  });
});

describe('categoriesFromCourses', () => {
  it('counts categories from the loaded page and ignores a null category', () => {
    const categories = categoriesFromCourses([
      course({ category: 'Design' }),
      course({ category: 'Design' }),
      course({ category: 'Business' }),
      course({ category: null }),
    ]);

    expect(categories).toHaveLength(2);
    const design = categories.find((chip) => chip.id === 'Design');
    expect(design).toMatchObject({ name: 'Design', course_count: 2 });
    const business = categories.find((chip) => chip.id === 'Business');
    expect(business).toMatchObject({ name: 'Business', course_count: 1 });
  });

  it('returns an empty list when no course carries a category', () => {
    expect(categoriesFromCourses([course({ category: null })])).toEqual([]);
  });
});

describe('hubErrorMessage', () => {
  it('keeps a real error message and returns null otherwise', () => {
    expect(hubErrorMessage(new Error('boom'))).toBe('boom');
    expect(hubErrorMessage(new Error(''))).toBeNull();
    expect(hubErrorMessage('a string')).toBeNull();
    expect(hubErrorMessage(null)).toBeNull();
    expect(hubErrorMessage(undefined)).toBeNull();
  });
});

describe('hubFeedView', () => {
  it('reports a catalogue failure with no cached data as an error, not an empty feed', () => {
    const view = hubFeedView(baseInput({ coursesError: new Error('network down') }));
    expect(view).toEqual({ kind: 'error', message: 'network down' });
  });

  it('stays loading while the catalogue or curricula are still arriving', () => {
    expect(hubFeedView(baseInput({ coursesLoading: true }))).toEqual({ kind: 'loading' });
    expect(
      hubFeedView(baseInput({ coursesHasData: true, detailsPending: 3 })),
    ).toEqual({ kind: 'loading' });
  });

  it('serves real rows as ready, with the featured selection', () => {
    const view = hubFeedView(baseInput({ coursesHasData: true, items: [feedItem()] }));
    expect(view.kind).toBe('ready');
    if (view.kind === 'ready') {
      expect(view.items).toHaveLength(1);
      expect(view.featured?.lectureId).toBe('lec-1');
      expect(view.refreshError).toBeNull();
    }
  });

  it('keeps real rows on screen when a refresh fails, surfacing the failure beside them', () => {
    const view = hubFeedView(
      baseInput({ coursesHasData: true, items: [feedItem()], coursesError: new Error('stale refresh') }),
    );
    expect(view.kind).toBe('ready');
    if (view.kind === 'ready') {
      expect(view.items).toHaveLength(1);
      expect(view.refreshError).toBe('stale refresh');
    }
  });

  it('reports a total curriculum failure as an error when the catalogue itself was fine', () => {
    const view = hubFeedView(
      baseInput({ coursesHasData: true, detailsFailed: 3, detailError: new Error('detail boom') }),
    );
    expect(view).toEqual({ kind: 'error', message: 'detail boom' });
  });

  it('returns an empty feed only when the server genuinely answered with nothing', () => {
    expect(hubFeedView(baseInput({ coursesHasData: true }))).toEqual({
      kind: 'empty',
      refreshError: null,
    });
  });

  it('keeps a cached empty page while surfacing the refresh failure', () => {
    const view = hubFeedView(
      baseInput({ coursesHasData: true, coursesError: new Error('refresh fail') }),
    );
    expect(view).toEqual({ kind: 'empty', refreshError: 'refresh fail' });
  });
});

describe('FEED_COURSE_LIMIT', () => {
  it('is a small bounded slice of the catalogue page', () => {
    expect(FEED_COURSE_LIMIT).toBeGreaterThan(0);
    expect(FEED_COURSE_LIMIT).toBeLessThanOrEqual(20);
  });
});
