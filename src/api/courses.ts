/**
 * Courses API calls — binds to `/courses` in
 * `apps/api/app/api/v1/endpoints/courses.py`.
 *
 * **Reads, plus Stage 5's one write — free enrolment.** There is still no
 * create/publish route: creator publishing arrives with its planned stage, so
 * an endpoint that returned 201 today would contradict every honest "arrives
 * in a later stage" screen. `enrollInFreeCourse` POSTs to the one write that
 * *does* exist, and only a genuinely free course ever reaches it. `apiClient`
 * is the only transport used — `fetch` is never called from here or from a
 * component.
 */

import { apiClient } from '@/api/client';
import type {
  Course,
  CourseDetail,
  CourseEnrollment,
  CourseEnrollmentState,
  EnrolledCourse,
} from '@/types/course';
import type { FastApiPage } from '@/types/story';

export interface CourseListParams {
  q?: string;
  category?: string;
  skill_level?: string;
  pricing?: 'free' | 'paid';
  page?: number;
  page_size?: number;
}

export async function fetchCourses(
  params?: CourseListParams,
): Promise<FastApiPage<Course>> {
  const query = new URLSearchParams();
  if (params?.q) query.set('q', params.q);
  if (params?.category) query.set('category', params.category);
  if (params?.skill_level) query.set('skill_level', params.skill_level);
  if (params?.pricing) query.set('pricing', params.pricing);
  if (params?.page) query.set('page', String(params.page));
  if (params?.page_size) query.set('page_size', String(params.page_size));

  const queryString = query.toString();
  const path = queryString ? `/courses?${queryString}` : '/courses';

  return apiClient.get<FastApiPage<Course>>(path);
}

export async function fetchCourse(courseId: string): Promise<CourseDetail> {
  return apiClient.get<CourseDetail>(`/courses/${courseId}`);
}

/**
 * `GET /courses/{id}/enrollment` — the caller's enrolment state for one
 * course. 401 when signed out (the shared client clears the session and the
 * auth provider redirects); the course-detail screen only asks this for a
 * genuinely free course.
 */
export async function fetchCourseEnrollment(
  courseId: string,
): Promise<CourseEnrollmentState> {
  return apiClient.get<CourseEnrollmentState>(`/courses/${courseId}/enrollment`);
}

/**
 * `POST /courses/{id}/enrollment` — enrol the caller in a free course.
 *
 * 201 on creation and 200 when the caller was already enrolled both resolve
 * to the server's `EnrollmentOut` row, so the caller's success handler treats
 * them identically; a paid or not-yet-priced course rejects with the shared
 * 409 envelope, and the screen renders that message persistently.
 */
export async function enrollInFreeCourse(courseId: string): Promise<CourseEnrollment> {
  return apiClient.post<CourseEnrollment>(`/courses/${courseId}/enrollment`);
}

/**
 * `GET /courses/enrollments/mine` — the caller's own enrolled courses.
 *
 * Real server data only: the student is the token principal, never a request
 * parameter. Returns a `FastApiPage<EnrolledCourse>` — empty when the caller
 * has no enrolments.
 */
export async function fetchMyEnrollments(
  params?: { page?: number; page_size?: number }
): Promise<FastApiPage<EnrolledCourse>> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.page_size) query.set('page_size', String(params.page_size));
  const queryString = query.toString();
  const path = queryString ? `/courses/enrollments/mine?${queryString}` : '/courses/enrollments/mine';
  return apiClient.get<FastApiPage<EnrolledCourse>>(path);
}

