/**
 * myLearningModel — pure decisions for the My Learning screen.
 *
 * The state machine is honest by construction: a failed fetch is an error, an
 * empty page is a real empty list, and cached rows survive a failed refresh
 * (with the failure surfaced, never swallowed). Counts come from the server
 * envelope's `total`, never from a local tally of the rendered page.
 */
import { describe, expect, it } from 'vitest';

import { enrolledCountLabel, myLearningErrorMessage, myLearningView } from '@/features/learn/myLearningModel';
import type { EnrolledCourse } from '@/types/course';

/** One wire-shaped enrolment row; only fields the model touches are meaningful. */
function enrolledRow(id: string): EnrolledCourse {
  return {
    enrollment: {
      id: `enr-${id}`,
      course_id: id,
      status: 'active',
      created_at: '2026-03-01T10:00:00Z',
      updated_at: '2026-03-01T10:00:00Z',
    },
    course: {
      id,
      title: `Course ${id}`,
      slug: `course-${id}`,
      description: null,
      category: null,
      skill_level: null,
      language: null,
      estimated_duration_minutes: null,
      is_free: true,
      price: null,
      price_currency: null,
      thumbnail_media_id: null,
      instructor: { id: 't1', name: 'Instructor', public_id: 'inst-1' },
      created_at: '2026-01-01T00:00:00Z',
      published_at: '2026-01-01T00:00:00Z',
    },
  } as EnrolledCourse;
}

describe('myLearningView', () => {
  it('is loading while the first fetch is in flight (no data, no error)', () => {
    expect(myLearningView({ isError: false, error: null, data: undefined })).toEqual({
      kind: 'loading',
    });
  });

  it('is an error — never an empty list — when the first fetch failed', () => {
    const view = myLearningView({
      isError: true,
      error: new Error("Couldn't reach the server"),
      data: undefined,
    });
    expect(view).toEqual({ kind: 'error', message: "Couldn't reach the server" });
  });

  it('is ready with the server rows and the envelope total', () => {
    const rows = [enrolledRow('c1'), enrolledRow('c2')];
    const view = myLearningView({
      isError: false,
      error: null,
      data: { items: rows, total: 2 },
    });
    expect(view).toEqual({ kind: 'ready', items: rows, total: 2, refreshError: null });
  });

  it('is empty only when the server itself returned zero enrolments', () => {
    expect(
      myLearningView({ isError: false, error: null, data: { items: [], total: 0 } }),
    ).toEqual({ kind: 'empty', refreshError: null });
  });

  it('keeps real rows on screen when a refresh fails, and surfaces the failure', () => {
    const rows = [enrolledRow('c1')];
    const view = myLearningView({
      isError: true,
      error: new Error('offline'),
      data: { items: rows, total: 1 },
    });
    expect(view).toEqual({ kind: 'ready', items: rows, total: 1, refreshError: 'offline' });
  });

  it('never manufactures a total: it is read from the envelope, not counted', () => {
    // One row on this page, but the server says five enrolments exist overall.
    const view = myLearningView({
      isError: false,
      error: null,
      data: { items: [enrolledRow('c1')], total: 5 },
    });
    expect(view).toMatchObject({ total: 5 });
  });
});

describe('myLearningErrorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(myLearningErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns null for non-Error values and empty messages', () => {
    expect(myLearningErrorMessage('boom')).toBeNull();
    expect(myLearningErrorMessage(null)).toBeNull();
    expect(myLearningErrorMessage(undefined)).toBeNull();
    expect(myLearningErrorMessage(new Error(''))).toBeNull();
  });
});

describe('enrolledCountLabel', () => {
  it('pluralises from the server total', () => {
    expect(enrolledCountLabel(0)).toBe('0 courses enrolled');
    expect(enrolledCountLabel(1)).toBe('1 course enrolled');
    expect(enrolledCountLabel(7)).toBe('7 courses enrolled');
  });
});
