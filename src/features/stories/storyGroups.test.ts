import { describe, expect, it } from 'vitest';

import type { Story, StoryContentType } from '@/types/story';
import {
  groupStoriesByAuthor,
  isPremiumStoryGroup,
  nextStoryPosition,
  normalizeStoryType,
  positionForStoryId,
  previousStoryPosition,
  shouldShowStoryDetails,
  storyAt,
  storyGroupRing,
  storyShowsDetails,
} from './storyGroups';

/**
 * A real-shaped story: every field `GET /stories` now returns, with ids and
 * authors supplied by the caller so fixtures read like the scenarios they
 * prove (A1 A2 B1, not story-1 story-2 story-3).
 */
function makeStory(id: string, author: string, overrides: Partial<Story> = {}): Story {
  return {
    id,
    contentType: 'announcement',
    caption: `Caption for ${id}`,
    status: 'published',
    publisher: { name: `Person ${author}`, logoUrl: null, verified: false, kind: 'platform' },
    opportunity: null,
    viewed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    media: null,
    authorPublicId: author,
    isSelf: false,
    ...overrides,
  };
}

/** Ascending timestamps so ordering assertions are visible in the fixture. */
function at(iso: string): Pick<Story, 'createdAt'> {
  return { createdAt: iso };
}

describe('storyGroups', () => {
  describe('groupStoriesByAuthor — one circle per person', () => {
    it('collapses three stories by the same author into ONE group', () => {
      const groups = groupStoriesByAuthor([
        makeStory('a3', 'MJ-AAA', at('2026-01-01T00:00:03Z')),
        makeStory('a2', 'MJ-AAA', at('2026-01-01T00:00:02Z')),
        makeStory('a1', 'MJ-AAA', at('2026-01-01T00:00:01Z')),
      ]);

      expect(groups).toHaveLength(1);
      expect(groups[0].stories).toHaveLength(3);
      expect(groups[0].authorPublicId).toBe('MJ-AAA');
    });

    it('splits A1 A2 B1 into exactly two groups', () => {
      const groups = groupStoriesByAuthor([
        makeStory('a2', 'MJ-AAA'),
        makeStory('b1', 'MJ-BBB'),
        makeStory('a1', 'MJ-AAA'),
      ]);

      expect(groups).toHaveLength(2);
      expect(groups[0].authorPublicId).toBe('MJ-AAA');
      expect(groups[1].authorPublicId).toBe('MJ-BBB');
      expect(groups[0].stories.map((story) => story.id)).toEqual(['a1', 'a2']);
    });

    it('sorts each person’s stories oldest → newest for playback', () => {
      // The API returns newest first; playback must not.
      const groups = groupStoriesByAuthor([
        makeStory('a-new', 'MJ-AAA', at('2026-01-01T00:00:09Z')),
        makeStory('a-mid', 'MJ-AAA', at('2026-01-01T00:00:05Z')),
        makeStory('a-old', 'MJ-AAA', at('2026-01-01T00:00:01Z')),
      ]);

      expect(groups[0].stories.map((story) => story.id)).toEqual(['a-old', 'a-mid', 'a-new']);
    });

    it('derives group display state from the newest story snapshot', () => {
      const groups = groupStoriesByAuthor([
        makeStory('a1', 'MJ-AAA', {
          viewed: false,
          publisher: { name: 'Old Name', logoUrl: null, verified: false, kind: 'platform' },
        }),
        makeStory('a2', 'MJ-AAA', {
          viewed: true,
          isSelf: true,
          publisher: { name: 'New Name', logoUrl: null, verified: true, kind: 'platform' },
        }),
      ]);

      const group = groups[0];
      expect(group.name).toBe('New Name');
      expect(group.verified).toBe(true);
      // Not all viewed — the ring must stay unread while one story is fresh.
      expect(group.allViewed).toBe(false);
      // isSelf is `every` because one own story does not make every story yours…
      expect(group.isSelf).toBe(false);
    });

    it('marks a fully-viewed, fully-own group', () => {
      const groups = groupStoriesByAuthor([
        makeStory('a1', 'MJ-AAA', { viewed: true, isSelf: true }),
        makeStory('a2', 'MJ-AAA', { viewed: true, isSelf: true }),
      ]);

      expect(groups[0].allViewed).toBe(true);
      expect(groups[0].isSelf).toBe(true);
    });

    it('returns no groups for an empty list', () => {
      expect(groupStoriesByAuthor([])).toEqual([]);
    });
  });

  describe('premium ring (gold) vs standard ring (blue)', () => {
    const ringOf = (types: StoryContentType[]) =>
      storyGroupRing(
        groupStoriesByAuthor(
          types.map((contentType, index) => makeStory(`s${index}`, 'MJ-AAA', { contentType })),
        )[0],
      );

    it('job → premium (gold)', () => {
      expect(ringOf(['job'])).toBe('premium');
      const group = groupStoriesByAuthor([makeStory('s1', 'A', { contentType: 'job' })])[0];
      expect(isPremiumStoryGroup(group)).toBe(true);
    });

    it('internship → premium (gold)', () => {
      expect(ringOf(['internship'])).toBe('premium');
    });

    it('announcement → standard (blue)', () => {
      expect(ringOf(['announcement'])).toBe('standard');
    });

    it('event → standard (blue)', () => {
      expect(ringOf(['event'])).toBe('standard');
    });

    it('mixed announcement + job → premium (the job must not be buried)', () => {
      expect(ringOf(['announcement', 'job', 'event'])).toBe('premium');
    });

    it('mixed announcement + event only → standard', () => {
      expect(ringOf(['announcement', 'event'])).toBe('standard');
    });
  });

  describe('See details visibility', () => {
    it('shows for job, internship and event', () => {
      expect(shouldShowStoryDetails('job')).toBe(true);
      expect(shouldShowStoryDetails('internship')).toBe(true);
      expect(shouldShowStoryDetails('event')).toBe(true);
    });

    it('does NOT show for announcement', () => {
      expect(shouldShowStoryDetails('announcement')).toBe(false);
      expect(storyShowsDetails(makeStory('s1', 'A', { contentType: 'announcement' }))).toBe(
        false,
      );
    });

    it('shows for a story carrying the typed field', () => {
      expect(storyShowsDetails(makeStory('s1', 'A', { contentType: 'job' }))).toBe(true);
    });
  });

  describe('normalizeStoryType — the single comparison point', () => {
    it('accepts the backend’s lowercase vocabulary', () => {
      expect(normalizeStoryType('job')).toBe('job');
      expect(normalizeStoryType('internship')).toBe('internship');
      expect(normalizeStoryType('announcement')).toBe('announcement');
      expect(normalizeStoryType('event')).toBe('event');
    });

    it('is case- and whitespace-insensitive', () => {
      expect(normalizeStoryType('JOB')).toBe('job');
      expect(normalizeStoryType(' Event ')).toBe('event');
      expect(normalizeStoryType('Internship')).toBe('internship');
    });

    it('returns null for anything outside the vocabulary', () => {
      expect(normalizeStoryType('career-info')).toBeNull();
      expect(normalizeStoryType('')).toBeNull();
    });
  });

  describe('automatic advancement — A1 → A2 → B1 → … → close', () => {
    // Person A: two stories, person B: two, person C: one (§50's matrix).
    // Listed A-first so the groups land in A/B/C order (first-appearance).
    const fixture = groupStoriesByAuthor([
      makeStory('a2', 'MJ-AAA', at('2026-01-01T00:00:02Z')),
      makeStory('a1', 'MJ-AAA', at('2026-01-01T00:00:01Z')),
      makeStory('b1', 'MJ-BBB', at('2026-01-01T00:00:11Z')),
      makeStory('b2', 'MJ-BBB', at('2026-01-01T00:00:12Z')),
      makeStory('c1', 'MJ-CCC', at('2026-01-01T00:00:13Z')),
    ]);

    const walkForward = (from: { groupIndex: number; storyIndex: number }) => {
      const seen: string[] = [];
      let position: { groupIndex: number; storyIndex: number } | null = from;
      let steps = 0;
      while (position && steps < 20) {
        const story = storyAt(fixture, position);
        if (!story) break;
        seen.push(story.id);
        position = nextStoryPosition(fixture, position);
        steps += 1;
      }
      return { seen, ended: position === null };
    };

    it('plays A1 → A2 → B1 → B2 → C1 and then reports "close"', () => {
      const { seen, ended } = walkForward({ groupIndex: 0, storyIndex: 0 });

      expect(seen).toEqual(['a1', 'a2', 'b1', 'b2', 'c1']);
      // null is the close signal: the viewer has exactly one source of truth.
      expect(ended).toBe(true);
    });

    it('crosses person boundaries without manual input', () => {
      const afterA2 = nextStoryPosition(fixture, { groupIndex: 0, storyIndex: 1 });
      expect(afterA2).toEqual({ groupIndex: 1, storyIndex: 0 });
      expect(storyAt(fixture, afterA2!)?.id).toBe('b1');
    });

    it('one completion event advances exactly one story (no skipping)', () => {
      // The pure rule moves one step per call; the viewer's `advancingRef`
      // guard is what makes a duplicated completion event call it only once —
      // asserted at the source level in `storyViewerWiring.test.ts`.
      const first = nextStoryPosition(fixture, { groupIndex: 0, storyIndex: 0 });
      expect(first).toEqual({ groupIndex: 0, storyIndex: 1 });
      const second = nextStoryPosition(fixture, first!);
      expect(second).toEqual({ groupIndex: 1, storyIndex: 0 });
    });

    it('returns null at the very last story of the last person', () => {
      expect(nextStoryPosition(fixture, { groupIndex: 2, storyIndex: 0 })).toBeNull();
    });

    it('walks backwards across people: B1 → A2, and never exits at the start', () => {
      expect(previousStoryPosition(fixture, { groupIndex: 1, storyIndex: 0 })).toEqual({
        groupIndex: 0,
        storyIndex: 1,
      });
      expect(previousStoryPosition(fixture, { groupIndex: 0, storyIndex: 1 })).toEqual({
        groupIndex: 0,
        storyIndex: 0,
      });
      // At the very beginning there is no previous — the viewer restarts.
      expect(previousStoryPosition(fixture, { groupIndex: 0, storyIndex: 0 })).toBeNull();
    });
  });

  describe('positionForStoryId — tapping a circle opens its group', () => {
    const fixture = groupStoriesByAuthor([
      makeStory('a1', 'MJ-AAA', { viewed: true, ...at('2026-01-01T00:00:01Z') }),
      makeStory('a2', 'MJ-AAA', { viewed: false, ...at('2026-01-01T00:00:02Z') }),
      makeStory('b1', 'MJ-BBB', { viewed: false }),
    ]);

    it('resolves the tapped id to its group and the first unviewed story', () => {
      // Tapping A's circle (which carries a1) resumes at a2, the first unviewed.
      expect(positionForStoryId(fixture, 'a1')).toEqual({ groupIndex: 0, storyIndex: 1 });
      expect(positionForStoryId(fixture, 'b1')).toEqual({ groupIndex: 1, storyIndex: 0 });
    });

    it('opens at the first story when the whole group is viewed', () => {
      const allViewed = groupStoriesByAuthor([
        makeStory('a1', 'MJ-AAA', { viewed: true }),
        makeStory('a2', 'MJ-AAA', { viewed: true }),
      ]);
      expect(positionForStoryId(allViewed, 'a2')).toEqual({ groupIndex: 0, storyIndex: 0 });
    });

    it('returns null for an id that is not in any group', () => {
      expect(positionForStoryId(fixture, 'missing')).toBeNull();
      expect(positionForStoryId([], 'a1')).toBeNull();
    });
  });

  describe('storyAt', () => {
    it('reads the story a position points at, and null when out of range', () => {
      const fixture = groupStoriesByAuthor([makeStory('a1', 'MJ-AAA')]);

      expect(storyAt(fixture, { groupIndex: 0, storyIndex: 0 })?.id).toBe('a1');
      expect(storyAt(fixture, { groupIndex: 5, storyIndex: 0 })).toBeNull();
      expect(storyAt(fixture, { groupIndex: 0, storyIndex: 9 })).toBeNull();
    });
  });
});
