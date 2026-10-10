/**
 * Loading placeholders for Discover, shaped like the real content so the
 * screen does not jump when data lands and never implies rows that do not
 * exist (docs/MOBILE_UX_SPEC.md §5). Built from the shared {@link Skeleton}
 * primitive; the card variant mirrors `OpportunityCard`'s layout — logo +
 * title/company, a badge row, and a three-item metadata row.
 *
 * A single gentle opacity pulse runs across each card so the placeholder reads
 * as "loading" rather than a dead grey block. It is skipped entirely when the
 * OS "reduce motion" preference is on, and the loop is stopped on unmount.
 */

import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/ui/Skeleton';
import { useReduceMotion } from '@/features/feed/useReduceMotion';
import { radius, spacing } from '@/theme/tokens';

/** One card-shaped placeholder, sized to match an opportunity card. */
export function OpportunitySkeleton() {
  const [pulse] = useState(() => new Animated.Value(1));
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View style={[styles.card, { opacity: pulse }]}>
      <View style={styles.row}>
        <Skeleton height={40} width={40} radius={radius.control} />
        <View style={styles.rowText}>
          <Skeleton height={18} width="78%" />
          <Skeleton height={13} width="46%" />
        </View>
      </View>
      <View style={styles.badgeRow}>
        <Skeleton height={26} width={64} radius={radius.full} />
        <Skeleton height={26} width={72} radius={radius.full} />
        <Skeleton height={26} width={68} radius={radius.full} />
      </View>
      <View style={styles.metaRow}>
        <Skeleton height={13} width="34%" />
        <Skeleton height={13} width="40%" />
        <Skeleton height={13} width="30%" />
      </View>
    </Animated.View>
  );
}

/** A short stack of card placeholders for the first load. */
export function OpportunityListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, index) => (
        <OpportunitySkeleton key={index} />
      ))}
    </View>
  );
}

/** A detail-shaped placeholder used while one opportunity is fetched. */
export function OpportunityDetailSkeleton() {
  return (
    <View style={styles.detail}>
      <View style={styles.row}>
        <Skeleton height={56} width={56} radius={radius.control} />
        <View style={styles.rowText}>
          <Skeleton height={22} width="80%" />
          <Skeleton height={16} width="50%" />
        </View>
      </View>
      <View style={styles.badgeRow}>
        <Skeleton height={26} width={64} radius={radius.full} />
        <Skeleton height={26} width={72} radius={radius.full} />
      </View>
      <View style={styles.card}>
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="72%" />
      </View>
      <View style={styles.card}>
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="90%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
  },
  card: {
    gap: spacing.md,
  },
  detail: {
    gap: spacing.lg,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
});
