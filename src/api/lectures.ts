/**
 * Lecture API — read-only access to lecture media and course context.
 *
 * There is **no dedicated lecture endpoint** on the server: lectures live only
 * as the curriculum of a course, returned by `GET /courses/{id}`. This module
 * reuses `fetchCourse` (same cache key the course-detail screen uses, so
 * opening a lecture from a course reuses the cached response) and resolves
 * media URLs through `media.ts`'s `loadPlayableVideoUri`, which downloads the
 * authenticated bytes to a local file before handing them to `expo-video`
 * (whose `VideoSource` has nowhere for a bearer header).
 *
 * No `fetch` here — `apiClient` is the one transport.
 */

import { apiClient } from '@/api/client';
import { loadPlayableVideoUri } from '@/api/media';
import type { CourseDetail, CourseLecture } from '@/types/course';

/**
 * Resolve a hosted-video lecture's media into a playable local URI.
 *
 * Downloads the authenticated bytes first (the server caps video at 10 MB), so
 * the player receives a `file://` URI it can open without headers. Returns
 * `null` when the lecture has no media (external_video / reading).
 *
 * Throws `ApiError` on 404/transport failure, so the player's error state can
 * show a meaningful message with Retry.
 */
export async function resolveLectureVideoUri(
  servedAt: string | null
): Promise<string | null> {
  if (!servedAt) return null;
  return loadPlayableVideoUri(servedAt);
}

/**
 * Fetch the course for a lecture and locate the lecture within its sections.
 *
 * Reuses `queryKeys.course(courseId)` so the course-detail screen and the
 * lecture player share one cache entry. Throws when the course is not found
 * or the lecture id is not part of its curriculum.
 */
export async function fetchLectureInCourse({
  courseId,
  lectureId,
}: {
  courseId: string;
  lectureId: string;
}): Promise<{ course: CourseDetail; lecture: CourseLecture }> {
  const course = await apiClient.get<CourseDetail>(`/courses/${courseId}`);

  for (const section of course.sections) {
    const lecture = section.lectures.find((l) => l.id === lectureId);
    if (lecture) return { course, lecture };
  }

  throw new Error(`Lecture ${lectureId} not found in course ${courseId}`);
}