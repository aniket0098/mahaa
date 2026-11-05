/** Pure course-detail presentation logic — no network, no React, Node-testable. */

/** A course id that survives a round trip as a path segment is a non-empty string. */
export function parseCourseId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const id = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  return id.length > 0 ? id : null;
}

/** The reason a failed course-detail request is unrecoverable or retryable. */
export type DetailErrorKind = 'not_found' | 'transport' | 'unknown';

export function courseDetailErrorKind(error: unknown): DetailErrorKind {
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: number }).status)
      : NaN;
  return Number.isFinite(status) && status === 404 ? 'not_found' : 'transport';
}

/** Derived counts for the curriculum heading, computed from the real section list. */
export interface CurriculumTotals {
  sections: number;
  lectures: number;
}

export function curriculumTotals(sections: readonly { lectures: readonly unknown[] }[]): CurriculumTotals {
  const lectures = sections.reduce((sum, section) => sum + section.lectures.length, 0);
  return { sections: sections.length, lectures };
}

/** Format a lecture's optional duration for the UI, never inventing one. */
export function formatLectureDuration(durationSeconds: number | null): string | null {
  if (!durationSeconds) return null;
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Format a course's optional estimated duration for the UI. */
export function formatEstimatedDuration(minutes: number | null): string | null {
  if (!minutes) return null;
  return minutes < 60 ? `${minutes} min` : `${minutes / 60}h`;
}

/** Format pricing honestly — free / real paid / unknown. Never fabricated. */
export type PriceDisplay =
  | { kind: 'free' }
  | { kind: 'paid'; amount: string; currency: string | null }
  | { kind: 'unknown' };

export function formatCoursePrice(
  isFree: boolean,
  price: number | null,
  currency: string | null,
): PriceDisplay {
  if (isFree) return { kind: 'free' };
  if (price === null || price <= 0) return { kind: 'unknown' };
  if (!currency) return { kind: 'unknown' };
  return { kind: 'paid', amount: price.toFixed(2), currency };
}

/** The three real lecture kinds only — never a kind inferred from a title. */
export type LectureKind = 'hosted_video' | 'external_video' | 'reading';

export function lectureKindLabel(kind: LectureKind): string {
  switch (kind) {
    case 'hosted_video':
      return 'Video';
    case 'external_video':
      return 'External link';
    case 'reading':
      return 'Reading';
    default:
      return kind;
  }
}

export function lectureKindIcon(kind: LectureKind): string {
  switch (kind) {
    case 'hosted_video':
      return 'play_circle';
    case 'external_video':
      return 'link';
    case 'reading':
      return 'book';
    default:
      return 'file_present';
  }
}

/** Open only https:// links — never a raw arbitrary URL. */
export function isExternalLinkAllowed(url: string | null): boolean {
  if (!url) return false;
  return /^https:\/\//i.test(url);
}

/** Toggle a single section in an open-sections set; predictable multi-open policy. */
export function toggleExpandedSection(open: Set<string>, id: string): Set<string> {
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Human label for a published / draft course state shown on the screen. */
export function publishedLabel(status: 'published' | 'draft' | null): string {
  switch (status) {
    case 'published':
      return 'Published';
    case 'draft':
      return 'Draft';
    default:
      return 'Unpublished';
  }
}

/** Whether a very long description should start collapsed on narrow screens. */
export function isDescriptionCollapsible(text: string): boolean {
  return text.length > 220;
}

/** Formatted enrolled-state sentence from the server's confirmation (no local truth). */
export function enrollmentStateSentence(enrolled: boolean, courseTitle: string): string {
  return enrolled
    ? `Enrolled in "${courseTitle}"`
    : `Not yet enrolled in "${courseTitle}"`;
}

/**
 * Whether an enrolment CTA may be offered — the client's copy of the server's
 * own gate (`services/courses.py::_free_for_enrolment`): `is_free === true`
 * **and** a missing price. A missing price alone is never evidence of a free
 * course, and a course carrying a price is never free even while claiming
 * `is_free`. Note this is *not* `formatCoursePrice(...).kind === 'free'`:
 * that formatter is display-only, and the enrolment gate stays strict.
 */
export function isGenuinelyFree(isFree: boolean, price: number | null): boolean {
  return isFree === true && price === null;
}

/**
 * Why the enrolment button is disabled for a course that is not genuinely
 * free. Paid and not-yet-priced are named separately, so the hint never
 * claims a course is free, and never pretends a payment flow exists today.
 */
export function enrollmentUnavailableHint(reason: 'paid' | 'unknown'): string {
  if (reason === 'paid') {
    return 'Paid courses open for enrolment when payment ships in a later stage.';
  }
  return "This course's price isn't set yet, so enrolment isn't available.";
}

/**
 * The enrolment card's hint line, derived from *server-observed* status only.
 * While the status query is loading or has failed, the copy says exactly that
 * — it never guesses "not enrolled" from an absence of data.
 */
export function enrollmentCardHint(
  kind: 'loading' | 'error' | 'enrolled' | 'not-enrolled',
  courseTitle: string,
): string {
  switch (kind) {
    case 'loading':
      return 'Checking your enrolment…';
    case 'error':
      return 'Your enrolment status could not be confirmed.';
    case 'enrolled':
      return enrollmentStateSentence(true, courseTitle);
    case 'not-enrolled':
    default:
      return enrollmentStateSentence(false, courseTitle);
  }
}
