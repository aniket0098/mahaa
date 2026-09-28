/**
 * `useStoryList` — the one place the stories row, the viewer, and the story
 * route agree on which stories exist.
 *
 * It exists because the story list is not only a function of the API response:
 * a demo story's ring depends on a local session flag, and the app must re-render
 * when that flag changes. `useSyncExternalStore` subscribes to the module-level
 * store in `demoStories.ts` and returns real stories followed by demo stories
 * (only when demo mode is enabled). When demo mode is off the result is the API
 * response untouched, which is what keeps the honest empty state intact.
 */

import { useSyncExternalStore } from 'react';

import type { Story, StoryItem } from '@/types/story';
import {
  getDemoViewedVersion,
  isDemoStoriesEnabled,
  mergeWithDemoStories,
  subscribeDemoStoryViewed,
} from './demoStories';

/** Stable identity, so an absent response stays absent rather than churning. */
const NO_STORIES: readonly Story[] = [];

export function useStoryList(stories: readonly Story[] | undefined): StoryItem[] {
  // Subscribing re-renders the screen when a demo story is marked viewed, so
  // the list below is rebuilt with the new ring state while the home screen
  // sits underneath the viewer. The merge is a map over a handful of rows, so
  // it runs per render instead of being memoised: a memo would have to carry
  // the subscription version as a dependency to stay correct, and that
  // indirection buys nothing at this size.
  useSyncExternalStore(subscribeDemoStoryViewed, getDemoViewedVersion, getDemoViewedVersion);

  return mergeWithDemoStories(stories ?? NO_STORIES, { enabled: isDemoStoriesEnabled() });
}
