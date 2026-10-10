/**
 * `useOpportunityList` — the Discover feed's server state.
 *
 * The list is the API's `FastApiPage` paged feed (`GET /opportunities`), read
 * through the central `fetchOpportunities` so there is one transport and one
 * auth path. It is an **infinite query**: each page is its own cache entry
 * keyed by the filter record, and the next page is requested only when the
 * reader reaches the end. Nothing about what exists is decided here — a page
 * the server did not return is not shown, and a filter the API does not accept
 * is never sent.
 *
 * **The filter record is the whole query key.** `queryKeys.opportunities`
 * hashes it, so changing category, work mode or search produces a new key, a
 * fresh request from page 1, and — crucially — no stale results from the
 * previous filter carried over into the new one.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { fetchOpportunities } from '@/api/opportunities';
import { queryKeys } from '@/api/queryKeys';
import { ApiError } from '@/api/errors';
import type { Opportunity } from '@/types/opportunity';

import { nextPageParam, recordToFetchParams } from './discoverFilters';

/** Rows per page. The server default is 20 and its ceiling is 100. */
export const OPPORTUNITY_PAGE_SIZE = 20;

export interface OpportunityListView {
  /** Every fetched row, de-duplicated by id across pages. */
  items: Opportunity[];
  /** The server's total for the current filter, for the section header. */
  total: number;
  /** True only before the first page has arrived. */
  isLoadingFirst: boolean;
  /** A pull-to-refresh is in flight (not a first load). */
  isRefreshing: boolean;
  /** The first page failed and there is nothing to show. */
  firstPageError: string | null;
  /** A later page failed while rows are already on screen. */
  nextPageError: string | null;
  /** The current query error's message, whichever page it came from. */
  errorMessage: string | null;
  retryFirst: () => void;
  retryNext: () => void;
  refresh: () => void;
  loadMore: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return null;
}

export function useOpportunityList(filter: Record<string, unknown>): OpportunityListView {
  const query = useInfiniteQuery({
    queryKey: queryKeys.opportunities(filter),
    queryFn: ({ pageParam }) => {
      const { type, workMode, query: q } = recordToFetchParams(filter);
      return fetchOpportunities({
        type,
        workMode,
        query: q,
        page: pageParam,
        pageSize: OPPORTUNITY_PAGE_SIZE,
      });
    },
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });

  const pages = query.data?.pages;

  // Flatten and de-duplicate by id. Paging keys off the filter record, so a
  // duplicate would only appear if the server returned the same row on two
  // pages — de-duping makes that impossible to render twice regardless.
  const items = useMemo(() => {
    if (!pages) return [] as Opportunity[];
    const seen = new Set<string>();
    const flattened: Opportunity[] = [];
    for (const page of pages) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        flattened.push(item);
      }
    }
    return flattened;
  }, [pages]);

  const hasData = Boolean(pages);
  const total = pages?.[pages.length - 1]?.total ?? 0;

  return {
    items,
    total,
    isLoadingFirst: query.isPending,
    isRefreshing: query.isRefetching && !query.isFetchingNextPage,
    // A first-page failure is a full-screen error; a later-page failure keeps
    // the rows already fetched and surfaces a retryable footer instead.
    firstPageError: query.isError && !hasData ? errorMessage(query.error) : null,
    nextPageError: query.isError && hasData ? errorMessage(query.error) : null,
    errorMessage: errorMessage(query.error),
    retryFirst: () => void query.refetch(),
    retryNext: () => void query.fetchNextPage(),
    refresh: () => void query.refetch(),
    loadMore: () => void query.fetchNextPage(),
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
  };
}
