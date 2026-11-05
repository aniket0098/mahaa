/**
 * Demo lecture card — a clearly labeled sample lesson in the catalogue.
 *
 * Demo lessons are not server-published lectures. They carry no server
 * lecture id, so they cannot be saved or opened in the lecture player.
 * Tapping one navigates to an honest demo detail/preview state.
 */

import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { LecturePoster } from '@/features/learningHub/LecturePoster';
import { type CatalogItem } from '@/features/learningHub/learningHubModel';
import { colors, radius, spacing, typography } from '@/theme/tokens';

export interface DemoLectureCardProps {
  item: CatalogItem;
  onPress: (item: CatalogItem) => void;
}

export function DemoLectureCard({ item, onPress }: DemoLectureCardProps) {
  return (
    <Card
      onPress={() => onPress(item)}
      accessibilityLabel={`Demo lesson: ${item.title}. Sample content.`}
      accessibilityHint="Opens this demo lesson preview"
      testID={`demo-lecture-card-${item.id}`}
      style={styles.card}>
      <LecturePoster
        kind="hosted_video"
        durationLabel={null}
        style={styles.poster}
      />
      <View style={styles.body}>
        <Badge tone="info" style={styles.demoBadge}>
          DEMO
        </Badge>
        <AppText variant="h3" weight="semibold" numberOfLines={2} style={styles.title}>
          {item.title}
        </AppText>
        {item.description ? (
          <AppText
            variant="small"
            tone="secondary"
            numberOfLines={2}
            style={styles.description}>
            {item.description}
          </AppText>
        ) : null}
        <AppText
          variant="caption"
          tone="secondary"
          uppercase
          style={styles.categoryLabel}>
          Sample lesson
        </AppText>
      </View>
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
  poster: {
    width: 112,
    aspectRatio: 16 / 9,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  demoBadge: {
    minHeight: 22,
    paddingHorizontal: spacing.xs,
  },
  title: {
    marginBottom: 2,
  },
  description: {
    marginBottom: spacing.xs,
  },
  categoryLabel: {
    fontSize: typography.fontSizeCaption,
    marginBottom: 2,
  },
});
