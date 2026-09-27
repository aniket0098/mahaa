/**
 * Feed model tests.
 *
 * The feed is the one place on the dashboard where it is easy to leak invented
 * data, so these tests pin the rules that keep it honest: the stream comes from
 * the candidate's own records, it is sorted by the records' real timestamps, it
 * carries no engagement counts, and the relative-time formatter never invents a
 * recency.
 */

import { describe, expect, it } from 'vitest';

import {
  buildFeedItems,
  buildFeedPosts,
  feedFilters,
  filterFeedPosts,
  formatFeedTime,
  type FeedPost,
} from '@/features/home/dashboardModel';
import type { ProfileAggregate } from '@/types/profile';

function makeProfile(overrides: Partial<ProfileAggregate> = {}): ProfileAggregate {
  return {
    identity: {
      user_id: 'u1',
      public_id: 'pub1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: null,
      avatar_url: null,
      headline: 'Software Engineering Intern',
      summary: null,
      location: 'Pune',
      interests: [],
      profile_updated_at: '2026-01-01T00:00:00Z',
    },
    privacy: {
      profile_visibility: 'employers',
      discoverable: true,
      allow_messages: true,
      show_email: false,
      show_phone: false,
      updated_at: '2026-01-01T00:00:00Z',
    },
    completeness: { percent: 40, sections: [] },
    education: [],
    experience: [],
    projects: [],
    certifications: [],
    achievements: [],
    links: [],
    skills: [],
    preferences: null,
    ...overrides,
  };
}

const project = {
  id: 'p1',
  title: 'Campus navigation app',
  description: 'Two sentences about the problem it solves.',
  role: 'Full-stack developer',
  start_date: null,
  end_date: null,
  source_url: 'https://github.com/example/repo',
  live_url: 'https://example.com',
  skills: [{ skill_id: 's1', name: 'React' }],
  created_at: '2026-03-01T10:00:00Z',
  updated_at: '2026-03-01T10:00:00Z',
};

describe('buildFeedItems', () => {
  it('returns nothing when the candidate has no records', () => {
    expect(buildFeedItems(makeProfile())).toEqual([]);
  });

  it('flattens only real profile records', () => {
    const items = buildFeedItems(makeProfile({ projects: [project] }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'project-p1',
      kind: 'project',
      title: 'Campus navigation app',
      context: 'Full-stack developer',
      tags: ['React'],
    });
  });

  it('only includes links the record really carries', () => {
    const withoutUrls = buildFeedItems(
      makeProfile({ projects: [{ ...project, source_url: null, live_url: null }] }),
    );
    expect(withoutUrls[0].links).toEqual([]);

    const withUrls = buildFeedItems(makeProfile({ projects: [project] }));
    expect(withUrls[0].links).toEqual([
      { label: 'Source code', url: 'https://github.com/example/repo' },
      { label: 'Live demo', url: 'https://example.com' },
    ]);
  });

  it('orders records newest first using their real timestamps', () => {
    const older = { ...project, id: 'p0', created_at: '2026-01-01T00:00:00Z' };
    const items = buildFeedItems(makeProfile({ projects: [older, project] }));
    expect(items.map((item) => item.id)).toEqual(['project-p1', 'project-p0']);
  });
});

describe('buildFeedPosts', () => {
  it('authors every post as the authenticated candidate', () => {
    const posts = buildFeedPosts(makeProfile({ projects: [project] }));
    expect(posts[0].author).toEqual({
      name: 'Ada Lovelace',
      headline: 'Software Engineering Intern',
      avatarUrl: null,
      profileHref: '/profile',
    });
  });

  it('carries no engagement counts, because no engagement API exists', () => {
    const post = buildFeedPosts(makeProfile({ projects: [project] }))[0] as FeedPost &
      Record<string, unknown>;
    for (const key of ['likes', 'comments', 'shares', 'bookmarks', 'engagement']) {
      expect(post[key], `post must not carry ${key}`).toBeUndefined();
    }
  });

  it('maps each record kind to the real filter category', () => {
    const posts = buildFeedPosts(makeProfile({ projects: [project] }));
    expect(posts[0].category).toBe('projects');
  });
});

const educationRecord = {
  id: 'e1',
  institution: 'MIT',
  degree: 'B.Tech',
  field_of_study: null,
  level: null,
  start_date: null,
  end_date: null,
  current: true,
  grade: null,
  description: null,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
};

describe('filterFeedPosts', () => {
  const posts = buildFeedPosts(
    makeProfile({ projects: [project], education: [educationRecord] }),
  );

  it('exposes exactly the four real record-type filters', () => {
    expect(feedFilters.map((filter) => filter.value)).toEqual([
      'all',
      'projects',
      'learning',
      'achievements',
    ]);
  });

  it('keeps chronological order for "all"', () => {
    expect(filterFeedPosts(posts, 'all')).toHaveLength(posts.length);
  });

  it('splits records by their real type', () => {
    expect(filterFeedPosts(posts, 'projects')).toHaveLength(1);
    expect(filterFeedPosts(posts, 'learning')).toHaveLength(1);
    expect(filterFeedPosts(posts, 'achievements')).toHaveLength(0);
  });
});

describe('formatFeedTime', () => {
  const now = new Date('2026-03-02T12:00:00Z');

  it('formats each real distance band', () => {
    expect(formatFeedTime('2026-03-02T11:59:30Z', now)).toBe('Just now');
    expect(formatFeedTime('2026-03-02T11:30:00Z', now)).toBe('30m ago');
    expect(formatFeedTime('2026-03-02T09:00:00Z', now)).toBe('3h ago');
    expect(formatFeedTime('2026-02-27T12:00:00Z', now)).toBe('3d ago');
  });

  it('falls back to a month and year past 30 days', () => {
    expect(formatFeedTime('2025-11-02T12:00:00Z', now)).toBe('Nov 2025');
  });

  it('returns an empty string for an unparseable timestamp rather than guessing', () => {
    expect(formatFeedTime('not-a-date', now)).toBe('');
  });
});
