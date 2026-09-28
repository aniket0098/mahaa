/**
 * Local engagement state tests.
 *
 * The store stands in for a missing engagement API, so the properties that
 * matter are: a toggle is reversible, a blank id changes nothing, the two states
 * are independent, hiding is session-scoped, and the rollback primitive a future
 * API mutation needs actually restores the previous value.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getLocalEngagementVersion,
  hidePost,
  isHidden,
  isLiked,
  isSaved,
  LOCAL_ENGAGEMENT_NOTE,
  resetLocalEngagement,
  revertLike,
  revertSave,
  snapshotLocalEngagement,
  subscribeLocalEngagement,
  toggleLike,
  toggleSave,
} from '@/features/feed/localEngagement';

afterEach(() => {
  resetLocalEngagement();
});

describe('likes', () => {
  it('toggles on and back off', () => {
    expect(toggleLike('p1')).toBe(true);
    expect(isLiked('p1')).toBe(true);
    expect(toggleLike('p1')).toBe(false);
    expect(isLiked('p1')).toBe(false);
  });

  it('keeps state per post', () => {
    toggleLike('p1');
    expect(isLiked('p1')).toBe(true);
    expect(isLiked('p2')).toBe(false);
  });

  it('ignores a blank id', () => {
    expect(toggleLike('')).toBe(false);
    expect(toggleLike('   ')).toBe(false);
    expect(isLiked('')).toBe(false);
  });
});

describe('saves', () => {
  it('toggles independently of a like on the same post', () => {
    toggleLike('p1');
    toggleSave('p1');
    expect(isLiked('p1')).toBe(true);
    expect(isSaved('p1')).toBe(true);

    toggleLike('p1');
    expect(isLiked('p1')).toBe(false);
    expect(isSaved('p1')).toBe(true);
  });

  it('ignores a blank id', () => {
    expect(toggleSave('')).toBe(false);
    expect(isSaved('')).toBe(false);
  });
});

describe('the rollback primitives', () => {
  it('revertLike restores the unliked state', () => {
    toggleLike('p1');
    revertLike('p1');
    expect(isLiked('p1')).toBe(false);
  });

  it('revertSave restores the unsaved state', () => {
    toggleSave('p1');
    revertSave('p1');
    expect(isSaved('p1')).toBe(false);
  });

  it('do nothing when there is nothing to revert, and do not notify', () => {
    const before = getLocalEngagementVersion();
    revertLike('never-liked');
    revertSave('never-saved');
    expect(getLocalEngagementVersion()).toBe(before);
  });
});

describe('hiding', () => {
  it('hides a post and reports it', () => {
    hidePost('p1');
    expect(isHidden('p1')).toBe(true);
    expect(isHidden('p2')).toBe(false);
  });

  it('is idempotent, so a second hide is not a second event', () => {
    hidePost('p1');
    const before = getLocalEngagementVersion();
    hidePost('p1');
    expect(getLocalEngagementVersion()).toBe(before);
  });

  it('ignores a blank id', () => {
    hidePost('');
    expect(isHidden('')).toBe(false);
  });
});

describe('the subscription', () => {
  it('notifies a subscriber on a real change and not on a no-op', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocalEngagement(listener);

    toggleLike('p1');
    expect(listener).toHaveBeenCalledTimes(1);

    toggleLike('p1');
    expect(listener).toHaveBeenCalledTimes(2);

    hidePost('p1');
    expect(listener).toHaveBeenCalledTimes(3);

    // Hiding an already-hidden post is not a change.
    hidePost('p1');
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    toggleLike('p2');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('bumps a monotonic version so a snapshot reader can detect a change', () => {
    const before = getLocalEngagementVersion();
    toggleLike('p1');
    expect(getLocalEngagementVersion()).toBeGreaterThan(before);
  });
});

describe('the snapshot and the label', () => {
  it('reports all three sets at once', () => {
    toggleLike('p1');
    toggleSave('p2');
    hidePost('p3');
    const snapshot = snapshotLocalEngagement();
    expect(snapshot.liked.has('p1')).toBe(true);
    expect(snapshot.saved.has('p2')).toBe(true);
    expect(snapshot.hidden.has('p3')).toBe(true);
  });

  it('states that the state is device-local, so it is never read as server data', () => {
    expect(LOCAL_ENGAGEMENT_NOTE).toMatch(/this device/i);
  });
});
