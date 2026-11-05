/**
 * Featured lecture hero banner — the premium highlight at the top of Lectures.
 *
 * Uses a deep-purple → vivid-blue → cyan gradient for the featured lecture
 * only. Every field is real server data: the lecture's own title, duration,
 * course, category and the course's instructor. A `null` duration or category
 * is simply omitted — nothing is fabricated.
 *
 * Tapping the banner opens the lecture player (`/lecture/[id]?courseId=...`);
 * the player resolves the lecture from the same `GET /courses/{id}` row this
 * feed used. Save/unsave is server-persisted via `POST /saved` /
 * `DELETE /saved/{id}`.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LecturePoster } from '@/features/learningHub/LecturePoster';
import { SaveButton } from '@/features/learningHub/SaveButton';
import { type LectureFeedItem } from '@/features/learningHub/learningHubModel';
import { formatLectureDuration } from '@/features/learn/courseDetailModel';
import { useSavedItems } from '@/features/learn/savedModel';
import { colors, radius, spacing, typography } from '@/theme/tokens';

export interface FeaturedLectureCardProps {
  item: LectureFeedItem;
  onPress: (item: LectureFeedItem) => void;
}

export function FeaturedLectureCard({ item, onPress }: FeaturedLectureCardProps) {
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
      padded={false}
      onPress={() => onPress(item)}
      accessibilityLabel={`Featured lecture: ${item.title}. From ${item.courseTitle}, by ${item.instructorName}.`}
      accessibilityHint="Opens this lecture in the player"
      testID="featured-lecture-card"
      style={styles.card}>
      <LinearGradient
        colors={[
          colors.colorPrimary,
          '#3169F5',
          '#13B9F5',
        ]}
        style={styles.gradient}>
        <View style={styles.posterWrap}>
          <LecturePoster
            kind={item.kind}
            durationLabel={duration}
            iconSize={36}
            style={styles.poster}
          />
        </View>

        <View style={styles.body}>
          <View style={styles.badgeRow}>
            <Badge tone="primary" style={styles.featuredBadge}>
              FEATURED LECTURE
            </Badge>
            {duration ? <Badge tone="neutral">{duration}</Badge> : null}
            {item.category ? <Badge tone="neutral">{item.category}</Badge> : null}
            {item.isPreview ? <Badge tone="info">Preview</Badge> : null}
          </View>

          <AppText variant="h1" weight="semibold" numberOfLines={2} style={styles.title}>
            {item.title}
          </AppText>
          <AppText variant="small" tone="secondary" numberOfLines={2} style={styles.subtitle}>
            From {item.courseTitle}, by {item.instructorName}.
          </AppText>

          <View style={styles.actions}>
            <Button
              label="Watch now"
              variant="primary"
              size="lg"
              loading={isPending}
              disabled={isPending}
              onPress={() => onPress(item)}
              fullWidth
              accessibilityHint="Opens this featured lecture in the player"
            />
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
              accessibilityLabel={isSaved ? 'Unsave featured lecture' : 'Save featured lecture'}
              testID="featured-lecture-save"
            />
          </View>
        </View>
      </LinearGradient>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderRadius: radius.sheet,
    borderWidth: 0,
  },
  gradient: {
    borderRadius: radius.sheet,
    overflow: 'hidden',
    padding: spacing.lg,
    minHeight: 260,
  },
  posterWrap: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 220,
    aspectRatio: 16 / 9,
    marginBottom: spacing.md,
  },
  poster: {
    width: '100%',
    height: '100%',
    borderRadius: radius.card,
  },
  body: {
    gap: spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  featuredBadge: {
    minHeight: 24,
    paddingHorizontal: spacing.md,
  },
  title: {
    color: colors.colorTextOnPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.colorTextOnPrimary,
    opacity: 0.9,
    marginBottom: spacing.lg,
    lineHeight: typography.lineHeightBody,
  },
  actions: {
    gap: spacing.sm,
  },
});

