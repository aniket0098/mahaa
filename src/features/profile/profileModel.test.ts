/**
 * Profile model tests.
 *
 * The profile page is the second place invented data could leak in (the feed is
 * the first), so these tests pin the rules that keep it honest:
 *
 *  - every number is a count of records the server actually returned;
 *  - an unanswered request stays `null` and is never rendered as `0`;
 *  - no leaderboard, rank, or score is manufactured where none exists;
 *  - a link is only offered when the server stored a browsable URL;
 *  - every navigation target is a route that is declared in `navConfig`.
 */

import { describe, expect, it } from 'vitest';

import { CANDIDATE_DETAIL_ROUTES } from '@/config/navConfig';
import {
  ABOUT_COLLAPSE_CHARS,
  buildActivityCards,
  buildGallery,
  buildHeaderMeta,
  buildProfileShareMessage,
  buildStatEntries,
  credentialDate,
  dateRange,
  journeyChips,
  monthYear,
  needsSeeMore,
  verificationLink,
  type StatLink,
} from '@/features/profile/profileModel';
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

const education = {
  id: 'e1',
  institution: 'VIT Vellore',
  degree: 'B.Tech',
  field_of_study: 'Computer Science',
  level: 'undergraduate',
  start_date: '2022-08-01',
  end_date: '2026-05-01',
  current: false,
  grade: null,
  description: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as const;

const certification = {
  id: 'c1',
  title: 'Cloud Fundamentals',
  issuer: 'Example Institute',
  issued_on: '2026-02-10',
  expires_on: null,
  credential_id: 'ABC-1',
  verification_url: 'https://example.com/verify/abc',
  created_at: '2026-02-10T00:00:00Z',
  updated_at: '2026-02-10T00:00:00Z',
} as const;

const achievement = {
  id: 'a1',
  title: 'Hackathon winner',
  issuer: null,
  category: 'hackathon',
  achieved_on: '2026-03-04',
  description: null,
  created_at: '2026-03-04T00:00:00Z',
  updated_at: '2026-03-04T00:00:00Z',
} as const;

/** Every route the derivations may push to must exist in the inventory. */
function assertDeclared(link: StatLink | null) {
  if (link?.kind !== 'route') return;
  const declared = CANDIDATE_DETAIL_ROUTES.some((route) => route.path === link.path);
  expect(declared, `${link.path} is not a declared detail route`).toBe(true);
}

/* -------------------------------------------------------------------------- */

describe('buildHeaderMeta', () => {
  it('returns nulls when the candidate has no education record', () => {
    const meta = buildHeaderMeta({ location: 'Pune' }, []);
    expect(meta).toEqual({
      course: null,
      institution: null,
      graduation: null,
      location: 'Pune',
    });
  });

  it('derives course, institution and graduation from the stored record', () => {
    const meta = buildHeaderMeta({ location: null }, [education]);
    expect(meta.course).toBe('B.Tech · Computer Science');
    expect(meta.institution).toBe('VIT Vellore');
    expect(meta.graduation).toBe('2026');
    expect(meta.location).toBeNull();
  });

  it('says Present for an ongoing record rather than inventing a year', () => {
    const meta = buildHeaderMeta({ location: null }, [
      { ...education, end_date: null, current: true },
    ]);
    expect(meta.graduation).toBe('Present');
  });

  it('leaves the course line empty when the record carries no course fields', () => {
    const meta = buildHeaderMeta({ location: null }, [
      { ...education, degree: null, field_of_study: null },
    ]);
    expect(meta.course).toBeNull();
  });
});

describe('buildStatEntries', () => {
  it('keeps an unknown post count null instead of showing 0', () => {
    const loading = buildStatEntries({
      postsTotal: null,
      postsLoading: true,
      projectCount: 3,
      skillCount: 5,
    });
    const posts = loading.find((entry) => entry.key === 'posts');
    expect(posts?.value).toBeNull();
    expect(posts?.loading).toBe(true);

    // A failed request is still unknown, and it is no longer in flight.
    const failed = buildStatEntries({
      postsTotal: null,
      postsLoading: false,
      projectCount: 3,
      skillCount: 5,
    });
    expect(failed.find((entry) => entry.key === 'posts')?.loading).toBe(false);
  });

  it('offers a real destination for every entry', () => {
    const entries = buildStatEntries({
      postsTotal: 7,
      postsLoading: false,
      projectCount: 3,
      skillCount: 5,
    });
    expect(entries.map((entry) => entry.label)).toEqual(['Posts', 'Projects', 'Skills']);
    for (const entry of entries) assertDeclared(entry.link);
    // The post count leads to the section on this page, not to a route.
    expect(entries[0]?.link).toEqual({ kind: 'scroll', anchor: expect.any(String) });
  });

  it('never mentions connections or followers, which no endpoint can back', () => {
    const entries = buildStatEntries({
      postsTotal: 1,
      postsLoading: false,
      projectCount: 1,
      skillCount: 1,
    });
    const labels = entries.map((entry) => entry.label.toLowerCase());
    expect(labels).not.toContain('connections');
    expect(labels).not.toContain('followers');
  });
});

describe('buildActivityCards', () => {
  it('counts only records the candidate actually owns', () => {
    const cards = buildActivityCards(makeProfile({ certifications: [certification] }));
    const byKey = Object.fromEntries(cards.map((card) => [card.key, card.value]));

    expect(byKey).toEqual({
      achievements: 0,
      certifications: 1,
      experience: 0,
      education: 0,
      links: 0,
      completeness: 40,
    });
  });

  it('never presents a leaderboard, rank, or score', () => {
    const cards = buildActivityCards(makeProfile());
    const text = cards.map((card) => `${card.title} ${card.caption}`).join(' ').toLowerCase();
    expect(text).not.toMatch(/rank|leaderboard|score|percentile|top /);
    expect(cards).toHaveLength(6);
  });

  it('uses the server percentage for profile strength, never an estimate', () => {
    const profile = makeProfile({ completeness: { percent: 73, sections: [] } });
    const card = buildActivityCards(profile).find((entry) => entry.key === 'completeness');
    expect(card?.value).toBe(73);
  });

  it('only routes to declared detail routes', () => {
    for (const card of buildActivityCards(makeProfile())) assertDeclared(card.link);
  });
});

describe('journeyChips', () => {
  it('trims, drops empties and deduplicates case-insensitively', () => {
    expect(journeyChips(['  Design ', '', 'design', 'Data Science', '   '])).toEqual([
      'Design',
      'Data Science',
    ]);
  });

  it('returns an empty list when the candidate saved no interests', () => {
    expect(journeyChips([])).toEqual([]);
    expect(journeyChips(['   '])).toEqual([]);
  });
});

describe('about truncation', () => {
  it('offers See more only past the collapse threshold', () => {
    expect(needsSeeMore('x'.repeat(ABOUT_COLLAPSE_CHARS))).toBe(false);
    expect(needsSeeMore('x'.repeat(ABOUT_COLLAPSE_CHARS + 1))).toBe(true);
    expect(needsSeeMore(null)).toBe(false);
    expect(needsSeeMore('   ')).toBe(false);
  });
});


describe('buildProfileShareMessage', () => {
  it('shares only fields the server returned and never a fabricated URL', () => {
    const meta = buildHeaderMeta({ location: 'Pune' }, [education]);
    const message = buildProfileShareMessage(
      { name: 'Ada Lovelace', headline: 'Software Engineering Intern' },
      meta,
    );
    expect(message).toBe(
      [
        'Ada Lovelace',
        'Software Engineering Intern',
        'B.Tech · Computer Science',
        'VIT Vellore',
        'Pune',
      ].join('\n'),
    );
    expect(message).not.toMatch(/https?:\/\//);
  });

  it('skips absent fields instead of rendering blank lines', () => {
    const meta = buildHeaderMeta({ location: null }, []);
    const message = buildProfileShareMessage({ name: 'Ada Lovelace', headline: null }, meta);
    expect(message).toBe('Ada Lovelace');
  });
});

describe('dates', () => {
  it('formats a month and year, and answers null for an absent date', () => {
    expect(monthYear('2026-05-01')).toBe('May 2026');
    expect(monthYear(null)).toBeNull();
    expect(monthYear('not-a-date')).toBeNull();
  });

  it('omits a range entirely when the record has no dates', () => {
    expect(dateRange(null, null, false)).toBeNull();
    expect(dateRange('2024-06-01', null, true)).toBe('Jun 2024 – Present');
    expect(dateRange(null, null, true)).toBe('Present');
  });

  it('shows only what the credential records', () => {
    expect(credentialDate({ issued_on: '2026-02-10', expires_on: null })).toBe('Issued Feb 2026');
    expect(credentialDate({ issued_on: null, expires_on: null })).toBeNull();
    expect(credentialDate({ issued_on: '2026-02-10', expires_on: '2027-02-10' })).toBe(
      'Issued Feb 2026 · Expires Feb 2027',
    );
  });
});

describe('verificationLink', () => {
  it('passes through a real http(s) URL', () => {
    expect(verificationLink('https://example.com/verify/abc')).toBe(
      'https://example.com/verify/abc',
    );
  });

  it('drops anything that would not open in the browser', () => {
    expect(verificationLink(null)).toBeNull();
    expect(verificationLink('')).toBeNull();
    expect(verificationLink('   ')).toBeNull();
    expect(verificationLink('javascript:alert(1)')).toBeNull();
    expect(verificationLink('example.com/verify')).toBeNull();
  });
});

describe('buildGallery', () => {
  it('keeps a certificate’s real issuer and verification URL', () => {
    const gallery = buildGallery([certification], []);
    expect(gallery).toHaveLength(1);
    expect(gallery[0]?.issuer).toBe('Example Institute');
    expect(gallery[0]?.verificationUrl).toBe('https://example.com/verify/abc');
    expect(gallery[0]?.date).toBe('Issued Feb 2026');
    expect(gallery[0]?.detail).toBe('Credential ABC-1');
  });

  it('never invents a verification URL for an achievement', () => {
    const gallery = buildGallery([], [achievement]);
    expect(gallery[0]?.verificationUrl).toBeNull();
    // The API has no issuer on an achievement, so its category is what shows.
    expect(gallery[0]?.issuer).toBe('hackathon');
    expect(gallery[0]?.kind).toBe('achievement');
  });

  it('drops a stored verification URL that is not browsable', () => {
    const gallery = buildGallery([{ ...certification, verification_url: 'not-a-url' }], []);
    expect(gallery[0]?.verificationUrl).toBeNull();
  });

  it('returns an empty gallery when the candidate has neither', () => {
    expect(buildGallery([], [])).toEqual([]);
  });
});

