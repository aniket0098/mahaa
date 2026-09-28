/**
 * Profile statistics — the three-column row and the compact two-column grid.
 *
 * Both are pure presentation: the numbers arrive already derived in
 * `profileModel`, so nothing here can manufacture a value. A count that is still
 * loading renders a skeleton; a count the server never gave us renders an em
 * dash and disables the column, because an unanswered request is not evidence of
 * zero records.
 */

import { Pressable, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { styles } from '@/features/profile/profileStyles';
import { colors } from '@/theme/tokens';
import type { ActivityCard, StatEntry, StatLink } from '@/features/profile/profileModel';

export interface StatRowProps {
  entries: readonly StatEntry[];
  onNavigate: (link: StatLink) => void;
}

export function StatRow({ entries, onNavigate }: StatRowProps) {
  return (
    <View style={styles.statRow} accessibilityRole="summary">
      {entries.map((entry) => {
        const content = (
          <>
            {entry.loading ? (
              <Skeleton height={22} width={40} />
            ) : (
              <AppText
                style={styles.statValue}
                accessibilityLabel={`${entry.value ?? 'unknown'} ${entry.label}`}>
                {entry.value === null ? '—' : String(entry.value)}
              </AppText>
            )}
            <AppText style={styles.statLabel}>{entry.label}</AppText>
          </>
        );

        // A statistic without a real destination is never made to look tappable,
        // and a column whose count is unknown cannot be opened either.
        const disabled = entry.loading || entry.value === null;
        return (
          <Pressable
            key={entry.key}
            accessibilityRole={entry.link.kind === 'scroll' ? 'button' : 'link'}
            accessibilityLabel={`${entry.label}: ${
              entry.loading ? 'loading' : (entry.value ?? 'unavailable')
            }`}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onNavigate(entry.link)}
            style={({ pressed }) => [styles.statCol, pressed ? styles.statColPressed : null]}>
            {content}
          </Pressable>
        );
      })}
    </View>
  );
}

export interface ActivityStatsProps {
  cards: readonly ActivityCard[];
  onNavigate: (link: StatLink) => void;
}

export function ActivityStatsGrid({ cards, onNavigate }: ActivityStatsProps) {
  return (
    <View style={styles.grid}>
      {cards.map((card) => {
        const body = (
          <>
            <View style={styles.activityIcon}>
              <AppIcon name={card.icon} size={18} color={colors.colorPrimary} />
            </View>
            <AppText style={styles.activityValue}>{String(card.value)}</AppText>
            <AppText style={styles.activityTitle}>{card.title}</AppText>
            <AppText style={styles.activityCaption}>{card.caption}</AppText>
          </>
        );

        return (
          <View key={card.key} style={styles.gridCell}>
            {card.link ? (
              <Card
                onPress={() => onNavigate(card.link as StatLink)}
                accessibilityLabel={`${card.title}: ${card.value} ${card.caption}`}
                style={styles.activityCard}>
                {body}
              </Card>
            ) : (
              <Card style={styles.activityCard}>{body}</Card>
            )}
          </View>
        );
      })}
    </View>
  );
}
