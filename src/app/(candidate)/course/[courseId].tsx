import { useState, type ReactNode } from 'react';
import { StyleSheet, View, Pressable, type AccessibilityRole, type DimensionValue } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  parseCourseId,
  curriculumTotals,
  enrollmentCardHint,
  enrollmentStateSentence,
  enrollmentUnavailableHint,
  formatCoursePrice,
  formatEstimatedDuration,
  formatLectureDuration,
  isDescriptionCollapsible,
  isGenuinelyFree,
  lectureKindLabel,
  toggleExpandedSection,
} from '@/features/learn/courseDetailModel';
import { queryKeys } from '@/api/queryKeys';
import { enrollInFreeCourse, fetchCourse, fetchCourseEnrollment } from '@/api/courses';
import { ApiError } from '@/api/errors';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { colors, spacing, layout, radius, typography } from '@/theme/tokens';
import type { CourseDetail, CourseEnrollmentState } from '@/types/course';

export default function CourseDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ courseId?: string | string[] }>();
  const courseId = parseCourseId(
    params.courseId ? (Array.isArray(params.courseId) ? params.courseId[0] : params.courseId) : undefined,
  );

  const query = useQuery({
    queryKey: queryKeys.course(courseId ?? ''),
    queryFn: () => fetchCourse(courseId as string),
    staleTime: 30_000,
    enabled: courseId !== null,
  });

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  const error = query.error;
  const course = query.data as CourseDetail | undefined;

  // --- enrolment (Stage 5) ---------------------------------------------------
  // Hooks live above every early return. Both queries are gated: a paid or
  // unpriced course never asks the server, and an invalid id never asks. The
  // server is the only source of truth for "am I enrolled" — there is no
  // optimistic local flag anywhere below.
  const queryClient = useQueryClient();
  const genuinelyFree = isGenuinelyFree(course?.is_free ?? false, course?.price ?? null);
  const enrollmentKey = queryKeys.courseEnrollment(courseId ?? '');
  const enrollmentQuery = useQuery({
    queryKey: enrollmentKey,
    queryFn: () => fetchCourseEnrollment(courseId as string),
    enabled: courseId !== null && genuinelyFree,
    staleTime: 30_000,
  });
  const enrollMutation = useMutation({
    mutationFn: () => enrollInFreeCourse(courseId as string),
    // Only after the server has confirmed: write its own row into the cache,
    // then invalidate so the status query re-reads and reconfirms. Nothing is
    // set optimistically, so a failure leaves no half-enrolled state behind.
    onSuccess: (enrollment) => {
      const state: CourseEnrollmentState = {
        enrolled: enrollment.status !== 'cancelled',
        enrollment,
      };
      queryClient.setQueryData(enrollmentKey, state);
      void queryClient.invalidateQueries({ queryKey: enrollmentKey });
      // My Learning reads `queryKeys.myEnrollments`; a confirmed enrolment
      // belongs in that list too, so it refetches instead of missing the row.
      void queryClient.invalidateQueries({ queryKey: queryKeys.myEnrollments });
    },
  });

  // --- invalid / missing id -------------------------------------------------
  if (courseId === null) {
    return (
      <Screen testID="course-detail-invalid-id">
        <BackButton label="Back to courses" />
        <View style={styles.emptyState}>
          <AppIcon name={{ ios: 'exclamationmark.triangle', android: 'error' }} size={48} color={colors.colorTextTertiary} />
          <AppText variant="h3" tone="primary" weight="semibold" style={styles.emptyTitle}>
            Invalid course
          </AppText>
          <AppText variant="body" tone="secondary" style={styles.emptyBody}>
            The course link is not valid. Return to the course catalogue and try again.
          </AppText>
          <Button
            label="Back to courses"
            variant="primary"
            fullWidth
            style={styles.emptyAction}
            onPress={() => router.replace('/learn' as never)}
          />
        </View>
      </Screen>
    );
  }

  // --- loading: skeletons matching the real layout --------------------------
  if (query.isLoading && !course) {
    return (
      <Screen testID="course-detail-loading">
        <BackButton label="Back" />
        <View style={styles.skeletonWrap}>
          <View style={styles.skeletonHero} />
          <View style={styles.skeletonStack}>
            <SkeletonLine width="100%" />
            <SkeletonLine width="80%" />
            <View style={styles.skeletonMeta} />
          </View>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
          <View style={styles.skeletonCurriculum} />
          <View style={styles.skeletonCurriculum} />
          <View style={styles.skeletonCurriculum} />
        </View>
      </Screen>
    );
  }

  // --- error states ---------------------------------------------------------
  if (query.isError && !course) {
    const isNotFound = error instanceof ApiError ? error.status === 404 : false;
    const title = isNotFound ? "We couldn't find this course" : 'Could not load this course';
    const description = isNotFound
      ? 'This course may have been removed or is not available yet.'
      : error instanceof Error
      ? error.message
      : 'Please try again later.';

    return (
      <Screen testID="course-detail-error">
        <BackButton label="Back to courses" />
        <View style={styles.emptyState}>
          <AppIcon name={{ ios: 'exclamationmark.circle', android: 'error_outline' }} size={48} color={colors.colorTextTertiary} />
          <AppText variant="h3" tone="primary" weight="semibold" style={styles.emptyTitle}>
            {title}
          </AppText>
          <AppText variant="body" tone="secondary" style={styles.emptyBody}>{description}</AppText>
          {isNotFound ? (
            <Button
              label="Back to courses"
              variant="primary"
              fullWidth
              style={styles.emptyAction}
              onPress={() => router.replace('/learn' as never)}
            />
          ) : (
            <>
              <StatusBanner
                title="Course didn't load"
                description={description}
                onRetry={() => {
                  void query.refetch();
                }}
              />
              <Button
                label="Back to courses"
                variant="secondary"
                fullWidth
                style={[styles.emptyAction, { marginTop: spacing.sm }]}
                onPress={() => router.replace('/learn' as never)}
              />
            </>
          )}
        </View>
      </Screen>
    );
  }

  if (!course) {
    return null;
  }


  const totals = curriculumTotals(course.sections);
  const price = formatCoursePrice(course.is_free, course.price, course.price_currency);
  const instructor = course.instructor;
  const hasInstructor = Boolean(instructor?.name);
  const courseDescription = course.description;
  const showDescriptionToggle = Boolean(courseDescription && isDescriptionCollapsible(courseDescription));

  const enrollmentState = enrollmentQuery.data;
  const enrolled = enrollmentState?.enrolled ?? false;
  const statusKind: 'loading' | 'error' | 'enrolled' | 'not-enrolled' = enrollmentState
    ? enrolled
      ? 'enrolled'
      : 'not-enrolled'
    : enrollmentQuery.isError
      ? 'error'
      : 'loading';
  const statusHint = enrollmentCardHint(statusKind, course.title);
  const unavailableHint = genuinelyFree
    ? null
    : enrollmentUnavailableHint(price.kind === 'paid' ? 'paid' : 'unknown');

  return (
    <Screen testID="course-detail-screen" bottomInset={layout.bottomNavHeight}>
      <BackButton label="Back to courses" />

      <View style={styles.hero}>
        <View style={styles.heroIconWrap}>
          <AppIcon name={{ ios: 'book.fill', android: 'school' }} size={40} color={colors.colorPrimary} />
        </View>
        <AppText variant="h2" tone="primary" weight="semibold" style={styles.heroTitle} numberOfLines={2}>
          {course.title}
        </AppText>
        {course.skill_level && (
          <AppText variant="caption" tone="tertiary" uppercase style={styles.heroMeta}>
            {course.skill_level.charAt(0).toUpperCase() + course.skill_level.slice(1)}
          </AppText>
        )}
        <View style={styles.priceRow}>
          {price.kind === 'free' ? (
            <Badge tone="success">Free</Badge>
          ) : price.kind === 'paid' ? (
            <View style={styles.pricePaid}>
              <AppText variant="body" tone="primary" weight="semibold">
                {currencySymbol(price.currency)}{price.amount} {price.currency}
              </AppText>
            </View>
          ) : (
            <Badge tone="neutral">Price not set</Badge>
          )}
          {!genuinelyFree && (
            <View style={styles.enrollPill}>
              <AppIcon name={{ ios: 'clock.fill', android: 'schedule' }} size={14} color={colors.colorTextTertiary} />
              <AppText variant="caption" tone="tertiary">
                Enrolment coming soon
              </AppText>
            </View>
          )}
          {genuinelyFree && enrolled && (
            <Badge tone="success">Enrolled</Badge>
          )}
        </View>
      </View>

      {courseDescription ? (
        <Card padded style={styles.card}>
          <AppText variant="label" tone="secondary" uppercase style={styles.sectionEyebrow}>
            About this course
          </AppText>
          <AppText variant="body" tone="secondary" style={styles.bodyText} numberOfLines={descriptionExpanded || !showDescriptionToggle ? undefined : 4}>
            {courseDescription}
          </AppText>
          {showDescriptionToggle && (
            <PressableRow
              label={descriptionExpanded ? 'Show less' : 'Read more'}
              onPress={() => setDescriptionExpanded((prev: boolean) => !prev)}
              expanded={descriptionExpanded}
            />
          )}
        </Card>
      ) : null}

      <View style={styles.metaRow}>
        {course.category && <MetaChip>{course.category}</MetaChip>}
        {course.skill_level && <MetaChip>{course.skill_level.charAt(0).toUpperCase() + course.skill_level.slice(1)}</MetaChip>}
        {course.language && <MetaChip>{course.language}</MetaChip>}
        {course.estimated_duration_minutes && <MetaChip>{formatEstimatedDuration(course.estimated_duration_minutes)}</MetaChip>}
      </View>

      <Card padded style={styles.actionCard}>
        <View style={styles.actionBody}>
          <View style={styles.actionText}>
            <AppText variant="body" tone="primary" weight="semibold" style={styles.actionLabel}>
              {genuinelyFree ? 'Enrol in this course' : 'Enrolment not available'}
            </AppText>
            <AppText variant="caption" tone="secondary" style={styles.actionHint}>
              {genuinelyFree ? statusHint : unavailableHint}
            </AppText>
          </View>
          {genuinelyFree ? (
            <>
              {enrollMutation.isError && (
                <StatusBanner
                  title="Enrolment didn't complete"
                  description={
                    enrollMutation.error instanceof ApiError
                      ? enrollMutation.error.message
                      : 'Please try again.'
                  }
                  onRetry={() => enrollMutation.mutate()}
                />
              )}
              {enrollmentQuery.isError && !enrollmentState && (
                <StatusBanner
                  title="Couldn't check your enrolment"
                  description={
                    enrollmentQuery.error instanceof ApiError
                      ? enrollmentQuery.error.message
                      : 'Please try again.'
                  }
                  onRetry={() => {
                    void enrollmentQuery.refetch();
                  }}
                />
              )}
              <Button
                label={enrolled ? 'Enrolled' : 'Enroll for free'}
                variant="primary"
                fullWidth
                loading={enrollMutation.isPending}
                disabled={enrolled}
                accessibilityHint={
                  enrollmentState
                    ? enrollmentStateSentence(enrolled, course.title)
                    : undefined
                }
                onPress={() => enrollMutation.mutate()}
                style={styles.primaryButton}
              />
            </>
          ) : (
            <Button
              label="Enrolment coming soon"
              variant="primary"
              fullWidth
              loading={false}
              disabled={true}
              accessibilityHint={unavailableHint ?? undefined}
              onPress={() => {}}
              style={styles.primaryButton}
            />
          )}
        </View>
      </Card>

      <View style={styles.section}>
        <AppText variant="h3" tone="primary" weight="semibold" style={styles.sectionTitle}>
          Course curriculum
        </AppText>
        <AppText variant="caption" tone="tertiary" style={styles.sectionSubtitle}>
          {totals.sections} section{totals.sections === 1 ? '' : 's'} · {totals.lectures} lecture{totals.lectures === 1 ? '' : 's'}
        </AppText>
        {course.sections.length === 0 ? (
          <View style={styles.emptyCurriculum}>
            <AppIcon name={{ ios: 'book.closed', android: 'library_books' }} size={32} color={colors.colorTextTertiary} />
            <AppText variant="body" tone="secondary" style={styles.emptyCurriculumText}>
              Curriculum details are not available for this course yet.
            </AppText>
          </View>
        ) : (
          <View style={styles.sectionList}>
            {course.sections.map((section) => {
              const isOpen = expandedSections.has(section.id);
              return (
                <SectionAccordion
                  key={section.id}
                  section={section}
                  courseId={course.id}
                  isOpen={isOpen}
                  onToggle={() => setExpandedSections(toggleExpandedSection(expandedSections, section.id))}
                />
              );
            })}
          </View>
        )}
      </View>

      {hasInstructor && (
        <Card padded style={styles.card}>
          <AppText variant="label" tone="secondary" uppercase style={styles.sectionEyebrow}>
            Course instructor
          </AppText>
          <View style={styles.instructorRow}>
            <AvatarFallback name={instructor.name} size={56} />
            <View style={styles.instructorBody}>
              <AppText variant="body" tone="primary" weight="semibold" style={styles.instructorName} numberOfLines={2}>
                {instructor.name}
              </AppText>
              <PressableRow
                label={`View ${instructor.name}'s profile`}
                onPress={() => router.push(`/user/${instructor.public_id}` as never)}
              />
            </View>
          </View>
        </Card>
      )}

      <View style={styles.section}>
        <AppText variant="label" tone="secondary" uppercase style={styles.sectionEyebrow}>
          Course details
        </AppText>
        <View style={styles.infoRow}>
          {course.created_at && (
            <InfoCell label="Added">
              <AppText variant="body" tone="secondary">{new Date(course.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</AppText>
            </InfoCell>
          )}
          {course.price_currency && price.kind === 'paid' && (
            <InfoCell label="Currency">
              <AppText variant="body" tone="secondary">{course.price_currency}</AppText>
            </InfoCell>
          )}
        </View>
      </View>
    </Screen>
  );
}


// ---------------- primitives ----------------

function SkeletonLine({ width }: { width: DimensionValue }) {
  return <Skeleton height={14} width={width} style={styles.skeletonLine} />;
}

function MetaChip({ children }: { children: ReactNode }) {
  return <Badge tone="neutral" style={styles.metaChip}>{children}</Badge>;
}

function currencySymbol(currency: string | null): string {
  switch (currency) {
    case 'INR': return '₹';
    case 'USD': return '$';
    default: return currency ?? '';
  }
}

function PressableRow({ label, onPress, role, expanded }: { label: string; onPress: () => void; role?: AccessibilityRole; expanded?: boolean }) {
  return (
    <Pressable
      accessibilityRole={role ?? 'button'}
      accessibilityLabel={label}
      {...(expanded !== undefined ? { accessibilityState: { expanded } } : null)}
      onPress={onPress}
      style={styles.pressableRow}
      hitSlop={8}
    >
      <AppText variant="body" tone="primary" weight="semibold" style={styles.pressableLabel}>
        {label}
      </AppText>
      <AppIcon name={{ ios: 'chevron.right', android: 'arrow_forward' }} size={16} color={colors.colorPrimary} />
    </Pressable>
  );
}
function AvatarFallback({ name, size }: { name: string; size: number }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '')).toUpperCase() || '?';
  const tints = ['slate', 'blue', 'sky', 'emerald', 'amber'] as const;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  const tint = tints[hash % tints.length];
  const bg = {
    slate: colors.colorBgMuted,
    blue: colors.colorPrimarySubtle,
    sky: colors.colorInfoSubtle,
    emerald: colors.colorSuccessSubtle,
    amber: colors.colorWarningSubtle,
  }[tint];
  const fg = {
    slate: colors.colorTextSecondary,
    blue: colors.colorPrimary,
    sky: colors.colorInfo,
    emerald: colors.colorSuccess,
    amber: colors.colorWarning,
  }[tint];
  return (
    <View style={[styles.avatar, { width: size, height: size, backgroundColor: bg }]}>
      <AppText variant="body" tone="primary" weight="semibold" style={[styles.avatarText, { color: fg }]}>
        {initials}
      </AppText>
    </View>
  );
}

