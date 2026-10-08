/**
 * Story grouping and advancement — the pure rules behind the stories row and
 * the viewer's automatic playback.
 *
 * No React, no React Native, no API import: everything here is plain data and
 * pure functions, which is what lets `storyGroups.test.ts` prove the exact
 * behaviours the product requires (one circle per person, gold ring for
 * job/internship groups, "See details" only where it applies, A1 → A2 → B1
 * advancement) without a renderer or a device.
 *
 * **Grouping keys on `authorPublicId` and nothing else.** Never story id, type,
 * caption, media id or array index — those all fragment one person's stories
 * into several circles. The public id (`MJ-…`) is the same identifier
 * `GET /users/{public_id}` resolves, so the key is stable across requests and
 * safe to expose.
 *
 * **Playback order inside a group is oldest → newest.** `GET /stories` returns
 * newest first, so each group reverses its slice: a person's story 1 plays
 * before their story 3, which is the order they were published in.
 */

import type { StoryContentType, StoryItem } from '@/types/story';

/** One person's stories, ready to render as a single circle and play in order. */
export interface StoryGroup {
  /** The grouping key: the author's public id (demo ids are namespaced). */
  readonly authorPublicId: string;
  /** Display name for the circle and the viewer header (newest snapshot). */
  readonly name: string;
  readonly logoUrl: string | null;
  readonly verified: boolean;
  /** Playback order: oldest → newest. */
  readonly stories: readonly StoryItem[];
  /** True when every story in the group is viewed — mutes the ring. */
  readonly allViewed: boolean;
  /** True when every story in the group belongs to the current user. */
  readonly isSelf: boolean;
}

/**
 * Where the viewer is: a group index into {@link groupStoriesByAuthor}'s output
 * and a story index inside that group. The viewer's single source of truth.
 */
export interface StoryPosition {
  readonly groupIndex: number;
  readonly storyIndex: number;
}

/** The backend's `StoryContentType` values, lowercased once. */
const KNOWN_STORY_TYPES: ReadonlySet<string> = new Set([
  'job',
  'internship',
  'announcement',
  'event',
]);

/**
 * Normalize a story type for comparison — the one place a story type string is
 * compared. The backend's enum is lowercase today (`job | internship |
 * announcement | event`), but callers hand us values from JSON and demo
 * content, so everything is trimmed and lowercased here rather than sprinkled
 * across the UI. Unknown values return null and are treated as non-premium
 * and detail-less by the helpers below.
 */
export function normalizeStoryType(raw: string): StoryContentType | null {
  const value = raw.trim().toLowerCase();
  return KNOWN_STORY_TYPES.has(value) ? (value as StoryContentType) : null;
}

/** The story's normalized type, reading the typed field it already has. */
export function storyTypeOf(story: StoryItem): StoryContentType | null {
  return normalizeStoryType(story.contentType);
}

/**
 * Premium groups: any story of type `job` or `internship` promotes the whole
 * circle to the golden ring. Deliberately `some(...)` — a person mixing a job
 * with announcements still advertises the job, and a plain blue ring would
 * bury the most important story in the group.
 */
export function isPremiumStoryGroup(group: StoryGroup): boolean {
  return group.stories.some((story) => {
    const type = storyTypeOf(story);
    return type === 'job' || type === 'internship';
  });
}

/** `'premium'` → golden ring; `'standard'` → MahaJob blue. */
export function storyGroupRing(group: StoryGroup): 'premium' | 'standard' {
  return isPremiumStoryGroup(group) ? 'premium' : 'standard';
}

/**
 * Whether the viewer shows the small "See details" control for this type.
 *
 * Job, internship and event point at something to look at; an announcement
 * stands alone (the create-screen hint says exactly that), so it gets no
 * control rather than one that leads nowhere.
 */
export function shouldShowStoryDetails(type: StoryContentType): boolean {
  return type === 'job' || type === 'internship' || type === 'event';
}

/** Convenience for a whole story: unknown types show no control. */
export function storyShowsDetails(story: StoryItem): boolean {
  const type = storyTypeOf(story);
  return type !== null && shouldShowStoryDetails(type);
}

