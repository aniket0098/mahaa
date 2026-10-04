/**
 * `useFeedPosts` — the one place the Community Feed decides what exists.
 *
 * Mirrors `features/stories/useStoryList.ts`: the rendered list is not only a
 * function of the API response, because local session state (likes, saves,
 * hidden posts) must re-render the feed when it changes. `useSyncExternalStore`
 * subscribes to the module store in `localEngagement.ts` and the merge is
 * recomputed against that version.
 *
 * **No request is made here.** The real posts come from the hook's own
 * `/posts` query, and the demo posts come from `demoFeedPosts.ts`, which is
 * gated on `__DEV__`. When demo mode is off and nobody has published anything,
 * the honest empty state stands: nothing is invented to fill the feed.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchPosts } from '@/api/posts';
import { queryKeys } from '@/api/queryKeys';
import { primeMediaAuth } from '@/api/media';
import {
  countByCategory,
  filterFeed,
  mergeFeed,
  type FeedCategory,
  type FeedFilter,
  type FeedPost,
} from './feedModel';
import { createDemoFeedPosts, isDemoFeedEnabled } from './demoFeedPosts';
import {
  getLocalEngagementVersion,
  snapshotLocalEngagement,
  subscribeLocalEngagement,
} from './localEngagement';

/** How many posts the first fetch asks for. The feed paginates later. */
const FEED_PAGE_SIZE = 50;

export interface FeedView {
  /** Merged, hidden posts removed, then the active filter applied. */
  posts: FeedPost[];
  /** How many posts the merged feed holds before the filter — for the empty state. */
  total: number;
  /** Per-category totals, so an empty filter can say how many posts exist elsewhere. */
  categoryCounts: Record<FeedCategory, number>;
  /** Whether development demo posts are in the list, for the section note. */
  demoEnabled: boolean;
  /** Status of the real `/posts` request, which the section reports on. */
  status: 'loading' | 'error' | 'ready';
  /** The server's own message when the feed request failed. */
  errorMessage: string | null;
}

/**
 * `useFeedPosts` — the one place the Community Feed decides what exists.
 *
 * Three sources, in this order, and no more:
 *
 *  1. **Real posts** from `GET /posts` — the community feed, newest first. This is
 *     the only source a published post reaches, so a post appears here only
 *     because the server said so.
 *  2. **Development demo posts**, appended last and only under `__DEV__`.
 *
 * **Profile records are deliberately NOT a source.** This hook used to merge the
 * profile-record mapper in beside the real posts, which put a candidate's
 * projects, certifications, achievements and education into the feed as though
 * they had been published. That is the opposite of the product rule: profile
 * data belongs on Profile, and Home is where somebody *chooses* to publish. A
 * person who added a project to their CV did not ask for a post, and a feed that
 * shows them one is showing them something they never sent. To put a project
 * here they now compose a post deliberately.
 *
 * The mapper itself still lives in `feedModel.ts` because the mapping is real
 * and tested; it is simply no longer a feed source, and
 * `feedIsolation.test.ts` asserts this file does not reach it.
 *
 * Filtering is client-side over that merged list, so switching a chip needs no
 * request and the list can never disagree with the filter bar.
 */
export function useFeedPosts(filter: FeedFilter): FeedView {
  // Subscribing re-renders the section when a like, save, or hide changes. The
  // subscription is the dependency; the values themselves are read from the
  // module store during render rather than from a snapshot, so the list can
  // never be one render behind the state that produced it.
  useSyncExternalStore(
    subscribeLocalEngagement,
    getLocalEngagementVersion,
    getLocalEngagementVersion,
  );

  const postsQuery = useQuery({
    queryKey: queryKeys.posts,
    queryFn: () => fetchPosts({ limit: FEED_PAGE_SIZE }),
  });

  // Fill the in-memory token cache the feed's image components attach to their
  // requests: the API serves media bytes only to the uploader, so an image in a
  // post card cannot be loaded as a plain public URL.
  useEffect(() => {
    void primeMediaAuth();
  }, []);

  const demoEnabled = isDemoFeedEnabled();

  // Demo posts are built fresh so their relative times read as recent, and the
  // list is empty the moment demo mode is off.
  const demoPosts = demoEnabled ? createDemoFeedPosts(new Date().toISOString()) : [];

  const { hidden } = snapshotLocalEngagement();
  // `mergeFeed` keeps the demo gate in one place, and demo content is appended
  // after the real posts so it can never lead the feed.
  const merged = mergeFeed(postsQuery.data ?? [], demoPosts, {
    demoEnabled,
  }).filter((post) => !hidden.has(post.id));

  return {
    posts: filterFeed(merged, filter),
    total: merged.length,
    categoryCounts: countByCategory(merged),
    demoEnabled,
    status: postsQuery.isPending ? 'loading' : postsQuery.isError ? 'error' : 'ready',
    errorMessage: postsQuery.error instanceof Error ? postsQuery.error.message : null,
  };
}
