/**
 * One course in the Learning Hub catalogue.
 *
 * The thumbnail is a media pointer id, never a URL ? media read rules gate the
 * bytes (`GET /media/{id}`), so this component only renders the metadata it can
 * show today: title, description, skill level, estimated duration, instructor,
 * category, and an optional enrolment date (My Learning only).
 *
 * Premium redesign additions (Phase 5):
 *  - Skill level badge with semantic color
 *  - Estimated duration chip (when available)
 *  - Instructor name line
 *  - Save/bookmark affordance (when `onSaveToggle` is provided)
 *  - Enrolled date (My Learning only, unchanged)
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { colors, layout, radius, spacing, typography } from '@/theme/tokens';
import type { Course } from '@/types/course';
import { formatEstimatedDuration } from '@/features/learn/courseDetailModel';

export interface CourseCardProps {
  course: Course;
  onPress: (course: Course) => void;
  /** The enrolment's `created_at` (My Learning only). */
  enrolledAt?: string;
  /** Whether this course is saved by the caller. */
  saved?: boolean;
  /** Toggle save; when provided the card shows a bookmark affordance. */
  onSaveToggle?: (course: Course) => void;
  /** Whether the save action is in flight. */
  savePending?: boolean;
}

export function CourseCard({
  course,
  onPress,
  enrolledAt,
  saved = false,
  onSaveToggle,
  savePending = false,
}: CourseCardProps) {
  const enrolledLabel = enrolledAt ? enrolledOnLabel(enrolledAt) : null;
  const durationLabel = formatEstimatedDuration(course.estimated_duration_minutes);
  const skillLevelLabel = course.skill_level
    ? course.skill_level.charAt(0).toUpperCase() + course.skill_level.slice(1)
    : null;

  return (
    <Card
      onPress={() => onPress(course)}
      accessibilityLabel={`Course: ${course.title}${skillLevelLabel ? `, ${skillLevelLabel}` : ''}${durationLabel ? `, ${durationLabel}` : ''}`}
      accessibilityHint="Opens the course detail page"
      testID={`course-card-${course.id}`}
      style={styles.card}>
      <View style={styles.thumbnailWrap}>
        <View style={styles.thumbnail}>
          <AppText variant="h3" weight="bold" tone="tertiary" style={styles.thumbnailGlyph}>
            {course.title.charAt(0).toUpperCase()}
          </AppText>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <AppText variant="h3" tone="primary" weight="semibold" numberOfLines={2} style={styles.title}>
            {course.title}
          </AppText>
          {onSaveToggle ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={saved ? 'Remove from saved' : 'Save course'}
              accessibilityHint={saved ? 'Removes this course from your saved list' : 'Saves this course for later'}
              disabled={savePending}
              onPress={(e) => {
                e.stopPropagation();
                onSaveToggle(course);
              }}
              hitSlop={8}
              style={({ pressed }) => [styles.saveButton, pressed && styles.savePressed]}>
              <AppIcon
                name={saved ? { ios: 'bookmark.fill', android: 'bookmark' } : { ios: 'bookmark', android: 'bookmark_border' }}
                size={20}
                color={saved ? colors.colorPrimary : colors.colorTextTertiary}
              />
            </Pressable>
          ) : null}
        </View>

        {course.description ? (
          <AppText variant="small" tone="secondary" numberOfLines={2} style={styles.description}>
            {course.description}
          </AppText>
        ) : null}

        <View style={styles.meta}>
          {skillLevelLabel ? (
            <Badge tone="primary">
              {skillLevelLabel}
            </Badge>
          ) : null}
          {durationLabel ? (
            <Badge tone="neutral">
              {durationLabel}
            </Badge>
          ) : null}
          {course.category ? (
            <AppText variant="caption" tone="tertiary" uppercase style={styles.category}>
              {course.category}
            </AppText>
          ) : null}
          {enrolledLabel ? (
            <AppText variant="caption" tone="tertiary" uppercase style={styles.enrolled}>
              {enrolledLabel}
            </AppText>
          ) : null}
        </View>

        <AppText variant="small" tone="tertiary" numberOfLines={1} style={styles.instructor}>
          {course.instructor.name}
        </AppText>
      </View>
    </Card>
  );
}

function enrolledOnLabel(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `Enrolled ${formatted}`;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  thumbnailWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  thumbnail: {
    flex: 1,
    backgroundColor: colors.colorPrimarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailGlyph: {
    fontSize: typography.fontSizeH1,
    color: colors.colorPrimary,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  title: {
    flex: 1,
  },
  saveButton: {
    minWidth: layout.touchTargetSecondary,
    minHeight: layout.touchTargetSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
  },
  savePressed: {
    opacity: 0.6,
  },
  description: {
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  category: {
    fontSize: typography.fontSizeCaption,
  },
  enrolled: {
    fontSize: typography.fontSizeCaption,
  },
  instructor: {
    marginTop: spacing.xs,
  },
});
