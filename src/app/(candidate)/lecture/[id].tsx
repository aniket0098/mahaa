/**
 * Lecture player — a single lecture inside a course, with real playback.
 *
 * Route: `/lecture/[id]?courseId=...`
 *
 * Data spine (all real server rows):
 *  - `GET /courses/{courseId}` — course + ordered sections + lectures,
 *    shared via `queryKeys.course(courseId)` with the course-detail screen.
 *  - `GET /media/{servedAt}` — the lecture's media bytes, downloaded once
 *    through `loadPlayableVideoUri` and handed to `expo-video` as a local
 *    file URI (the player's `VideoSource` has no header slot).
 *
 * No lecture-feed endpoint exists; the lecture is always located within its
 * course's curriculum. No completion percentage is computed client-side —
 * the server owns that (`GET /profile/completeness`, a later stage).
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQuery } from '@tanstack/react-query';

import { fetchCourse } from '@/api/courses';
import { resolveLectureVideoUri } from '@/api/lectures';
import { queryKeys } from '@/api/queryKeys';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { LecturePlayer, LectureNonVideoSurface } from '@/features/learn/LecturePlayer';
import {
  isPlayableVideo,
  resolveExternalUrl,
  resolveLecture,
  resolveLectureDuration,
  resolveLectureKindLabel,
} from '@/features/learn/lecturePlayerModel';
import { colors, spacing, typography, radius } from '@/theme/tokens';
import type { CourseDetail } from '@/types/course';

export default function LecturePlayerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string | string[];
    courseId?: string | string[];
  }>();

  const lectureId = (typeof params.id === 'string' ? params.id : String(params.id ?? '')).trim();
  const courseIdRaw = params.courseId;
  const courseId =
    courseIdRaw != null
      ? Array.isArray(courseIdRaw)
        ? courseIdRaw[0]
        : courseIdRaw
      : null;

  const courseQuery = useQuery({
    queryKey: queryKeys.course(courseId ?? ''),
    queryFn: () => fetchCourse(courseId as string),
    staleTime: 60_000,
    enabled: courseId !== null && lectureId.length > 0,
  });

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<Error | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [curriculumOpen, setCurriculumOpen] = useState(false);

  const course = courseQuery.data as CourseDetail | undefined;
  const courseError = courseQuery.error;

  const resolved = useMemo(() => {
    if (!course || !lectureId) return null;
    try {
      return resolveLecture({ courseId: course.id, lectureId, course });
    } catch {
      return null;
    }
  }, [course, lectureId]);

  const lecture = resolved?.lecture;

  const servedAt = useMemo(() => {
    if (!lecture || !isPlayableVideo(lecture) || !lecture.media_id) return null;
    return `/api/v1/media/${lecture.media_id}`;
  }, [lecture]);

  const curriculumFlat = useMemo(() => {
    const rows: { id: string; title: string; sectionTitle: string }[] = [];
    if (course) {
      for (const section of course.sections) {
        for (const item of section.lectures) {
          rows.push({ id: item.id, title: item.title, sectionTitle: section.title });
        }
      }
    }
    return rows;
  }, [course]);

  const lessonNumber = lecture ? curriculumFlat.findIndex((row) => row.id === lecture.id) + 1 : 0;
  const lessonTotal = curriculumFlat.length;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!servedAt) {
        if (!cancelled) {
          setVideoUri(null);
          setResolveError(null);
        }
        return;
      }
      if (!cancelled) {
        setIsResolving(true);
        setResolveError(null);
      }
      try {
        const uri = await resolveLectureVideoUri(servedAt);
        if (!cancelled) {
          setVideoUri(uri);
          setIsResolving(false);
        }
      } catch (err) {
        if (!cancelled) {
          setResolveError(err instanceof Error ? err : new Error(String(err)));
          setVideoUri(null);
          setIsResolving(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [servedAt]);

  const sectionTitle = resolved?.sectionTitle ?? '';
  const prevLectureId = resolved?.prevLectureId ?? null;
  const nextLectureId = resolved?.nextLectureId ?? null;
  const isFirst = resolved?.isFirst ?? true;
  const isLast = resolved?.isLast ?? true;

  // --- error surfaces ------------------------------------------------------

  if (courseError != null || courseQuery.isError) {
    const message =
      courseError instanceof Error ? courseError.message : String(courseError);
    return (
      <Screen testID="lecture-player-error-screen">
        <BackButton label="Back to course" />
        <View style={styles.errorContainer}>
          <StatusBanner
            title="Couldn't load this lecture"
            description={
              message.includes('404') || message.includes('not found')
                ? 'This lecture is no longer available.'
                : message
            }
            onRetry={() => void courseQuery.refetch()}
          />
          {courseId != null && (
            <Button
              label="Open course"
              variant="secondary"
              fullWidth
              onPress={() => router.push(`/course/${courseId}` as never)}
              style={styles.openCourseButton}
            />
          )}
        </View>
      </Screen>
    );
  }

  if (courseQuery.isLoading || !course) {
    return null;
  }

  if (!resolved || !lecture) {
    return (
      <Screen testID="lecture-player-not-found">
        <BackButton label="Back to course" />
        <View style={styles.errorContainer}>
          <StatusBanner
            title="Lecture not found"
            description="This lecture isn't part of the course's curriculum."
            onRetry={() => void courseQuery.refetch()}
          />
          <Button
            label="Open course"
            variant="secondary"
            fullWidth
            onPress={() => router.push(`/course/${course.id}` as never)}
            style={styles.openCourseButton}
          />
        </View>
      </Screen>
    );
  }

  // --- ready ---------------------------------------------------------------

  const durationLabel = resolveLectureDuration(lecture.duration_seconds);
  const kindLabel = resolveLectureKindLabel(lecture.kind);
  const isPreview = lecture.is_preview;
  const openExternal = (url: string) => {
    // Reuse the model's HTTPS validation (single source of truth) so only a
    // validated link reaches the browser.
    const safeUrl = resolveExternalUrl(url);
    if (safeUrl) {
      void WebBrowser.openBrowserAsync(safeUrl);
    }
  };
  const lessonLabel =
    lessonNumber > 0 && lessonTotal > 0
      ? `Lesson ${lessonNumber} of ${lessonTotal}`
      : null;

  return (
    <Screen scrollable={false} testID="lecture-player-screen">
      <BackButton label="Back to course" />

      <View style={styles.header}>
        <AppText variant="small" tone="secondary" uppercase style={styles.headerKicker}>
          {sectionTitle}
        </AppText>
        <AppText variant="h3" tone="primary" weight="semibold" style={styles.headerTitle} numberOfLines={2}>
          {lecture.title}
        </AppText>
        {lessonLabel && (
          <AppText variant="caption" tone="tertiary" style={styles.lessonProgress}>
            {lessonLabel}
          </AppText>
        )}
        <View style={styles.headerMeta}>
          {durationLabel && (
            <View style={styles.metaChip}>
              <AppText variant="caption" tone="tertiary" uppercase>
                {durationLabel}
              </AppText>
            </View>
          )}
          <View style={styles.metaChip}>
            <AppText variant="caption" tone="tertiary" uppercase>
              {kindLabel}
            </AppText>
          </View>
          {isPreview && (
            <View style={styles.metaChipPreview}>
              <AppText variant="caption" tone="primary" uppercase>
                Preview
              </AppText>
            </View>
          )}
        </View>
      </View>

      {isPlayableVideo(lecture) && lecture.media_id ? (
        <LecturePlayer
          lecture={lecture}
          videoUri={videoUri}
          isLoading={isResolving}
          error={resolveError}
          onRetry={() => {
            setResolveError(null);
            setIsResolving(true);
            const servedAt = lecture.media_id ? `/api/v1/media/${lecture.media_id}` : null;
            if (!servedAt) {
              setIsResolving(false);
              return;
            }
            resolveLectureVideoUri(servedAt)
              .then((uri) => {
                setVideoUri(uri);
                setIsResolving(false);
              })
              .catch((err) => {
                setVideoUri(null);
                setResolveError(err instanceof Error ? err : new Error(String(err)));
                setIsResolving(false);
              });
          }}
          onOpenExternal={openExternal}
          onClose={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/home' as never);
          }}
          onCurriculumPress={() => setCurriculumOpen(true)}
        />
      ) : (
        <LectureNonVideoSurface lecture={lecture} onOpenExternal={openExternal} />
      )}

      <View style={styles.infoContainer}>
        <View style={styles.courseContext}>
          <Pressable
            accessibilityLabel={`Open course: ${course.title}`}
            accessibilityHint="Opens the course detail page"
            onPress={() => router.push(`/course/${course.id}` as never)}
            style={styles.coursePressable}
          >
            <AppText variant="body" tone="secondary" style={styles.courseTitle}>
              {course.title}
            </AppText>
            <AppText variant="caption" tone="tertiary">
              by {course.instructor.name}
            </AppText>
          </Pressable>
        </View>

        <View style={styles.actionsRow}>
          {!isFirst && prevLectureId && (
            <Button
              label="Previous"
              variant="ghost"
              onPress={() => {
                void router.push(`/lecture/${prevLectureId}?courseId=${course.id}` as never);
              }}
              style={styles.navButton}
            />
          )}
          {!isLast && nextLectureId && (
            <Button
              label="Next"
              variant="ghost"
              onPress={() => {
                void router.push(`/lecture/${nextLectureId}?courseId=${course.id}` as never);
              }}
              style={styles.navButton}
            />
          )}
          <Button
            label="Curriculum"
            variant="secondary"
            onPress={() => setCurriculumOpen(true)}
            style={styles.navButton}
          />
          <Button
            label="Open course"
            variant="secondary"
            onPress={() => router.push(`/course/${course.id}` as never)}
            style={styles.openCourseButton}
          />
        </View>

        {lecture.description && (
          <View style={styles.descriptionSection}>
            <AppText variant="label" tone="secondary" uppercase style={styles.sectionLabel}>
              About this lecture
            </AppText>
            <AppText variant="body" tone="secondary" style={styles.descriptionText}>
              {lecture.description}
            </AppText>
          </View>
        )}
      </View>

      <CurriculumSheet
        visible={curriculumOpen}
        onClose={() => setCurriculumOpen(false)}
        rows={curriculumFlat}
        activeId={lecture.id}
        onSelect={(selectedId) => {
          setCurriculumOpen(false);
          if (selectedId !== lecture.id) {
            void router.push(`/lecture/${selectedId}?courseId=${course.id}` as never);
          }
        }}
      />
    </Screen>
  );
}

function CurriculumSheet({
  visible,
  onClose,
  rows,
  activeId,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  rows: { id: string; title: string; sectionTitle: string }[];
  activeId: string;
  onSelect: (lectureId: string) => void;
}) {
  const SHEET_CLOSE_ICON = { ios: 'xmark', android: 'close' } as const;
  const SHEET_PLAY_ICON = { ios: 'play.fill', android: 'play_arrow' } as const;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <AppText variant="h3" tone="primary" weight="semibold">
              Curriculum
            </AppText>
            <Pressable
              accessibilityLabel="Close curriculum"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={styles.sheetClose}
              testID="curriculum-sheet-close"
            >
              <AppIcon name={SHEET_CLOSE_ICON} size={20} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetListContent}>
            {rows.map((row, index) => {
              const startsSection =
                index === 0 || rows[index - 1].sectionTitle !== row.sectionTitle;
              const active = row.id === activeId;
              return (
                <View key={row.id}>
                  {startsSection && (
                    <AppText
                      variant="label"
                      tone="tertiary"
                      uppercase
                      style={styles.sheetSection}
                    >
                      {row.sectionTitle}
                    </AppText>
                  )}
                  <Pressable
                    accessibilityLabel={`Lesson ${index + 1}: ${row.title}`}
                    accessibilityRole="button"
                    onPress={() => onSelect(row.id)}
                    style={[styles.sheetRow, active ? styles.sheetRowActive : null]}
                    testID={`curriculum-row-${row.id}`}
                  >
                    {active ? (
                      <AppIcon name={SHEET_PLAY_ICON} size={16} color={colors.colorPrimary} />
                    ) : (
                      <AppText variant="caption" tone="tertiary" style={styles.sheetRowIndex}>
                        {String(index + 1).padStart(2, '0')}
                      </AppText>
                    )}
                    <AppText
                      variant="body"
                      tone={active ? 'primary' : 'secondary'}
                      weight={active ? 'semibold' : 'regular'}
                      numberOfLines={2}
                      style={styles.sheetRowText}
                    >
                      {row.title}
                    </AppText>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.pagePadding,
    gap: spacing.md,
  },
  openCourseButton: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
  header: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: spacing.pagePadding,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  headerKicker: {
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightSemibold,
    color: colors.colorTextSecondary,
    textTransform: 'uppercase',
  },
  headerTitle: {
    fontSize: typography.fontSizeH3,
    fontWeight: typography.fontWeightSemibold,
    lineHeight: typography.lineHeightH3,
    color: colors.colorTextPrimary,
  },
  headerMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  metaChip: {
    backgroundColor: colors.colorBgMuted,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  metaChipPreview: {
    backgroundColor: colors.colorInfoSubtle,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  infoContainer: {
    paddingHorizontal: spacing.pagePadding,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  courseContext: {
    gap: spacing.xs,
  },
  coursePressable: {
    gap: spacing.xs,
  },
  courseTitle: {
    fontSize: typography.fontSizeBody,
    fontWeight: typography.fontWeightSemibold,
    color: colors.colorTextPrimary,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  navButton: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightSemibold,
    color: colors.colorTextSecondary,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  descriptionSection: {
    gap: spacing.xs,
  },
  descriptionText: {
    fontSize: typography.fontSizeBody,
    lineHeight: typography.lineHeightBody,
    color: colors.colorTextSecondary,
  },
  lessonProgress: {
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightSemibold,
    color: colors.colorTextTertiary,
    marginTop: spacing.xs,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: colors.colorOverlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.colorBgSurface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingBottom: spacing.xl,
    maxHeight: '85%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.pagePadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.colorBorder,
  },
  sheetClose: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetListContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  sheetSection: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sheetRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.control,
  },
  sheetRowActive: {
    backgroundColor: colors.colorPrimarySubtle,
  },
  sheetRowIndex: {
    width: 24,
    textAlign: 'center',
  },
  sheetRowText: {
    flex: 1,
  },
});