function SectionAccordion({ section, isOpen, onToggle, courseId }: { section: { id: string; title: string; description: string | null; lectures: readonly { id: string; title: string; kind: 'hosted_video' | 'external_video' | 'reading'; duration_seconds: number | null; is_preview: boolean; external_url: string | null; status: 'draft' | 'published'; description: string | null }[]; }; isOpen: boolean; onToggle: () => void; courseId: string }) {
  const lectureCount = section.lectures.length;
  return (
    <Card padded={false} style={styles.sectionCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Section ${section.title}, ${lectureCount} lecture${lectureCount === 1 ? '' : 's'}`}
        accessibilityState={{ expanded: isOpen }}
        onPress={onToggle}
        style={styles.sectionHeader}
        hitSlop={8}
      >
        <View style={styles.sectionHeaderRow}>
          <AppText variant="body" tone="primary" weight="semibold" style={styles.sectionTitleText} numberOfLines={2}>
            {section.title}
          </AppText>
          <View style={styles.sectionMeta}>
            {lectureCount > 0 ? (
              <AppText variant="caption" tone="tertiary" style={styles.sectionMetaText}>
                {lectureCount} lecture{lectureCount === 1 ? '' : 's'}
              </AppText>
            ) : null}
          </View>
          <AppIcon
            name={{ ios: isOpen ? 'chevron.up' : 'chevron.down', android: isOpen ? 'arrow_drop_up' : 'arrow_drop_down' }}
            size={20}
            color={colors.colorPrimary}
          />
        </View>
        {section.description && (
          <AppText variant="small" tone="secondary" style={[styles.sectionDesc, isOpen ? null : styles.hidden]} numberOfLines={2}>
            {section.description}
          </AppText>
        )}
      </Pressable>
      {isOpen && (
        <View style={styles.lectureList}>
          {section.lectures.map((lecture) => (
            <LectureRow key={lecture.id} lecture={lecture} courseId={courseId} />
          ))}
        </View>
      )}
    </Card>
  );
}

function LectureRow({ lecture, courseId }: { courseId: string; lecture: { id: string; title: string; kind: 'hosted_video' | 'external_video' | 'reading'; duration_seconds: number | null; is_preview: boolean; external_url: string | null; status: 'draft' | 'published'; description: string | null } }) {
  const duration = formatLectureDuration(lecture.duration_seconds);
  const router = useRouter();
  const external = lecture.kind === 'external_video' && lecture.external_url;

  return (
    <Card padded={false} style={styles.lectureCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open lesson: ${lecture.title}`}
        accessibilityHint="Opens this lecture in the player"
        onPress={() => router.push(`/lecture/${lecture.id}?courseId=${courseId}` as never)}
        style={styles.lectureRow}
      >
        <View style={styles.lectureKindWrap}>
          <AppIcon name={{ ios: 'circle', android: 'radio_button_unchecked' }} size={10} color={colors.colorTextDisabled} />
        </View>
        <View style={styles.lectureBody}>
          <AppText variant="body" tone="primary" style={styles.lectureTitle} numberOfLines={1}>
            {lecture.title}
          </AppText>
          <View style={styles.lectureMeta}>
            <Badge tone="neutral" style={styles.kindBadge}>
              {lectureKindLabel(lecture.kind)}
              {lecture.is_preview && ' · Preview'}
            </Badge>
            {duration && <AppText variant="caption" tone="tertiary" style={styles.lectureDuration}>{duration}</AppText>}
          </View>
        </View>
        {external ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${lecture.title} in browser`}
            accessibilityHint="Opens an external website in your device's browser"
            onPress={() => void WebBrowser.openBrowserAsync(lecture.external_url as string)}
            style={styles.externalWrap}
            hitSlop={8}
          >
            <AppIcon name={{ ios: 'arrow.up.right.square', android: 'open_in_new' }} size={16} color={colors.colorPrimary} />
          </Pressable>
        ) : null}
      </Pressable>
    </Card>
  );
}

function InfoCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.infoCell}>
      <AppText variant="caption" tone="tertiary" uppercase style={styles.infoLabel}>
        {label}
      </AppText>
      <AppText variant="body" tone="secondary" style={styles.infoValue}>
        {children}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonWrap: { gap: spacing.md },
  skeletonHero: { height: 200, borderRadius: radius.card, backgroundColor: colors.colorBgMuted },
  skeletonStack: { gap: spacing.sm, marginTop: spacing.sm },
  skeletonMeta: { flexDirection: 'row', gap: spacing.sm },
  skeletonCurriculum: { height: 56, borderRadius: radius.control, backgroundColor: colors.colorBgMuted, marginVertical: spacing.xs },
  skeletonLine: { marginVertical: 2 },

  hero: {
    backgroundColor: colors.colorBgMuted,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.colorBorder,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.control,
    backgroundColor: colors.colorPrimarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: typography.fontSizeH2,
    lineHeight: typography.lineHeightH2,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  heroMeta: { marginTop: spacing.xs },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  pricePaid: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  enrollPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.colorBgMuted,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },

  card: { marginBottom: spacing.md },
  actionCard: { marginBottom: spacing.md },
  actionBody: { gap: spacing.xs },
  actionText: { gap: 2 },
  actionLabel: {},
  actionHint: {},
  primaryButton: { marginTop: spacing.sm },

  section: { marginBottom: spacing.md },
  sectionTitle: { marginBottom: spacing.xs },
  sectionSubtitle: { marginBottom: spacing.sm },
  sectionList: { gap: spacing.sm },
  sectionCard: { marginBottom: 0 },
  sectionHeader: { backgroundColor: 'transparent', borderWidth: 0 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.cardPadding },
  sectionTitleText: { flex: 1, marginRight: spacing.sm },
  sectionMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sectionMetaText: {},
  sectionDesc: { marginTop: spacing.xs },
  hidden: { display: 'none' },
  lectureList: { gap: 0 },
  lectureCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.cardPadding,
    borderBottomWidth: 1,
    borderBottomColor: colors.colorBorder,
  },
  lectureRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lectureKindWrap: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.colorBgMuted, alignItems: 'center', justifyContent: 'center' },
  lectureBody: { flex: 1 },
  lectureTitle: { flex: 1, marginRight: spacing.sm },
  lectureMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  kindBadge: { marginRight: spacing.xs },
  lectureDuration: {},
  externalWrap: { padding: spacing.xs },
  emptyCurriculum: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.sm },
  emptyCurriculumText: { textAlign: 'center' },

  instructorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  instructorBody: { flex: 1 },
  instructorName: { marginBottom: spacing.xs },

  sectionEyebrow: { marginBottom: spacing.sm },
  bodyText: { lineHeight: typography.lineHeightBody },
  pressableRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  pressableLabel: {},
  avatar: { borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  avatarText: {},

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  metaChip: {},

  infoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  infoCell: { flex: 1, gap: spacing.xs },
  infoLabel: {},
  infoValue: {},

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.pagePadding, gap: spacing.lg },
  emptyTitle: { textAlign: 'center' },
  emptyBody: { textAlign: 'center' },
  emptyAction: { alignSelf: 'stretch', marginTop: spacing.sm },
});
