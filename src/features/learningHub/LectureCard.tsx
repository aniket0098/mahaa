/**
 * One lecture in the Learning Hub discovery feed.
 *
 * Real rows only: the lecture's title and kind, its course and the course's
 * instructor, and a duration only when the server supplied one. There is no
 * save/bookmark affordance here because no saved-items API exists — a bookmark
 * button that stored nothing would be a lie.
 *
 * Layout: thumbnail on the left, scannable information on the right. A `null`
 * duration or category is simply omitted — nothing is fabricated.
 */

import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { LecturePoster } from '@/features/learningHub/LecturePoster';
import { SaveButton } from '@/features/learningHub/SaveButton';
import { isVideoLecture, type LectureFeedItem } from '@/features/learningHub/learningHubModel';
import { formatLectureDuration, lectureKindLabel } from '@/features/learn/courseDetailModel';
import { useSavedItems } from '@/features/learn/savedModel';
import { colors, radius, spacing, typography } from '@/theme/tokens';

export interface LectureCardProps {
  item: LectureFeedItem;
  onPress: (item: LectureFeedItem) => void;
}

export function LectureCard({ item, onPress }: LectureCardProps) {
  const duration = formatLectureDuration(item.durationSeconds);

  const { savedItems, saveMutation, unsaveMutation } = useSavedItems();
  const isPending = saveMutation.isPending || unsaveMutation.isPending;
  const saved = savedItems.find(
    (s) => s.resource_type === 'lecture' && s.resource_id === item.lectureId
  );
  const isSaved = !!saved;
  const savedItemId = saved?.id ?? null;

  return (
    <Card
      onPress={() => onPress(item)}
      accessibilityLabel={`Lecture: ${item.title}. From ${item.courseTitle}, by ${item.instructorName}.`}
      accessibilityHint="Opens this lecture in the player"
      testID={`lecture-card-${item.lectureId}`}
      style={styles.card}>
      <LecturePoster
        kind={item.kind}
        durationLabel={duration}
        style={styles.poster}
      />

      <View style={styles.body}>
        {item.category ? (
          <AppText variant="caption" tone="secondary" uppercase style={styles.categoryLabel}>
            {item.category}
          </AppText>
        ) : null}
        <AppText variant="h3" weight="semibold" numberOfLines={2} style={styles.title}>
          {item.title}
        </AppText>
        <AppText variant="small" tone="secondary" numberOfLines={1} style={styles.meta}>
          {item.instructorName}
        </AppText>
        <View style={styles.badgeRow}>
          <Badge tone={isVideoLecture(item.kind) ? 'primary' : 'neutral'}>
            {lectureKindLabel(item.kind)}
          </Badge>
          {duration ? <Badge tone="neutral">{duration}</Badge> : null}
        </View>
      </View>
      <SaveButton
            resourceType="lecture"
            resourceId={item.lectureId}
            isSaved={isSaved}
            savedItemId={savedItemId}
            onSave={(resourceType, resourceId) =>
              saveMutation.mutateAsync({ resourceType, resourceId })
            }
            onUnsave={(savedItemIdParam) =>
              unsaveMutation.mutateAsync(savedItemIdParam)
            }
            isPending={isPending}
            accessibilityLabel={isSaved ? 'Unsave lecture' : 'Save lecture'}
            testID={`lecture-card-save-${item.lectureId}`}
          />
        </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.colorBorder,
    position: 'relative',
  },
  saveButton: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
  },
  poster: {
    width: 112,
    aspectRatio: 16 / 9,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  categoryLabel: {
    fontSize: typography.fontSizeCaption,
    marginBottom: 2,
  },
  title: {
    marginBottom: 2,
  },
  meta: {
    marginBottom: spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
