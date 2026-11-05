/**
 * My Learning presentation decisions — pure functions, no network, no React.
 *
 * Every branch reads only what the server actually said: the page envelope
 * decides the count, an empty page is a real empty list, and a failed fetch is
 * a failed fetch — never relabelled as "no enrolments".
 */

import type { EnrolledCourse } from '@/types/course';

/** The page shape `GET /courses/enrollments/mine` answers with. */
export interface MyLearningPage {
  readonly items: readonly EnrolledCourse[];
  readonly total: number;
}

/** The slice of a React Query result this model reads. */
export interface MyLearningQueryState {
  /** The latest fetch failed — with or without earlier data still cached. */
  readonly isError: boolean;
  /** The failure itself; `ApiError` carries the server's own message. */
  readonly error: unknown;
  /** The last successfully loaded page, if any. */
  readonly data: MyLearningPage | undefined;
}

/**
 * What the screen renders.
 *
 * - `loading` — nothing loaded and no failure yet (first fetch in flight).
 * - `error`   — the first fetch failed: a persistent banner with retry. Never
 *              rendered as an empty list, because the server never said
 *              "no enrolments".
 * - `empty`   — the server answered with zero enrolments: a real empty state.
 * - `ready`   — the caller's real enrolments; `total` is the server's count
 *              for the whole list, not the length of one page.
 *
 * `refreshError` (on `empty` and `ready`) marks a *failed refresh* over data
 * that is still real: the rows stay on screen and the failure surfaces as the
 * same persistent banner with retry.
 */
export type MyLearningView =
  | { kind: 'loading' }
  | { kind: 'error'; message: string | null }
  | { kind: 'empty'; refreshError: string | null }
  | {
      kind: 'ready';
      items: readonly EnrolledCourse[];
      total: number;
      refreshError: string | null;
    };

/** The failure's own words when it has any — a server message stays verbatim. */
export function myLearningErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return null;
}

export function myLearningView(query: MyLearningQueryState): MyLearningView {
  const refreshError = query.isError ? myLearningErrorMessage(query.error) : null;

  // Cached data first: it is a real earlier answer, so a failed refresh never
  // hides rows the server already gave.
  if (query.data) {
    if (query.data.items.length === 0) return { kind: 'empty', refreshError };
    return { kind: 'ready', items: query.data.items, total: query.data.total, refreshError };
  }

  if (query.isError) return { kind: 'error', message: myLearningErrorMessage(query.error) };

  return { kind: 'loading' };
}

/** Server-derived enrolment count — the envelope's `total`, never a local tally. */
export function enrolledCountLabel(total: number): string {
  return total === 1 ? '1 course enrolled' : `${total} courses enrolled`;
}