/**
 * Group stories by author, one {@link StoryGroup} per person, in
 * first-appearance order (the API's newest-first order, so the freshest
 * publisher leads).
 *
 * Stories inside each group are sorted oldest → newest for playback. Sorting is
 * by `createdAt` with the id as a tiebreak because publishers create stories
 * in bursts and two can share a `created_at` — without a total order the pair
 * could swap between renders.
 */
export function groupStoriesByAuthor(stories: readonly StoryItem[]): StoryGroup[] {
  const byAuthor = new Map<string, StoryItem[]>();
  for (const story of stories) {
    const key = story.authorPublicId;
    const bucket = byAuthor.get(key);
    if (bucket) {
      bucket.push(story);
    } else {
      byAuthor.set(key, [story]);
    }
  }

  const groups: StoryGroup[] = [];
  for (const [authorPublicId, bucket] of byAuthor) {
    const ordered = [...bucket].sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
    // The newest story carries the publisher snapshot to render: a rename
    // between two stories should show the current name, not the older one.
    const latest = ordered[ordered.length - 1];
    groups.push({
      authorPublicId,
      name: latest.publisher.name,
      logoUrl: latest.publisher.logoUrl,
      verified: latest.publisher.verified,
      stories: ordered,
      allViewed: ordered.every((story) => story.viewed),
      isSelf: ordered.every((story) => story.isSelf),
    });
  }
  return groups;
}

/**
 * Where tapping a story circle should open: its group, and the first unviewed
 * story in that group (or the first story when everything is viewed) — so a
 * partially-watched person resumes where they stopped. Null when the id is
 * not in the list.
 */
export function positionForStoryId(
  groups: readonly StoryGroup[],
  storyId: string,
): StoryPosition | null {
  for (let g = 0; g < groups.length; g += 1) {
    const stories = groups[g].stories;
    const index = stories.findIndex((story) => story.id === storyId);
    if (index === -1) continue;
    const unviewedIndex = stories.findIndex((story) => !story.viewed);
    const resume = unviewedIndex === -1 ? 0 : unviewedIndex;
    return { groupIndex: g, storyIndex: Math.min(resume, stories.length - 1) };
  }
  return null;
}

/**
 * The one advancement rule: next story in this group → next group's first
 * story → null, meaning "no more, close the viewer".
 *
 * Returned as data rather than executed, so the guard against double
 * advancement and the actual state update live in exactly one place (the
 * viewer), and this logic is unit-testable as A1 → A2 → B1 → B2 → C1 → close.
 */
export function nextStoryPosition(
  groups: readonly StoryGroup[],
  position: StoryPosition,
): StoryPosition | null {
  const group = groups[position.groupIndex];
  if (!group) return null;
  if (position.storyIndex + 1 < group.stories.length) {
    return { groupIndex: position.groupIndex, storyIndex: position.storyIndex + 1 };
  }
  const nextGroup = position.groupIndex + 1;
  if (nextGroup < groups.length && groups[nextGroup].stories.length > 0) {
    return { groupIndex: nextGroup, storyIndex: 0 };
  }
  return null;
}

/**
 * The mirror of {@link nextStoryPosition}: previous story in this group, else
 * the previous group's *last* story. Null only at the very beginning, which
 * the viewer reads as "restart the first story" — going back must never exit.
 */
export function previousStoryPosition(
  groups: readonly StoryGroup[],
  position: StoryPosition,
): StoryPosition | null {
  if (position.storyIndex > 0) {
    return { groupIndex: position.groupIndex, storyIndex: position.storyIndex - 1 };
  }
  const prevGroup = position.groupIndex - 1;
  if (prevGroup >= 0 && groups[prevGroup].stories.length > 0) {
    return {
      groupIndex: prevGroup,
      storyIndex: groups[prevGroup].stories.length - 1,
    };
  }
  return null;
}

/** The story a position points at, or null when the position is out of range. */
export function storyAt(
  groups: readonly StoryGroup[],
  position: StoryPosition,
): StoryItem | null {
  return groups[position.groupIndex]?.stories[position.storyIndex] ?? null;
}

/** How long a non-video story stays on screen (videos use their real duration). */
export const STORY_FALLBACK_DURATION_MS = 5000;

