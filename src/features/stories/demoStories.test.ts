/**
 * Rules for the development-only demo stories.
 *
 * These are the guarantees the rest of the app relies on, asserted here rather
 * than by a screen test: demo content is namespaced so it can never be sent to
 * the stories API, it is only reachable in development, and it is appended
 * after real stories without ever replacing them.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { Story } from '@/types/story';
import {
  createDemoStories,
  DEMO_STORY_BADGE,
  DEMO_STORY_ID_PREFIX,
  isDemoStoriesEnabled,
  isDemoStory,
  isDemoStoryId,
  markDemoStoryViewed,
  mergeWithDemoStories,
  resetDemoStoryViewedState,
  shouldShowDemoStories,
} from './demoStories';

const NOW = '2026-01-01T00:00:00.000Z';

function makeRealStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'a3f1c0de-0000-4000-8000-000000000001',
    contentType: 'job',
    caption: 'Backend internship open',
    status: 'published',
    publisher: { name: 'Acme Corp', logoUrl: null, verified: true, kind: 'company' },
    opportunity: { id: 'opp-1', title: 'Backend Intern', location: 'Pune', workMode: 'hybrid' },
    viewed: false,
    createdAt: NOW,
    media: null,
    authorPublicId: 'MJ-TESTAUTH',
    isSelf: false,
    ...overrides,
  };
}

afterEach(() => {
  resetDemoStoryViewedState();
});

describe('demoStories', () => {
  describe('isDemoStoryId / isDemoStory', () => {
    it('recognises the namespaced demo ids', () => {
      expect(isDemoStoryId(`${DEMO_STORY_ID_PREFIX}welcome`)).toBe(true);
      expect(isDemoStoryId('a3f1c0de-0000-4000-8000-000000000001')).toBe(false);
      expect(isDemoStoryId(undefined)).toBe(false);
      expect(isDemoStoryId(null)).toBe(false);
    });

    it('flags a demo story by id or by its explicit marker', () => {
      expect(isDemoStory(createDemoStories(NOW)[0] as Story)).toBe(true);
      expect(isDemoStory(makeRealStory())).toBe(false);
    });
  });

  describe('createDemoStories', () => {
    it('creates exactly the two approved demo stories', () => {
      const demo = createDemoStories(NOW);
      expect(demo).toHaveLength(2);
      expect(demo.map((story) => story.title)).toEqual([
        'Welcome to MahaJob',
        'Build Your Career',
      ]);
      expect(demo.map((story) => story.publisher.name)).toEqual([
        'MahaJob Demo',
        'Career Tips Demo',
      ]);
    });

    it('never claims a verification badge or an opportunity', () => {
      for (const story of createDemoStories(NOW)) {
        expect(story.publisher.verified).toBe(false);
        expect(story.opportunity).toBeNull();
        expect(story.publisher.logoUrl).toBeNull();
      }
    });

    it('marks every story as demo and namespaces its id', () => {
      for (const story of createDemoStories(NOW)) {
        expect(story.demo).toBe(true);
        expect(story.id.startsWith(DEMO_STORY_ID_PREFIX)).toBe(true);
      }
    });

    it('labels both stories for a reader, not only for a screen reader', () => {
      expect(DEMO_STORY_BADGE).toBe('DEMO');
      expect(createDemoStories(NOW).every((story) => story.typeLabel.length > 0)).toBe(true);
    });

  describe('shouldShowDemoStories', () => {
    it('is enabled in development unless explicitly switched off', () => {
      expect(shouldShowDemoStories({ isDev: true })).toBe(true);
      expect(shouldShowDemoStories({ isDev: true, flag: 'on' })).toBe(true);
      expect(shouldShowDemoStories({ isDev: true, flag: 'off' })).toBe(false);
      expect(shouldShowDemoStories({ isDev: true, flag: '0' })).toBe(false);
      expect(shouldShowDemoStories({ isDev: true, flag: 'FALSE' })).toBe(false);
    });

    it('is disabled in production whatever the environment says', () => {
      expect(shouldShowDemoStories({ isDev: false })).toBe(false);
      expect(shouldShowDemoStories({ isDev: false, flag: 'on' })).toBe(false);
    });

    it('reads the runtime flag without assuming __DEV__ exists in Node', () => {
      expect(typeof isDemoStoriesEnabled()).toBe('boolean');
    });
  });

  describe('mergeWithDemoStories', () => {
    it('returns the real stories untouched when demo mode is off', () => {
      const real = [makeRealStory()];
      const merged = mergeWithDemoStories(real, { enabled: false });
      expect(merged).toEqual(real);
      expect(merged).toHaveLength(1);
    });

    it('appends the demo stories after the real ones', () => {
      const merged = mergeWithDemoStories([makeRealStory()], { enabled: true });
      expect(merged).toHaveLength(3);
      expect(merged[0]?.publisher.name).toBe('Acme Corp');
      expect(merged.slice(1).every((story) => isDemoStory(story))).toBe(true);
    });

    it('returns only demo stories when the API has none', () => {
      const merged = mergeWithDemoStories([], { enabled: true });
      expect(merged).toHaveLength(2);
      expect(merged.every((story) => isDemoStory(story))).toBe(true);
    });

    it('keeps the empty list empty when demo mode is off and there is no story', () => {
      expect(mergeWithDemoStories([], { enabled: false })).toEqual([]);
    });

    it('applies the local viewed state to the demo rings', () => {
      const first = createDemoStories(NOW)[0];
      expect(first).toBeDefined();
      markDemoStoryViewed(first!.id);

      const merged = mergeWithDemoStories([], { enabled: true });
      const viewed = merged.filter((story) => story.viewed);
      expect(viewed).toHaveLength(1);
      expect(viewed[0]?.id).toBe(first!.id);
    });

    it('never lets a demo id mark a real story viewed', () => {
      const real = makeRealStory();
      markDemoStoryViewed(real.id);
      const merged = mergeWithDemoStories([real], { enabled: true });
      expect(merged[0]?.id).toBe(real.id);
      expect(merged[0]?.viewed).toBe(false);
    });

    it('leaves a real story real', () => {
      const merged = mergeWithDemoStories([makeRealStory()], { enabled: true });
      expect(merged[0]?.demo).toBeUndefined();
      expect(merged[0]?.publisher.verified).toBe(true);
    });
  });

  describe('markDemoStoryViewed', () => {
    it('ignores a real story id so it can never touch server state', () => {
      const before = mergeWithDemoStories([makeRealStory()], { enabled: true });
      markDemoStoryViewed('a3f1c0de-0000-4000-8000-000000000001');
      const after = mergeWithDemoStories([makeRealStory()], { enabled: true });
      expect(after[0]?.viewed).toBe(before[0]?.viewed);
    });
  });
});

  });
