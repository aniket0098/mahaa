/**
 * Types mirroring the backend `courses` domain.
 *
 * Source of truth: `apps/api/app/schemas/courses.py`. Keep in strict parity —
 * the mobile client switches on `skill_level`, `kind` and `status` literals
 * that the server validates with CHECK constraints.
 *
 * All Stage 2 courses are free (payments arrive in Stage 9), so `is_free` is
 * always `true` from the wire today. It stays in the type so the client never
 * invents a paid-course UI before the server can back it.
 */

export type CourseStatus = 'draft' | 'published';
export type CourseVisibility = 'public' | 'unlisted';
export type CourseSkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';
export type LectureKind = 'hosted_video' | 'external_video' | 'reading';
export type LectureStatus = 'draft' | 'published';

export interface CourseInstructor {
  readonly id: string;
  readonly name: string;
  readonly public_id: string;
}

/**
 * One catalogue item — returned by `GET /courses` and embedded as the head of
 * `GET /courses/{id}`'s response (the backend subclasses `CourseOut`, so the
 * client's `CourseDetail extends Course` stays in parity).
 */
export interface Course {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly skill_level: CourseSkillLevel | null;
  readonly language: string | null;
  readonly estimated_duration_minutes: number | null;
  readonly is_free: boolean;
  /** `null` for a free course; float, not string — see the service docstring. */
  readonly price: number | null;
  readonly price_currency: string | null;
  /** A **pointer id**, never a URL — media read rules gate the bytes. */
  readonly thumbnail_media_id: string | null;
  readonly instructor: CourseInstructor;
  readonly created_at: string;
  readonly published_at: string | null;
}

/** `GET /courses/{id}` — course plus its ordered sections and lectures. */
export interface CourseDetail extends Course {
  readonly sections: readonly CourseSection[];
}

export interface CourseSection {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly position: number;
  readonly lectures: readonly CourseLecture[];
}

export interface CourseLecture {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly position: number;
  readonly kind: LectureKind;
  /** Pointer id, never a URL — same rule as the thumbnail. */
  readonly media_id: string | null;
  /** An `https://` link to a third party's host, validated by server CHECK. */
  readonly external_url: string | null;
  /** NULL means "unknown position", never zero. */
  readonly duration_seconds: number | null;
  readonly is_preview: boolean;
  readonly status: LectureStatus;
}

/** Free-first catalogue params; `pricing` mirrors the server's `Literal`. */
export interface CourseListParams {
  q?: string;
  category?: string;
  skill_level?: CourseSkillLevel;
  pricing?: 'free' | 'paid';
  page?: number;
  page_size?: number;
}

/** The caller's enrolment row, as `EnrollmentOut` serialises it. */
export type EnrollmentStatus = 'active' | 'completed' | 'cancelled';

export interface CourseEnrollment {
  readonly id: string;
  readonly course_id: string;
  /** Stored, not derived — Stage 5 only ever writes `active`. */
  readonly status: EnrollmentStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * `GET /courses/{id}/enrollment` — the caller's state for one course.
 *
 * `enrolled` is the flag the screen branches on; `enrollment` carries the
 * server's own row when present and `null` when not, so the client never
 * infers identity from a boolean alone (parity with `EnrollmentStateOut`).
 */
export interface CourseEnrollmentState {
  readonly enrolled: boolean;
  readonly enrollment: CourseEnrollment | null;
}

/**
 * One of the caller's enrolments, as returned by `GET /courses/enrollments/mine`.
 *
 * Composes the enrolment row with the course it belongs to. `student_id` is
 * deliberately absent — the row belongs to the token principal by construction.
 */
export interface EnrolledCourse {
  readonly enrollment: CourseEnrollment;
  readonly course: Course;
}