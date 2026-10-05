/**
 * Community Feed model tests.
 *
 * The feed is the one place on the candidate dashboard where invented data could
 * leak in unnoticed, so these tests pin the rules that keep it honest:
 *
 *  - the real half of the stream is the candidate's **own** records, and only
 *    their own records;
 *  - ordering follows the record's real timestamp;
 *  - **every post carries server-counted engagement**, and the client never
 *    computes a count of its own;
 *  - no filter promises a personalised ranking;
 *  - media sizing never crops, and never produces `NaN`.
 */

import { describe, expect, it } from 'vitest';

import {
  BODY_PREVIEW_CHARS,
  BODY_PREVIEW_LINES,
  clampMediaIndex,
  countByCategory,
  feedFilters,
  feedKindLabel,
  filterFeed,
  formatFeedTime,
  formatRecordDate,
  fromProfileRecords,
  MAX_MEDIA_HEIGHT,
  mediaAspectRatio,
  mediaCountLabel,
  mediaDisplayHeight,
  mergeFeed,
  sortNewestFirst,
  type FeedMedia,
  type FeedPost,
} from '@/features/feed/feedModel';
import type { ProfileAggregate } from '@/types/profile';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                     */
/* -------------------------------------------------------------------------- */

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

const certification = {
  id: 'c1',
  title: 'Cloud Fundamentals',
  issuer: 'Example Institute',
  issued_on: '2026-02-10',
  expires_on: null,
  credential_id: null,
  verification_url: 'https://example.com/verify/abc',
  created_at: '2026-02-11T00:00:00Z',
  updated_at: '2026-02-11T00:00:00Z',
};

const achievement = {
  id: 'a1',
  title: 'Hackathon finalist',
  issuer: 'Example University',
  category: 'Competition',
  achieved_on: '2026-01-20',
  description: 'Top five of forty teams.',
  created_at: '2026-01-21T00:00:00Z',
  updated_at: '2026-01-21T00:00:00Z',
};

