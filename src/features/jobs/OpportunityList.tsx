/**
 * OpportunityList — the Discover feed: search, categories, filters, and the
 * paged list of real opportunities.
 *
 * This component owns the three pieces of filter state (search text, category,
 * work mode) because they are all facets of one list. The debounced search
 * feeds the query key, so a filter change is a new keyed request from page 1 —
 * the previous filter's rows are never carried over and shown as if they
 * belonged to the new one.
 *
 * States, each distinct (docs/MOBILE_UX_SPEC.md §5):
 *  - first load      -> card-shaped skeletons, never a bare spinner;
 *  - first-page fail -> a persistent error banner with Retry;
 *  - empty           -> one of three honest messages (nothing published / no
 *                       search match / no filter match), each with a working
 *                       action;
 *  - results         -> cards, with a footer that loads more, retries a failed
 *                       next page, or says the end was reached.
 *
 * Pagination is a real infinite query over the API's `FastApiPage` envelope;
 * pull-to-refresh re-reads it. There is no invented page, count, or ranking.
 */

import { useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, RefreshControl, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import type { WorkMode } from '@/types/opportunity';
import { colors } from '@/theme/tokens';

import { DiscoverCategoryTabs } from './DiscoverCategoryTabs';
import { DiscoverFilterBar } from './DiscoverFilterBar';
import { DiscoverHeader } from './DiscoverHeader';
import { DiscoverResultsSummary } from './DiscoverResultsSummary';
import { OpportunityCard } from './OpportunityCard';
import { OpportunityEmptyState } from './OpportunityEmptyState';
import { OpportunityListSkeleton } from './OpportunitySkeleton';
import {
  DEFAULT_CATEGORY_ID,
  activeFacets,
  categoryToType,
  filterToQueryRecord,
  type DiscoverFilterState,
} from './discoverFilters';
import { styles } from './discoverStyles';
import { useOpportunityList } from './useOpportunityList';
import { useDebouncedValue } from './useDebouncedValue';

/** Long enough to swallow a fast typist, short enough to feel immediate. */
const SEARCH_DEBOUNCE_MS = 350;

interface EmptyState {
  icon: { ios: string; android: string };
  title: string;
  description: string;
  action?: { label: string; onPress: () => void };
}

/**
 * Which empty message fits the current state. Search is the most specific
 * cause, so it is checked first; then an active category/work-mode filter; then
 * the genuine "nothing published yet". Each returns a working action and an
 * icon that reads as a decision, not a bug.
 */
function emptyStateFor(state: {
  searchQuery: string;
  filter: DiscoverFilterState;
  onClearSearch: () => void;
  onClearFilters: () => void;
}): EmptyState {
  const trimmed = state.searchQuery.trim();
  if (trimmed) {
    return {
      icon: { ios: 'magnifyingglass', android: 'search_off' },
      title: `No results for “${trimmed}”`,
      description:
        'Nothing matched your search. Try different keywords, or clear the search to see everything.',
      action: { label: 'Clear search', onPress: state.onClearSearch },
    };
  }
  if (state.filter.workMode || categoryToType(state.filter.category)) {
    return {
      icon: { ios: 'line.3.horizontal.decrease', android: 'filter_alt_off' },
      title: 'Nothing matches these filters',
      description:
        'No opportunities match the selected filters right now. Try clearing them to see the full list.',
      action: { label: 'Clear filters', onPress: state.onClearFilters },
    };
  }
  return {
    icon: { ios: 'tray', android: 'inbox' },
    title: 'No opportunities yet',
    description:
      'Published opportunities from companies will appear here. Check back soon — new postings show up as they go live.',
  };
}

export function OpportunityList() {
  const [searchInput, setSearchInput] = useState('');
  const searchQuery = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY_ID);
  const [workMode, setWorkMode] = useState<WorkMode | null>(null);

  const filter: DiscoverFilterState = { category, workMode, query: searchQuery };
  const view = useOpportunityList(filterToQueryRecord(filter));

  const clearSearch = () => setSearchInput('');
  const clearCategory = () => setCategory(DEFAULT_CATEGORY_ID);
  const clearWorkMode = () => setWorkMode(null);
  // The empty-state action and the summary's "Clear all" return to the broadest
  // view: no search, no category, no work mode — every facet at once.
  const clearAll = () => {
    setSearchInput('');
    setCategory(DEFAULT_CATEGORY_ID);
    setWorkMode(null);
  };

  const empty = emptyStateFor({ searchQuery, filter, onClearSearch: clearSearch, onClearFilters: clearAll });
  const facets = activeFacets(filter, { onClearSearch: clearSearch, onClearCategory: clearCategory, onClearWorkMode: clearWorkMode });

  const listHeader = (
    <View style={styles.headerBlock}>
      <DiscoverCategoryTabs selectedId={category} onSelect={setCategory} />
      <DiscoverFilterBar workMode={workMode} onWorkModeChange={setWorkMode} />
      <DiscoverResultsSummary
        total={view.total}
        isFiltered={facets.length > 0}
        facets={facets}
        onClearAll={clearAll}
      />
    </View>
  );

  const renderEmpty = () => {
    if (view.isLoadingFirst) return <OpportunityListSkeleton />;
    if (view.firstPageError) {
      return (
        <Card>
          <StatusBanner
            title="Opportunities could not be loaded"
            description={
              view.firstPageError ??
              'The API did not answer, so there is nothing to show yet. Nothing here is invented to fill the gap.'
            }
            onRetry={view.retryFirst}
          />
        </Card>
      );
    }
    return (
      <Card>
        <OpportunityEmptyState
          icon={empty.icon}
          title={empty.title}
          description={empty.description}
          action={empty.action}
        />
      </Card>
    );
  };

  const renderFooter = () => {
    if (view.isFetchingNextPage) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={colors.colorPrimary} />
          <AppText variant="caption" tone="tertiary">
            Loading more…
          </AppText>
        </View>
      );
    }
    if (view.nextPageError) {
      return (
        <View style={styles.footerError}>
          <StatusBanner
            title="Could not load more opportunities"
            description={view.nextPageError ?? 'Please try again.'}
            onRetry={view.retryNext}
          />
        </View>
      );
    }
    if (!view.hasNextPage && view.items.length > 0) {
      return (
        <View style={styles.footer}>
          <AppText variant="caption" tone="tertiary">
            You&apos;ve reached the end
          </AppText>
        </View>
      );
    }
    return null;
  };

  return (
    <View style={styles.screen}>
      {/* The title + search sit outside the list so they stay reachable while
          the feed scrolls; search state is owned here and threaded in. */}
      <DiscoverHeader
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        onSearchSubmit={() => Keyboard.dismiss()}
      />
      <FlatList
        style={styles.flatList}
        data={view.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <OpportunityCard opportunity={item} />}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={renderEmpty()}
        ListFooterComponent={renderFooter()}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={view.isRefreshing}
            onRefresh={view.refresh}
            tintColor={colors.colorPrimary}
            colors={[colors.colorPrimary]}
          />
        }
        onEndReached={() => {
          if (view.hasNextPage && !view.isFetchingNextPage) view.loadMore();
        }}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
