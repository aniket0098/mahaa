/**
 * My Learning wiring — the screen stays honest, pinned against its source.
 *
 * The rules this file holds, each against the file that must keep them:
 *  - Enrolment rows come from `fetchMyEnrollments` over the shared transport
 *    with the declared `queryKeys.myEnrollments` key — never fetch(), never a
 *    second client.
 *  - A confirmed enrolment in course detail invalidates `myEnrollments`, so
 *    the list re-reads instead of missing the new row.
 *  - Loading renders skeletons, failure renders a persistent `StatusBanner`
 *    with retry (and a Browse path), and the empty state is server-empty only.
 *  - Pull-to-refresh refetches the same query; row keys are enrolment ids, so
 *    a refreshed list cannot duplicate a course.
 *  - No fabricated learning data: no completion percentage, no resume/continue
 *    affordance (the lecture-progress table has no endpoint), no ratings,
 *    certificates, or learner counts.
 *  - The entry point is the Learning Hub header button, and `home.tsx` /
 *    `LearningSection.tsx` are untouched by this feature.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const screen = read('../../app/(candidate)/my-learning.tsx');
const model = read('./myLearningModel.ts');

describe('the list loads real server data', () => {
  it('fetches through the shared course API with the declared query key', () => {
    expect(screen).toContain('fetchMyEnrollments(');
    expect(screen).toContain('queryKeys.myEnrollments');
    expect(screen).not.toMatch(/[^a-zA-Z]fetch\(/);
  });

  it('declares the key once, under the courses branch', () => {
    const keys = read('../../api/queryKeys.ts');
    expect(keys).toContain("myEnrollments: ['courses', 'mine']");
    const api = read('../../api/courses.ts');
    expect(api).toContain('fetchMyEnrollments');
    expect(api).not.toMatch(/[^a-zA-Z]fetch\(/);
  });

  it('invalidates the list after course detail confirms an enrolment', () => {
    const detail = read('../../app/(candidate)/course/[courseId].tsx');
    expect(detail).toContain('queryKey: queryKeys.myEnrollments');
  });
});

describe('every state is reachable and honest', () => {
  it('renders skeletons while the first fetch is in flight', () => {
    expect(screen).toContain("view.kind === 'loading'");
    expect(screen).toContain('SkeletonCard');
    expect(screen).toContain('my-learning-loading');
  });

  it('renders failures persistently with retry and a Browse escape hatch', () => {
    expect(screen).toContain('StatusBanner');
    expect(screen).toContain('onRetry={() => void enrollmentsQuery.refetch()}');
    expect(screen).toContain('my-learning-error');
    expect(screen).toContain('Browse courses');
  });

  it('offers the empty state only from a server-empty page, with Browse', () => {
    expect(screen).toContain("view.kind === 'empty'");
    expect(screen).toContain("You haven't enrolled in any courses yet.");
    expect(screen).toContain('my-learning-empty');
    expect(screen).toContain("router.push('/learn' as never)");
  });

  it('decides the state in the pure model, not in the screen', () => {
    expect(model).toContain("kind: 'loading'");
    expect(model).toContain("kind: 'error'");
    expect(model).toContain("kind: 'empty'");
    expect(model).toContain("kind: 'ready'");
  });
});

describe('refresh and identity stay server-keyed', () => {
  it('pull-to-refresh refetches the same query', () => {
    expect(screen).toContain('RefreshControl');
    expect(screen).toContain('refreshing={enrollmentsQuery.isRefetching}');
    expect(screen).toContain('onRefresh={() => void enrollmentsQuery.refetch()}');
  });

  it('keys rows by enrolment id, so a refresh cannot duplicate a course', () => {
    expect(screen).toContain('keyExtractor={(item) => item.enrollment.id}');
  });

  it('derives the count from the envelope total, never a local tally', () => {
    expect(screen).toContain('enrolledCountLabel(view.total)');
    expect(model).toContain("total === 1 ? '1 course enrolled'");
  });
});

describe('the screen fabricates no learning data', () => {
  it('has no resume or continue affordance — opening the course is the only action', () => {
    expect(screen).not.toMatch(/resume/i);
    expect(screen).not.toMatch(/continue (watching|learning)/i);
    expect(screen).not.toContain('LectureProgress');
  });

  it('invents no percentages, ratings, certificates, or learner counts', () => {
    expect(screen).not.toMatch(/%/);
    expect(screen).not.toMatch(/progress\s*[:=]/i);
    expect(screen).not.toMatch(/Bestseller|Trending/i);
    expect(screen).not.toMatch(/certificate|rating|stars|reviews/i);
  });

  it('enrols nowhere — this list only reads and navigates', () => {
    expect(screen).not.toContain('enrollInFreeCourse');
    expect(screen).not.toContain('useMutation');
    expect(screen).toContain("router.push(`/course/${course.id}` as never)");
  });
});

describe('the entry point and untouched surfaces', () => {
  it('is pushed from the Learning Hub header button', () => {
    const learn = read('../../app/(candidate)/learn/courses.tsx');
    expect(learn).toContain('label="My Learning"');
    expect(learn).toContain("router.push('/my-learning' as never)");
  });

  it('is a declared, implemented candidate detail route', () => {
    const nav = read('../../config/navConfig.ts');
    expect(nav).toContain("{ path: '/my-learning', title: 'My Learning', implemented: true }");
  });

  it('has not crept into Home or its Learning section', () => {
    expect(read('../../app/(candidate)/home.tsx')).not.toContain('my-learning');
    expect(read('../home/LearningSection.tsx')).not.toContain('my-learning');
  });

  it('offers a back control like every detail screen', () => {
    expect(screen).toContain('<BackButton');
  });
});
