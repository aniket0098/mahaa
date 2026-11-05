/**
 * Course-detail wiring — the screen stays honest, pinned against its source.
 *
 * The rules this file holds, each against the file that must keep them:
 *  - Course data comes from `fetchCourse` over the shared transport with the
 *    established `queryKeys.course(id)` key — never fetch(), never a second
 *    client.
 *  - Enrolment is real since Stage 5 and stays honest: status and mutation go
 *    through `src/api/courses.ts` under `queryKeys.courseEnrollment(id)`, the
 *    CTA is gated on `isGenuinelyFree` (free designation AND missing price),
 *    the mutation settles only in `onSuccess` (no optimistic local flag), a
 *    pending enrolment disables the button, and failures render a persistent
 *    `StatusBanner` with retry. "Enrolled" appears only after the server says
 *    so.
 *  - No save/bookmark control exists without a persistence endpoint: no
 *    bookmark text, no saved-state toggle in the screen.
 *  - No fabricated social proof: no rating, no stars, no student count, no
 *    review, no bestseller/trending badge, no certificate claim.
 *  - External lecture links open only for https:// URLs through
 *    expo-web-browser — never a raw arbitrary URL.
 *  - The curriculum accordion announces its state through
 *    accessibilityState={{ expanded }}, the RN-supported expansion signal.
 *  - The branded hero fallback appears when no artwork reference is usable,
 *    and the course id is validated before any request fires.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const screen = read('../../app/(candidate)/course/[courseId].tsx');
const model = read('./courseDetailModel.ts');

describe('the course detail loads real server data', () => {
  it('fetches through the shared course API with the established query key', () => {
    expect(screen).toContain('fetchCourse(courseId');
    expect(screen).toContain('queryKeys.course(courseId');
    expect(screen).not.toMatch(/[^a-zA-Z]fetch\(/);
  });

  it('validates the route id before any request fires', () => {
    expect(screen).toContain('parseCourseId(');
    expect(screen).toContain('course-detail-invalid-id');
    expect(screen).toContain('enabled: courseId !== null');
  });

  it('distinguishes not-found from retryable transport failures', () => {
    expect(screen).toContain('isNotFound ? (');
    expect(screen).toContain("couldn");
    expect(screen).toContain('testID="course-detail-error"');
    expect(screen).toContain('refetch()');
    expect(model).toContain("status === 404 ? 'not_found' : 'transport'");
  });
});

describe('enrolment flows through the shared client, server as source of truth', () => {
  const api = read('../../api/courses.ts');
  const keys = read('../../api/queryKeys.ts');

  it('reads and writes enrolment through the api module under the declared key', () => {
    expect(screen).toContain('fetchCourseEnrollment(courseId');
    expect(screen).toContain('enrollInFreeCourse(courseId');
    expect(screen).toContain('queryKeys.courseEnrollment(courseId');
    expect(keys).toContain('courseEnrollment: (courseId: string)');
    expect(api).toContain('fetchCourseEnrollment');
    expect(api).toContain('enrollInFreeCourse');
    expect(api).not.toMatch(/[^a-zA-Z]fetch\(/);
  });

  it('holds no local enrolled flag and never settles before the server answers', () => {
    expect(screen).not.toMatch(/useState<[^>]*[Ee]nroll/);
    expect(screen).not.toContain('setEnrolled');
    expect(screen).not.toContain('onMutate');
    expect(screen).toContain('onSuccess: (enrollment)');
    expect(screen).toContain('void queryClient.invalidateQueries');
    expect(screen).toContain('setQueryData(');
  });

  it('offers the CTA only for a genuinely free course, and keeps paid honest', () => {
    expect(screen).toContain('isGenuinelyFree(');
    expect(screen).toContain('enabled: courseId !== null && genuinelyFree');
    expect(model).toContain('isFree === true && price === null');
    // The not-genuinely-free branch keeps the Stage 4 contract: a disabled
    // button with a hint that names the real reason (paid vs not priced).
    expect(screen).toContain("'Enrol in this course'");
    expect(screen).toContain('disabled={true}');
    expect(model).toContain("enrollmentUnavailableHint(reason: 'paid' | 'unknown')");
  });

  it('shows Enrolled only from server-confirmed state, and blocks double taps while pending', () => {
    expect(screen).toContain("label={enrolled ? 'Enrolled' : 'Enroll for free'}");
    expect(screen).toContain('disabled={enrolled}');
    expect(screen).toContain('loading={enrollMutation.isPending}');
    expect(screen).toContain('enrollmentCardHint(');
  });

  it('renders enrolment failures persistently with a retry path', () => {
    expect(screen).toContain('Enrolment didn\'t complete');
    expect(screen).toContain("Couldn't check your enrolment");
    expect(screen).toMatch(/onRetry=\{/);
  });
});

describe('the screen shows no dead save control and no fake social proof', () => {
  it('has no bookmark or save affordance without a persistence endpoint', () => {
    expect(screen.toLowerCase()).not.toContain('bookmark');
    expect(screen).not.toContain('Save for later');
  });

  it('invents no ratings, learner counts, reviews, or promotional badges', () => {
    expect(screen).not.toMatch(/Bestseller|Trending/i);
    expect(screen).not.toContain('students');
    expect(screen).not.toContain('Certificate');
    expect(screen).not.toMatch(/rating|stars|reviews/i);
  });
});

describe('pricing is derived from the server, never fabricated', () => {
  it('shows Free for free courses and the real price only when fully known', () => {
    expect(screen).toContain("price.kind === 'free'");
    expect(screen).toContain("price.kind === 'paid'");
    expect(screen).toContain('Price not set');
    expect(model).toContain("if (price === null || price <= 0) return { kind: 'unknown' };");
  });
});

describe('the curriculum accordion is honest and accessible', () => {
  it('expands through the supported accessibility state signal', () => {
    expect(screen).toContain('accessibilityState={{ expanded: isOpen }}');
    expect(screen).toContain('toggleExpandedSection(expandedSections, section.id)');
  });

  it('derives counts from the real section list and handles an empty syllabus', () => {
    expect(screen).toContain('Course curriculum');
    expect(screen).toContain('Curriculum details are not available for this course yet.');
  });

  it('gates external lecture links to https:// through the system browser', () => {
    expect(screen).toContain('WebBrowser.openBrowserAsync');
    expect(model).toContain('/^https:\\/\\//');
  });
});

describe('the hero degrades honestly without artwork', () => {
  it('renders the branded hero — no external thumbnail is fetchable for learners', () => {
    expect(screen).toContain('styles.heroIconWrap');
    expect(screen).toContain('styles.heroTitle');
    // Thumbnails are pointer ids behind an uploader-only media route; the
    // screen never builds an image URL from one.
    expect(screen).not.toContain('thumbnail_media_id');
    expect(screen).not.toMatch(/<Image|<ExpoImage|ImageBackground/);
  });
});
