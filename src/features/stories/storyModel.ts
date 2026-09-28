/**
 * Pure helper model for Stories: ring state, index navigation, labels, relative timing.
 */

import type { Story, StoryContentType } from '@/types/story';

export type StoryRingState = 'unread' | 'viewed';

export const STORY_AUTO_ADVANCE_DURATION_MS = 5000;

export function getStoryRingState(story: Story): StoryRingState {
  return story.viewed ? 'viewed' : 'unread';
}

export function nextStoryIndex(currentIndex: number, totalStories: number): number {
  if (currentIndex + 1 >= totalStories) {
    return -1;
  }
  return currentIndex + 1;
}

export function prevStoryIndex(currentIndex: number): number {
  if (currentIndex <= 0) {
    return 0;
  }
  return currentIndex - 1;
}

export function getStoryTypeBadgeLabel(type: StoryContentType): string {
  switch (type) {
    case 'job':
      return 'Job';
    case 'internship':
      return 'Internship';
    case 'announcement':
      return 'Announcement';
    case 'event':
      return 'Event';
    default:
      return 'Update';
  }
}

export function formatStoryRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs < 60 * 1000) {
    return 'just now';
  }
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}
