/**
 * DEMO stories — development-only sample content for the stories row.
 *
 * Everything in this module is **local presentation content**, never data:
 *
 *  - it is never sent to the API and is never written to the database, so
 *    there is no demo story in any environment's `GET /stories` response;
 *  - it carries no `opportunity`, so the viewer renders no "View Job" CTA;
 *  - it is never `verified` and belongs to no real company account, so no
 *    verification badge can appear next to it;
 *  - its viewed state is a module-level set for the current dev session, so
 *    `POST /stories/{id}/view` is never called for a demo id.
 *
 * It is on by default in development and impossible in production: the flag is
 * gated on `__DEV__` and can be switched off with
 * `EXPO_PUBLIC_DEMO_STORIES=off` (see `shouldShowDemoStories`).
 *
 * Demo ids are namespaced with {@link DEMO_STORY_ID_PREFIX} so a demo id can be
 * recognised *before* any request is made — the viewer and the story route both
 * branch on {@link isDemoStoryId} and never hand one to the transport layer.
 *
 * This module imports no React and no React Native, so its rules are testable
 * in plain Node (`demoStories.test.ts`).
 */

import type { DemoStoryMeta, Story, StoryItem } from '@/types/story';

/** Namespace that makes a demo id impossible to confuse with a backend uuid. */
export const DEMO_STORY_ID_PREFIX = 'demo-';

/** Text rendered on the bubble and inside the viewer, so demo is never implicit. */
export const DEMO_STORY_BADGE = 'DEMO';

export type DemoStory = Story & DemoStoryMeta;

/** True when `id` belongs to the local demo set rather than the stories API. */
export function isDemoStoryId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(DEMO_STORY_ID_PREFIX);
}

/**
 * True for a demo story, whichever signal says so: the explicit `demo` flag
 * (set on merged rows) or the id namespace (set on raw demo entries). Both are
 * checked so a demo story can never be mistaken for real content by a screen
 * that only has one of the two.
 */
export function isDemoStory(
  story: { readonly id: string } & Partial<DemoStoryMeta>,
): story is DemoStory {
  return story.demo === true || isDemoStoryId(story.id);
}

/**
 * Whether demo stories may be rendered.
 *
 * Production is a hard `false` regardless of the environment variable, because
 * `__DEV__` is a compile-time constant: a release bundle can never ship them.
 * In development the flag is on unless it is explicitly switched off, so
 * `EXPO_PUBLIC_DEMO_STORIES` accepts `off`, `0`, or `false` as the kill switch.
 */
export function shouldShowDemoStories(options: {
  readonly isDev: boolean;
  readonly flag?: string | null;
}): boolean {
  if (!options.isDev) return false;
  const flag = options.flag?.trim().toLowerCase();
  return flag !== 'off' && flag !== '0' && flag !== 'false';
}

/** The runtime answer, used by the screens; the rules above stay pure for tests. */
export function isDemoStoriesEnabled(): boolean {
  return shouldShowDemoStories({
    // `typeof` keeps this safe in Node, where `__DEV__` is not a global.
    isDev: typeof __DEV__ !== 'undefined' && __DEV__ === true,
    flag: process.env.EXPO_PUBLIC_DEMO_STORIES,
  });
}

/**
 * The two demo stories, built fresh so `created_at` reads as "just now" in the
 * viewer rather than as the day this file was written.
 */
export function createDemoStories(nowIso: string): DemoStory[] {
  return [
    {
      id: `${DEMO_STORY_ID_PREFIX}welcome`,
      contentType: 'announcement',
      caption: 'Explore career opportunities, internships, and useful career updates.',
      status: 'published',
      publisher: { name: 'MahaJob Demo', logoUrl: null, verified: false, kind: 'platform' },
      // No real opportunity, so the viewer shows no "View Job" CTA.
      opportunity: null,
      viewed: false,
      createdAt: nowIso,
      demo: true,
      title: 'Welcome to MahaJob',
      typeLabel: 'Announcement',
    },
    {
      id: `${DEMO_STORY_ID_PREFIX}career-tips`,
      contentType: 'announcement',
      caption: 'Keep your resume updated and explore opportunities that match your skills.',
      status: 'published',
      publisher: { name: 'Career Tips Demo', logoUrl: null, verified: false, kind: 'platform' },
      opportunity: null,
      viewed: false,
      createdAt: nowIso,
      demo: true,
      title: 'Build Your Career',
      // "Career information" is not a member of the API's content-type enum, so
      // the badge is a display-only string rather than a widened type.
      typeLabel: 'Career info',
    },
  ];
}

/**
 * Demo viewed-state, kept per development session.
 *
 * A real ring state comes from the server (`story.viewed`); a demo story has no
 * server row, so its ring is driven from here. Nothing in this set is ever
 * transmitted.
 */
const viewedDemoStoryIds = new Set<string>();
const demoViewedListeners = new Set<() => void>();
let demoViewedVersion = 0;

export function getDemoViewedStoryIds(): ReadonlySet<string> {
  return viewedDemoStoryIds;
}

export function isDemoStoryViewed(storyId: string): boolean {
  return viewedDemoStoryIds.has(storyId);
}

/** Mark a demo story as read. Ignores non-demo ids, so it cannot shadow a real one. */
export function markDemoStoryViewed(storyId: string): void {
  if (!isDemoStoryId(storyId) || viewedDemoStoryIds.has(storyId)) return;
  viewedDemoStoryIds.add(storyId);
  demoViewedVersion += 1;
  for (const listener of demoViewedListeners) listener();
}

/** Subscribe to demo view changes; returns the unsubscribe function. */
export function subscribeDemoStoryViewed(listener: () => void): () => void {
  demoViewedListeners.add(listener);
  return () => {
    demoViewedListeners.delete(listener);
  };
}

/** Monotonic counter, so `useSyncExternalStore` re-renders on a real change. */
export function getDemoViewedVersion(): number {
  return demoViewedVersion;
}

/** Test-only: return the session state to the point it started from. */
export function resetDemoStoryViewedState(): void {
  viewedDemoStoryIds.clear();
  demoViewedVersion += 1;
  for (const listener of demoViewedListeners) listener();
}

/**
 * The single list the stories UI renders: real stories first, demo stories
 * after, and demo stories only when they are enabled.
 *
 * This is a pure function of its arguments and touches no API module, which is
 * what keeps demo content out of every request.
 */
export function mergeWithDemoStories(
  realStories: readonly Story[],
  options: { readonly enabled: boolean; readonly viewedIds?: ReadonlySet<string> },
): StoryItem[] {
  if (!options.enabled) return [...realStories];

  const viewedIds = options.viewedIds ?? viewedDemoStoryIds;
  const demoStories = createDemoStories(new Date().toISOString()).map((story) => ({
    ...story,
    viewed: viewedIds.has(story.id),
  }));

  return [...realStories, ...demoStories];
}

