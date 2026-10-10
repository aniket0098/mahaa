/**
 * DiscoverResultsSummary — the one results-context block: how many match, which
 * facets are narrowing the feed, and a way to drop them.
 *
 * Everything here is a pure read of the current filter state, so the active
 * facets are summarised in exactly one place and never repeated down the page.
 * The count is the server's `total` for the current filter — never a client
 * guess. When nothing is filtering and nothing matches, it says so plainly
 * ("Newest postings first") rather than a flat "0 results".
 *
 * "Clear all" appears only once two or more facets are active, where removing
 * them one tap at a time would be tedious; a single facet removes itself with
 * its own ×.
 */

import { Pressable, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { colors } from '@/theme/tokens';

import type { DiscoverFacet } from './discoverFilters';
import { styles } from './discoverStyles';

export interface DiscoverResultsSummaryProps {
  /** The server's total for the current filter. */
  total: number;
  /** True when a search term, category, or work mode is narrowing the feed. */
  isFiltered: boolean;
  /** The removable facets, in the order the model lists them. */
  facets: readonly DiscoverFacet[];
  /** Removes every facet at once. */
  onClearAll: () => void;
}

export function DiscoverResultsSummary({
  total,
  isFiltered,
  facets,
  onClearAll,
}: DiscoverResultsSummaryProps) {
  const countLine =
    total > 0
      ? `${total} ${isFiltered ? 'result' : 'open opportunit'}${total === 1 ? 'y' : 'ies'}`
      : isFiltered
        ? null
        : 'Newest postings first';

  return (
    <View style={styles.resultsBlock}>
      {countLine ? (
        <AppText variant="small" tone="secondary" accessibilityRole="header">
          {countLine}
        </AppText>
      ) : null}

      {facets.length > 0 ? (
        <View style={styles.facetRow}>
          {facets.map((facet) => (
            <Pressable
              key={facet.id}
              onPress={facet.onRemove}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${facet.label} filter`}
              style={styles.facetChip}>
              <AppText variant="caption" weight="semibold" tone="accent">
                {facet.label}
              </AppText>
              <AppIcon name={{ ios: 'xmark', android: 'close' }} size={14} color={colors.colorPrimary} />
            </Pressable>
          ))}
          {facets.length >= 2 ? (
            <Pressable
              onPress={onClearAll}
              accessibilityRole="button"
              accessibilityLabel="Clear all filters"
              hitSlop={8}
              style={styles.clearAll}>
              <AppText variant="caption" weight="semibold" tone="accent">
                Clear all
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
