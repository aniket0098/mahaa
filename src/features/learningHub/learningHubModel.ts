/**
 * Learning Hub Home presentation — pure functions over real server rows.
 *
 * **There is no lecture-feed endpoint on the server.** Lectures exist only as
 * the curriculum of a course, returned by `GET /courses/{id}`; so the feed is
 * built by reading the catalogue (`GET /courses`) and then the course details
 * of a bounded slice of it — every row here is a real server row, keyed by the
 * server's own lecture id. Nothing is invented: no popularity counts, no
 * ratings, no completion statistics, and a `null` duration stays `null` so the
 * UI shows no duration rather than a fabricated one.
 *
 * Every branch reads only what the server actually said: a failed fetch is a
 * failed fetch (never relabelled as an empty feed), and cached rows survive a
 * failed refresh with the failure surfaced beside them.
 */

import type { Course, CourseDetail, CourseListParams, LectureKind } from '@/types/course';
import type { DemoPlaylistLecture } from '@/features/learningHub/demoPlaylist';

/**
 * One lecture, flattened for the feed cards.
 *
 * Carries just the fields the cards render, plus the course context the lecture
 * belongs to — a lecture is never shown without its course, because that is the
 * only way the server exposes it.
 */
export interface LectureFeedItem {
  /** The server's own `course_lectures.id` — the stable key for the FlatList. */
  readonly lectureId: string;
  readonly title: string;
  readonly kind: LectureKind;
  /** `NULL` means unknown, never zero — the card omits the duration then. */
  readonly durationSeconds: number | null;
  readonly isPreview: boolean;
  readonly courseId: string;
  readonly courseTitle: string;
  readonly category: string | null;
  readonly instructorName: string;
}

/**
 * How many catalogue courses the feed reads curricula from.
 *
 * Each course costs one `GET /courses/{id}` on top of the catalogue page; eight
 * is enough for a full first screen of lectures while keeping the initial burst
 * to a handful of small parallel requests. The catalogue page itself is 20, the
 * server's own default window.
 */
export const FEED_COURSE_LIMIT = 8;

/** A video lecture is anything that is not the `reading` kind. */
export function isVideoLecture(kind: LectureKind): boolean {
  return kind !== 'reading';
}

/** The distinct topic categories carried by real courses, in catalogue order. */
export interface TopicChip {
  readonly id: string;
  readonly name: string;
  readonly courseCount: number;
}

