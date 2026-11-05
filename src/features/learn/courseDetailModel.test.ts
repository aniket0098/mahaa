/**
 * courseDetailModel — pure presentation logic for the course-detail screen.
 *
 * Every helper is honest-by-construction: the price formatter returns
 * `unknown` rather than guessing, duration formatters return null for
 * missing data, and the external-link gate only admits https:// URLs.
 */
import { describe, expect, it } from 'vitest';

import {
  courseDetailErrorKind,
  curriculumTotals,
  enrollmentCardHint,
  enrollmentStateSentence,
  enrollmentUnavailableHint,
  formatCoursePrice,
  formatEstimatedDuration,
  formatLectureDuration,
  isDescriptionCollapsible,
  isExternalLinkAllowed,
  isGenuinelyFree,
  lectureKindIcon,
  lectureKindLabel,
  parseCourseId,
  publishedLabel,
  toggleExpandedSection,
} from '@/features/learn/courseDetailModel';

describe('parseCourseId', () => {
  it('accepts a non-empty id', () => {
    expect(parseCourseId('abc-123')).toBe('abc-123');
  });

  it('rejects null, undefined, empty, and whitespace-only ids', () => {
    expect(parseCourseId(null)).toBeNull();
    expect(parseCourseId(undefined)).toBeNull();
    expect(parseCourseId('')).toBeNull();
    expect(parseCourseId('   ')).toBeNull();
  });
});

describe('courseDetailErrorKind', () => {
  it('maps a 404 to not_found', () => {
    expect(courseDetailErrorKind({ status: 404 })).toBe('not_found');
  });

  it('maps everything else to a retryable transport error', () => {
    expect(courseDetailErrorKind({ status: 500 })).toBe('transport');
    expect(courseDetailErrorKind(new Error('boom'))).toBe('transport');
    expect(courseDetailErrorKind(null)).toBe('transport');
  });
});

describe('curriculumTotals', () => {
  it('derives section and lecture counts from the real list', () => {
    expect(
      curriculumTotals([{ lectures: [1, 2] }, { lectures: [] }, { lectures: [3] }]),
    ).toEqual({ sections: 3, lectures: 3 });
  });

  it('handles an empty curriculum', () => {
    expect(curriculumTotals([])).toEqual({ sections: 0, lectures: 0 });
  });
});

describe('formatLectureDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatLectureDuration(90)).toBe('1:30');
    expect(formatLectureDuration(600)).toBe('10:00');
  });

  it('returns null when the duration is unknown', () => {
    expect(formatLectureDuration(null)).toBeNull();
    expect(formatLectureDuration(0)).toBeNull();
  });
});

describe('formatEstimatedDuration', () => {
  it('shows minutes under an hour and hours above', () => {
    expect(formatEstimatedDuration(45)).toBe('45 min');
    expect(formatEstimatedDuration(120)).toBe('2h');
  });

  it('returns null when unknown', () => {
    expect(formatEstimatedDuration(null)).toBeNull();
  });
});

describe('formatCoursePrice', () => {
  it('marks free courses free', () => {
    expect(formatCoursePrice(true, null, null)).toEqual({ kind: 'free' });
  });

  it('shows a real paid price with its currency', () => {
    expect(formatCoursePrice(false, 499, 'INR')).toEqual({
      kind: 'paid',
      amount: '499.00',
      currency: 'INR',
    });
  });

  it('refuses to fabricate a price when data is missing', () => {
    expect(formatCoursePrice(false, null, 'INR')).toEqual({ kind: 'unknown' });
    expect(formatCoursePrice(false, 0, 'INR')).toEqual({ kind: 'unknown' });
    expect(formatCoursePrice(false, 499, null)).toEqual({ kind: 'unknown' });
  });
});

describe('lecture kinds', () => {
  it('labels the three real kinds', () => {
    expect(lectureKindLabel('hosted_video')).toBe('Video');
    expect(lectureKindLabel('external_video')).toBe('External link');
    expect(lectureKindLabel('reading')).toBe('Reading');
  });

  it('gives each kind a distinct icon', () => {
    const icons = new Set([
      lectureKindIcon('hosted_video'),
      lectureKindIcon('external_video'),
      lectureKindIcon('reading'),
    ]);
    expect(icons.size).toBe(3);
  });
});

describe('isExternalLinkAllowed', () => {
  it('admits https:// links', () => {
    expect(isExternalLinkAllowed('https://example.com/video')).toBe(true);
  });

  it('rejects http, null, and empty urls', () => {
    expect(isExternalLinkAllowed('http://example.com')).toBe(false);
    expect(isExternalLinkAllowed(null)).toBe(false);
    expect(isExternalLinkAllowed('')).toBe(false);
  });
});

describe('toggleExpandedSection', () => {
  it('opens a closed section and closes an open one', () => {
    expect(toggleExpandedSection(new Set(), 'a')).toEqual(new Set(['a']));
    expect(toggleExpandedSection(new Set(['a']), 'a')).toEqual(new Set());
  });

  it('keeps multiple sections open simultaneously', () => {
    expect(toggleExpandedSection(new Set(['a']), 'b')).toEqual(new Set(['a', 'b']));
  });

  it('never mutates the previous set', () => {
    const before = new Set(['a']);
    toggleExpandedSection(before, 'b');
    expect(before).toEqual(new Set(['a']));
  });
});

describe('publishedLabel', () => {
  it('labels published, draft, and unknown states', () => {
    expect(publishedLabel('published')).toBe('Published');
    expect(publishedLabel('draft')).toBe('Draft');
    expect(publishedLabel(null)).toBe('Unpublished');
  });
});

describe('isDescriptionCollapsible', () => {
  it('collapses only long descriptions', () => {
    expect(isDescriptionCollapsible('short')).toBe(false);
    expect(isDescriptionCollapsible('x'.repeat(221))).toBe(true);
  });
});

describe('enrollment copy', () => {
  it('states the server-confirmed enrollment state', () => {
    expect(enrollmentStateSentence(true, 'React Basics')).toBe('Enrolled in "React Basics"');
    expect(enrollmentStateSentence(false, 'React Basics')).toBe('Not yet enrolled in "React Basics"');
  });

  it('explains why a not-genuinely-free course cannot enrol, honestly per reason', () => {
    expect(enrollmentUnavailableHint('paid')).toContain('later stage');
    expect(enrollmentUnavailableHint('unknown')).toContain("price isn't set");
  });

  it('derives the enrolment card hint only from server-observed status', () => {
    expect(enrollmentCardHint('loading', 'React Basics')).toContain('Checking');
    expect(enrollmentCardHint('error', 'React Basics')).toContain('not be confirmed');
    expect(enrollmentCardHint('enrolled', 'React Basics')).toBe('Enrolled in "React Basics"');
    expect(enrollmentCardHint('not-enrolled', 'React Basics')).toBe(
      'Not yet enrolled in "React Basics"',
    );
  });
});

describe('isGenuinelyFree', () => {
  it('requires the free designation AND a missing price — never a missing price alone', () => {
    expect(isGenuinelyFree(true, null)).toBe(true);
    expect(isGenuinelyFree(true, 499)).toBe(false);
    expect(isGenuinelyFree(false, null)).toBe(false);
    expect(isGenuinelyFree(false, 499)).toBe(false);
  });
});