const education = {
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

function makeMedia(overrides: Partial<FeedMedia> = {}): FeedMedia {
  return {
    id: 'm1',
    kind: 'image',
    uri: 'https://example.com/photo.png',
    width: 1280,
    height: 800,
    alt: 'A description of the image.',
    ...overrides,
  };
}

/** A minimal post for the merge and filter tests — never a real record. */
function makePost(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'post-1',
    kind: 'text',
    category: 'community',
    origin: 'profile',
    title: null,
    body: 'A body.',
    media: [],
    project: null,
    achievement: null,
    tags: [],
    createdAt: '2026-03-01T00:00:00Z',
    // A post with no interactions. Real counts come from the server, so the
    // fixture default is the only honest value a local post can hold.
    engagement: { likeCount: 0, commentCount: 0, likedByMe: false },
    author: {
      name: 'Ada Lovelace',
      username: 'ada',
      publicId: 'pub_ada',
      headline: null,
      avatarUrl: null,
      profileHref: '/profile',
      verified: false,
    },
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* fromProfileRecords                                                          */
/* -------------------------------------------------------------------------- */

describe('fromProfileRecords', () => {
  it('returns nothing when the candidate has no records', () => {
    expect(fromProfileRecords(makeProfile())).toEqual([]);
  });

  it('authors every post as the authenticated candidate, not as anyone else', () => {
    const posts = fromProfileRecords(makeProfile({ projects: [project] }));
    expect(posts[0].author).toEqual({
      name: 'Ada Lovelace',
      // The caller's own handles. `public_id` is on the profile aggregate; the
      // *handle* is not, so it stays null rather than being invented.
      username: null,
      publicId: 'pub1',
      headline: 'Software Engineering Intern',
      avatarUrl: null,
      profileHref: '/profile',
      verified: false,
    });
  });

  it('never claims a verification badge, because no verification service exists', () => {
    const posts = fromProfileRecords(
      makeProfile({
        projects: [project],
        certifications: [certification],
        achievements: [achievement],
        education: [education],
      }),
    );
    expect(posts.every((post) => post.author.verified === false)).toBe(true);
  });

  it('carries server engagement as an explicit zero, never a loose count', () => {
    const post = fromProfileRecords(makeProfile({ projects: [project] }))[0] as FeedPost &
      Record<string, unknown>;

    // A profile record was never *published*, so it has no server-side engagement.
    // Zero is the honest value; absent would force every reader to guess.
    expect(post.engagement).toEqual({ likeCount: 0, commentCount: 0, likedByMe: false });

    // The loose shapes the old model used are still forbidden, so a card cannot
    // reach for a number that nothing in this codebase maintains.
    for (const key of ['likes', 'comments', 'shares', 'bookmarks', 'counts', 'likeCount']) {
      expect(post[key], `post must not carry a loose ${key}`).toBeUndefined();
    }
  });

  it('maps each record to its real filter category', () => {
    const posts = fromProfileRecords(
      makeProfile({
        projects: [project],
        certifications: [certification],
        achievements: [achievement],
        education: [education],
      }),
    );
    const byId = new Map(posts.map((post) => [post.id, post]));

    expect(byId.get('project-p1')?.category).toBe('projects');
    // A certificate is achievement content — which is what the Achievements
    // filter promises — not a learning update.
    expect(byId.get('certification-c1')?.category).toBe('achievements');
    expect(byId.get('achievement-a1')?.category).toBe('achievements');
    expect(byId.get('education-e1')?.category).toBe('learning');
  });

  it('only includes links the record really carries', () => {
    const withoutUrls = fromProfileRecords(
      makeProfile({ projects: [{ ...project, source_url: null, live_url: null }] }),
    );
    expect(withoutUrls[0].project?.sourceUrl).toBeNull();
    expect(withoutUrls[0].project?.liveUrl).toBeNull();

    const withUrls = fromProfileRecords(makeProfile({ projects: [project] }));
    expect(withUrls[0].project?.sourceUrl).toBe('https://github.com/example/repo');
    expect(withUrls[0].project?.liveUrl).toBe('https://example.com');
  });

  it('leaves profile fields the API does not return as null rather than inventing them', () => {
    const posts = fromProfileRecords(makeProfile({ projects: [project] }));
    expect(posts[0].project?.category).toBeNull();
    expect(posts[0].project?.status).toBeNull();
    expect(posts[0].project?.team).toBeNull();
  });

  it('carries no media for a profile record, whose API exposes no images', () => {
    expect(fromProfileRecords(makeProfile({ projects: [project] }))[0].media).toEqual([]);
  });

  it('keeps a certificate’s real verification URL, and never invents one', () => {
    const posts = fromProfileRecords(makeProfile({ certifications: [certification] }));
    expect(posts[0].achievement?.verificationUrl).toBe('https://example.com/verify/abc');

    const withoutUrl = fromProfileRecords(
      makeProfile({ certifications: [{ ...certification, verification_url: null }] }),
    );
    expect(withoutUrl[0].achievement?.verificationUrl).toBeNull();
  });

  it('does not repeat an achievement description as body text as well', () => {
    const posts = fromProfileRecords(makeProfile({ achievements: [achievement] }));
    expect(posts[0].body).toBeNull();
    expect(posts[0].achievement?.description).toBe('Top five of forty teams.');
  });

  it('carries a project’s tags from its real skills', () => {
    expect(fromProfileRecords(makeProfile({ projects: [project] }))[0].tags).toEqual(['React']);
  });

  it('orders records newest first using their real timestamps', () => {
    const older = { ...project, id: 'p0', created_at: '2026-01-01T00:00:00Z' };
    const posts = fromProfileRecords(makeProfile({ projects: [older, project] }));
    expect(posts.map((post) => post.id)).toEqual(['project-p1', 'project-p0']);
  });
});

/* -------------------------------------------------------------------------- */
/* Ordering                                                                     */
/* -------------------------------------------------------------------------- */

describe('sortNewestFirst', () => {
  it('sorts a mixed set newest first', () => {
    const posts = sortNewestFirst([
      makePost({ id: 'old', createdAt: '2026-01-01T00:00:00Z' }),
      makePost({ id: 'new', createdAt: '2026-06-01T00:00:00Z' }),
      makePost({ id: 'mid', createdAt: '2026-03-01T00:00:00Z' }),
    ]);
    expect(posts.map((post) => post.id)).toEqual(['new', 'mid', 'old']);
  });

  it('sorts a malformed timestamp last, so it cannot pose as the newest post', () => {
    const posts = sortNewestFirst([
      makePost({ id: 'broken', createdAt: 'not-a-date' }),
      makePost({ id: 'real', createdAt: '2026-03-01T00:00:00Z' }),
    ]);
    expect(posts[0].id).toBe('real');
  });

  it('does not mutate the array it is given', () => {
    const source = [makePost({ id: 'a' })];
    sortNewestFirst(source);
    expect(source).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Filters                                                                      */
/* -------------------------------------------------------------------------- */

describe('feed filters', () => {
  const posts = [
    makePost({ id: 'p', category: 'projects' }),
    makePost({ id: 'a', category: 'achievements' }),
    makePost({ id: 'l', category: 'learning' }),
    makePost({ id: 'c', category: 'community' }),
  ];

  it('offers exactly four filters, and never a personalised one', () => {
    expect(feedFilters.map((filter) => filter.value)).toEqual([
      'latest',
      'projects',
      'achievements',
      'learning',
    ]);
    expect(feedFilters.map((filter) => filter.label)).not.toContain('For You');
  });

  it('keeps every post for latest, in order', () => {
    expect(filterFeed(posts, 'latest').map((post) => post.id)).toEqual(['p', 'a', 'l', 'c']);
  });

  it('splits posts by their real category', () => {
    expect(filterFeed(posts, 'projects').map((post) => post.id)).toEqual(['p']);
    expect(filterFeed(posts, 'achievements').map((post) => post.id)).toEqual(['a']);
    expect(filterFeed(posts, 'learning').map((post) => post.id)).toEqual(['l']);
  });

  it('returns a new array, so a caller cannot mutate the source list', () => {
    expect(filterFeed(posts, 'latest')).not.toBe(posts);
  });

  it('counts posts per category, so an empty filter can explain itself', () => {
    expect(countByCategory(posts)).toEqual({
      projects: 1,
      achievements: 1,
      learning: 1,
      community: 1,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Merge                                                                        */
/* -------------------------------------------------------------------------- */

describe('mergeFeed', () => {
  const real = [makePost({ id: 'real-1' })];
  const demo = [makePost({ id: 'demo-1', origin: 'demo' })];

  it('returns the real posts untouched when demo mode is off', () => {
    const merged = mergeFeed(real, demo, { demoEnabled: false });
    expect(merged).toEqual(real);
    expect(merged).toHaveLength(1);
  });

  it('appends demo posts after the real ones, never replacing them', () => {
    const merged = mergeFeed(real, demo, { demoEnabled: true });
    expect(merged.map((post) => post.id)).toEqual(['real-1', 'demo-1']);
  });

  it('returns only demo posts when the candidate has no records', () => {
    expect(mergeFeed([], demo, { demoEnabled: true })).toHaveLength(1);
  });

  it('keeps the empty list empty when demo mode is off and there are no records', () => {
    expect(mergeFeed([], [], { demoEnabled: false })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Labels and time                                                              */
/* -------------------------------------------------------------------------- */

describe('feedKindLabel', () => {
  it('badges the structured kinds', () => {
    expect(feedKindLabel('project')).toBe('Project Showcase');
    expect(feedKindLabel('achievement')).toBe('Achievement');
    expect(feedKindLabel('learning')).toBe('Learning');
    expect(feedKindLabel('video')).toBe('Video Demo');
  });

  it('shows no badge on a plain text or image post', () => {
    expect(feedKindLabel('text')).toBeNull();
    expect(feedKindLabel('image')).toBeNull();
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

describe('formatRecordDate', () => {
  it('formats a real date', () => {
    expect(formatRecordDate('2026-02-10')).toBe('Feb 10, 2026');
  });

  it('returns null for an absent or unparseable date, so no date row renders', () => {
    expect(formatRecordDate(null)).toBeNull();
    expect(formatRecordDate('nonsense')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Media                                                                        */
/* -------------------------------------------------------------------------- */

describe('media sizing', () => {
  it('preserves the aspect ratio below the cap', () => {
    // 1280x800 at 360 wide is 225 tall — under the cap, so the ratio survives.
    expect(mediaDisplayHeight(makeMedia(), 360)).toBe(225);
  });

  it('caps a very tall image so it cannot fill the screen', () => {
    expect(mediaDisplayHeight(makeMedia({ width: 400, height: 4000 }), 360)).toBe(
      MAX_MEDIA_HEIGHT,
    );
  });

  it('never puts a certificate in a fixed box: its height differs from a screenshot’s', () => {
    const certificate = makeMedia({ width: 1280, height: 900 });
    const screenshot = makeMedia({ width: 1280, height: 800 });
    expect(mediaDisplayHeight(certificate, 360)).not.toBe(mediaDisplayHeight(screenshot, 360));
  });

  it('falls back to 4:3 for a degenerate size instead of producing NaN', () => {
    const broken = makeMedia({ width: 0, height: 0 });
    expect(mediaDisplayHeight(broken, 400)).toBe(300);
    expect(mediaAspectRatio(broken)).toBeCloseTo(4 / 3);
  });
});

describe('media paging rules', () => {
  it('clamps an index into the list', () => {
    expect(clampMediaIndex(0, 3)).toBe(0);
    expect(clampMediaIndex(2, 3)).toBe(2);
    expect(clampMediaIndex(9, 3)).toBe(2);
    expect(clampMediaIndex(-4, 3)).toBe(0);
    expect(clampMediaIndex(1.7, 3)).toBe(1);
  });

  it('resolves an index for an empty list rather than returning -1', () => {
    expect(clampMediaIndex(4, 0)).toBe(0);
  });

  it('shows a count only for a multi-image post', () => {
    expect(mediaCountLabel(0, 1)).toBeNull();
    expect(mediaCountLabel(0, 3)).toBe('1 of 3 images');
    expect(mediaCountLabel(2, 3)).toBe('3 of 3 images');
    expect(mediaCountLabel(99, 3)).toBe('3 of 3 images');
  });
});

describe('body preview constants', () => {
  it('clamps long text rather than printing all of it', () => {
    expect(BODY_PREVIEW_CHARS).toBeGreaterThan(120);
    expect(BODY_PREVIEW_CHARS).toBeLessThanOrEqual(400);
    expect(BODY_PREVIEW_LINES).toBeGreaterThanOrEqual(3);
    expect(BODY_PREVIEW_LINES).toBeLessThanOrEqual(6);
  });
});

