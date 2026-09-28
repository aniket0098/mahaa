import { describe, expect, it } from 'vitest';

import {
  formatStoryRelativeTime,
  getStoryRingState,
  getStoryTypeBadgeLabel,
  nextStoryIndex,
  prevStoryIndex,
} from './storyModel';
import type { Story } from '@/types/story';

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    contentType: 'job',
    caption: 'Sample job announcement',
    status: 'published',
    publisher: {
      name: 'Acme Corp',
      logoUrl: null,
      verified: true,
      kind: 'company',
    },
    opportunity: null,
    viewed: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('storyModel', () => {
  describe('getStoryRingState', () => {
    it('returns unread for a story not yet viewed', () => {
      const story = makeStory({ viewed: false });
      expect(getStoryRingState(story)).toBe('unread');
    });

    it('returns viewed for a story already viewed', () => {
      const story = makeStory({ viewed: true });
      expect(getStoryRingState(story)).toBe('viewed');
    });
  });

  describe('nextStoryIndex / prevStoryIndex', () => {
    it('advances index within bounds', () => {
      expect(nextStoryIndex(0, 3)).toBe(1);
      expect(nextStoryIndex(1, 3)).toBe(2);
    });

    it('clamps to -1 (signalling complete) when on the last story', () => {
      expect(nextStoryIndex(2, 3)).toBe(-1);
    });

    it('goes back within bounds', () => {
      expect(prevStoryIndex(2)).toBe(1);
      expect(prevStoryIndex(1)).toBe(0);
    });

    it('clamps to 0 when on the first story', () => {
      expect(prevStoryIndex(0)).toBe(0);
    });
  });

  describe('getStoryTypeBadgeLabel', () => {
    it('returns clean human labels for every story content type', () => {
      expect(getStoryTypeBadgeLabel('job')).toBe('Job');
      expect(getStoryTypeBadgeLabel('internship')).toBe('Internship');
      expect(getStoryTypeBadgeLabel('announcement')).toBe('Announcement');
      expect(getStoryTypeBadgeLabel('event')).toBe('Event');
    });
  });

  describe('formatStoryRelativeTime', () => {
    it('formats recent times cleanly', () => {
      const now = Date.now();
      expect(formatStoryRelativeTime(new Date(now - 30 * 1000).toISOString())).toBe('just now');
      expect(formatStoryRelativeTime(new Date(now - 15 * 60 * 1000).toISOString())).toBe('15m');
      expect(formatStoryRelativeTime(new Date(now - 3 * 3600 * 1000).toISOString())).toBe('3h');
      expect(formatStoryRelativeTime(new Date(now - 2 * 86400 * 1000).toISOString())).toBe('2d');
    });
  });
});
