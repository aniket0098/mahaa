/** Playlist card for the Lectures home screen. *
 *
 * One card carries either a real course-derived playlist (placeholder for a
 * later stage, rendered honestly) or the clearly labeled demo playlist. The
 * demo playlist's lesson titles are sample titles — not claims that public
 * videos already exist — and each lesson opens its real server lecture when
 * one is available, otherwise an honest unavailable state.
 */

import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LecturePoster } from '@/features/learningHub/LecturePoster';
import { formatLectureDuration } from '@/features/learn/courseDetailModel';
import { DEMO_PLAYLIST, type DemoPlaylist } from '@/features/learningHub/demoPlaylist';
import { colors, radius, spacing, typography } from '@/theme/tokens';

export interface PlaylistCardProps {
  playlist: DemoPlaylist;
  onPress: (playlist: DemoPlaylist) => void;
}

export function PlaylistCard({ playlist, onPress }: PlaylistCardProps) {
  const lectureCount = playlist.lectures.length;

  return (
    <Card
      onPress={() => onPress(playlist)}
      accessibilityLabel={`Playlist: ${playlist.title}. ${lectureCount} lessons.`}
      accessibilityHint="Opens this playlist"
      testID={`playlist-card-${playlist.id}`}
      style={styles.card}>
      <View style={styles.thumbWrap}>
        <LecturePoster
          kind="hosted_video"
          durationLabel={null}
          iconSize={36}
          style={styles.poster}
        />
        <View style={styles.demoBadgeWrap}>
          <Badge tone="info" style={styles.demoBadge}>
            DEMO
          </Badge>
        </View>
      </View>

      <View style={styles.body}>
        <AppText variant="caption" tone="secondary" uppercase style={styles.kicker}>
          Playlist
        </AppText>
        <AppText variant="h3" weight="semibold" numberOfLines={2} style={styles.title}>
          {playlist.title}
        </AppText>
        <AppText variant="small" tone="secondary" numberOfLines={2} style={styles.description}>
          {playlist.description}
        </AppText>
        <View style={styles.metaRow}>
          <AppText variant="small" tone="secondary" style={styles.meta}>
            {lectureCount} lesson{lectureCount === 1 ? '' : 's'}
          </AppText>
          <AppText variant="small" tone="secondary" style={styles.meta}>
            Sample lessons
          </AppText>
        </View>
      </View>

      <View style={styles.action}>
        <Button
          label="View playlist"
          variant="secondary"
          size="md"
          onPress={() => onPress(playlist)}
          fullWidth
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.colorBorder,
  },
  thumbWrap: {
    width: 130,
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    borderRadius: radius.card,
    position: 'relative',
  },
  poster: {
    width: '100%',
    height: '100%',
    borderRadius: radius.card,
  },
  demoBadgeWrap: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
  },
  demoBadge: {
    minHeight: 22,
    paddingHorizontal: spacing.xs,
  },
  body: {
    flex: 1,
    gap: spacing.xs,
  },
  kicker: {
    fontSize: typography.fontSizeCaption,
    marginBottom: 2,
  },
  title: {
    marginBottom: 4,
  },
  description: {
    marginBottom: spacing.xs,
    lineHeight: typography.lineHeightBody,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  meta: {
    fontSize: typography.fontSizeSmall,
  },
  action: {
    alignSelf: 'flex-start',
  },
});