/** Build the discoverable topic chips from real course categories only. */
export function topicsFromCourses(
  courses: readonly Course[],
): TopicChip[] {
  const counts = new Map<string, number>();
  for (const course of courses) {
    if (!course.category) continue;
    counts.set(course.category, (counts.get(course.category) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([id, courseCount]) => ({
    id,
    name: id,
    courseCount,
  }));
}

/**
 * Select a bounded set of recommended lectures for the hero / Recommended band.
 *
 * Real server rows only: video lectures with media, de-duplicated by course so
 * the band shows a variety of courses rather than eight slices of one course.
 * No popularity counts exist on the server, so this is honestly labeled
 * `Recommended`, never `Trending`.
 */
export function pickRecommendedLectures(
  items: readonly LectureFeedItem[],
  limit = 6,
): LectureFeedItem[] {
  const seenCourses = new Set<string>();
  const out: LectureFeedItem[] = [];
  for (const item of items) {
    if (!isVideoLecture(item.kind)) continue;
    if (seenCourses.has(item.courseId)) continue;
    seenCourses.add(item.courseId);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Flatten the fetched course details into feed rows, in catalogue order then
 * curriculum order.
 *
 * `details[i]` belongs to `courses[i]` (React Query's `useQueries` preserves
 * request order); a course whose detail has not arrived — still loading or
 * failed — contributes no rows rather than rows with invented context.
 */
export function buildLectureFeed(
  courses: readonly Course[],
  details: readonly (CourseDetail | undefined | null)[],
): LectureFeedItem[] {
  const items: LectureFeedItem[] = [];
  const shared = Math.min(courses.length, details.length);

  for (let index = 0; index < shared; index += 1) {
    const course = courses[index];
    const detail = details[index];
    if (!course || !detail) continue;

    for (const section of detail.sections) {
      for (const lecture of section.lectures) {
        items.push({
          lectureId: lecture.id,
          title: lecture.title,
          kind: lecture.kind,
          durationSeconds: lecture.duration_seconds,
          isPreview: lecture.is_preview,
          courseId: course.id,
          courseTitle: course.title,
          category: course.category,
          instructorName: course.instructor.name,
        });
      }
    }
  }

  return items;
}

/**
 * The lecture the featured card shows.
 *
 * Preference order: a preview video (the free sample a catalogue card may show
 * before enrolment), then any video, then any preview, then the first lecture.
 * The feed order itself is the server's — this only *selects*, never reorders.
 */
export function pickFeaturedLecture(items: readonly LectureFeedItem[]): LectureFeedItem | null {
  return (
    items.find((item) => isVideoLecture(item.kind) && item.isPreview) ??
    items.find((item) => isVideoLecture(item.kind)) ??
    items.find((item) => item.isPreview) ??
    items[0] ??
    null
  );
}

/** One category chip, derived from the loaded catalogue page — never a category endpoint. */
export interface CategoryChip {
  readonly id: string;
  readonly name: string;
  readonly course_count: number;
}

export function categoriesFromCourses(courses: readonly Course[]): CategoryChip[] {
  const counts = new Map<string, number>();
  for (const course of courses) {
    if (course.category) {
      counts.set(course.category, (counts.get(course.category) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).map(([name, course_count]) => ({
    id: name,
    name,
    course_count,
  }));
}

/**
 * Builds the catalogue query params for the lecture feed from the user's search
 * and category choices. Only non-default filters are sent, so an unfiltered
 * request keeps the same cache key the rest of the app uses. Filtering happens
 * server-side on `GET /courses` (`q` and `category`) — nothing is fabricated.
 */
export function lectureFeedParams(
  search: string,
  category: string | null,
): CourseListParams {
  const params: CourseListParams = { page_size: 20 };
  if (search.length > 0) params.q = search;
  if (category) params.category = category;
  return params;
}

/** The slice of the feed queries this model reads. */
export interface HubFeedInput {
  /** The catalogue query has any successfully loaded page (even an empty one). */
  readonly coursesHasData: boolean;
  /** No catalogue data yet and a fetch is in flight. */
  readonly coursesLoading: boolean;
  /** The catalogue query's latest fetch failed. */
  readonly coursesError: unknown;
  /** Detail queries still without data. */
  readonly detailsPending: number;
  /** Detail queries whose latest fetch failed. */
  readonly detailsFailed: number;
  /** The first detail failure, for the error banner's own words. */
  readonly detailError: unknown;
  readonly items: readonly LectureFeedItem[];
}

/**
 * What the Home feed renders.
 *
 * - `loading` — the catalogue or the curricula are still arriving, and nothing
 *   has failed. Never shown once rows exist.
 * - `error`   — a fetch failed and there are no rows to show. The failure is
 *   rendered as a persistent error with retry — **never** as an empty feed.
 * - `empty`   — the server answered and there are genuinely no lectures. The
 *   one honest empty state.
 * - `ready`   — real lecture rows; `featured` is the card selection among them.
 *
 * `refreshError` (on `ready` and `empty`) marks a *failed refresh* over data
 * that is still real: the rows stay on screen and the failure surfaces beside
 * them — the same rule `myLearningView` follows for enrolments.
 */
export type HubFeedView =
  | { kind: 'loading' }
  | { kind: 'error'; message: string | null }
  | { kind: 'empty'; refreshError: string | null }
  | {
      kind: 'ready';
      items: readonly LectureFeedItem[];
      featured: LectureFeedItem | null;
      refreshError: string | null;
    };

/** The failure's own words when it has any — a server message stays verbatim. */
export function hubErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return null;
}

export function hubFeedView(input: HubFeedInput): HubFeedView {
  const catalogueFailure = hubErrorMessage(input.coursesError);
  const detailFailure = hubErrorMessage(input.detailError);

  // A failed catalogue fetch with nothing cached is a failure, not an empty
  // feed — the server never said "no lectures".
  if (input.coursesError != null && !input.coursesHasData) {
    return { kind: 'error', message: catalogueFailure };
  }

  // Cached-or-fresh rows win: they are real, and a failed refresh surfaces
  // beside them rather than hiding them.
  if (input.items.length > 0) {
    return {
      kind: 'ready',
      items: input.items,
      featured: pickFeaturedLecture(input.items),
      refreshError: catalogueFailure,
    };
  }

  if (input.coursesLoading || input.detailsPending > 0) {
    return { kind: 'loading' };
  }

  // The catalogue was fine but every curriculum failed: a failure, still not
  // an empty feed.
  if (input.detailsFailed > 0) {
    return { kind: 'error', message: detailFailure };
  }

  // A cached empty catalogue whose refresh failed: the server's own empty page
  // stays on screen, with the refresh failure beside it.
  if (input.coursesError != null) {
    return { kind: 'empty', refreshError: catalogueFailure };
  }

  return { kind: 'empty', refreshError: null };
}

/** A unified, searchable catalogue item — server lecture or demo lesson. */
export interface CatalogItem {
  /** Stable key for the FlatList. */
  readonly id: string;
  readonly source: 'server' | 'demo';
  readonly title: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly courseTitle: string;
  readonly instructorName: string | null;
  readonly durationSeconds: number | null;
  readonly kind: LectureKind | null;
  readonly isPreview: boolean;
  /** Server lecture id — null for demo lessons. */
  readonly lectureId: string | null;
  /** Server course id — null for demo lessons. */
  readonly courseId: string | null;
  readonly isDemo: boolean;
}

/** Convert a server-backed lecture feed item into a catalog item. */
export function lectureToCatalogItem(item: LectureFeedItem): CatalogItem {
  return {
    id: item.lectureId,
    source: 'server',
    title: item.title,
    description: null,
    category: item.category,
    courseTitle: item.courseTitle,
    instructorName: item.instructorName,
    durationSeconds: item.durationSeconds,
    kind: item.kind,
    isPreview: item.isPreview,
    lectureId: item.lectureId,
    courseId: item.courseId,
    isDemo: false,
  };
}

/** Convert a demo playlist lecture into a catalog item. */
export function demoLectureToCatalogItem(
  lecture: DemoPlaylistLecture,
  playlistTitle: string
): CatalogItem {
  return {
    id: lecture.id,
    source: 'demo',
    title: lecture.title,
    description: lecture.description ?? null,
    category: null,
    courseTitle: playlistTitle,
    instructorName: null,
    durationSeconds: null,
    kind: null,
    isPreview: false,
    lectureId: lecture.serverLectureId,
    courseId: lecture.serverCourseId,
    isDemo: true,
  };
}

/** Filter and sort a combined catalog of server lectures and demo lessons. */
export interface CatalogFilter {
  readonly search: string;
  readonly topic: string | null;
  readonly sort: 'recent' | 'title';
}

export function filterCatalogItems(
  items: readonly CatalogItem[],
  filter: CatalogFilter
): CatalogItem[] {
  const term = filter.search.trim().toLowerCase();

  let result = items.filter((item) => {
    if (term.length === 0) return true;
    const haystack = [
      item.title,
      item.description,
      item.category,
      item.courseTitle,
      item.instructorName,
    ]
      .filter((v): v is string => v != null && v.length > 0)
      .join(' ')
      .toLowerCase();
    return haystack.includes(term);
  });

  if (filter.topic) {
    result = result.filter((item) => item.category === filter.topic);
  }

  if (filter.sort === 'title') {
    result = [...result].sort((a, b) => a.title.localeCompare(b.title));
  }

  return result;
}

/** Merge server lectures and demo lessons into a single catalog, de-duplicated by id. */
export function buildCatalog(
  serverItems: readonly LectureFeedItem[],
  demoLectures: readonly DemoPlaylistLecture[],
  playlistTitle: string
): CatalogItem[] {
  const server = serverItems.map(lectureToCatalogItem);
  const demo = demoLectures.map((d) => demoLectureToCatalogItem(d, playlistTitle));
  const byId = new Map<string, CatalogItem>();
  for (const item of [...server, ...demo]) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return Array.from(byId.values());
}
