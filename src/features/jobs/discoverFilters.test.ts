/**
 * Unit tests for the Discover model — the mapping and formatting the screen,
 * the cards and the detail route all depend on.
 *
 * These run in Node (no native runtime), matching the project's Vitest setup,
 * so the behaviour that must stay identical to the backend is pinned here
 * rather than only verified on a device.
 */

import { describe, expect, it } from 'vitest';

import {
  DISCOVER_CATEGORIES,
  activeFacets,
  categoryToType,
  companyIsVerified,
  filterToQueryRecord,
  formatCompensation,
  formatDeadline,
  formatRelativePublishedAt,
  nextPageParam,
  recordToFetchParams,
} from './discoverFilters';
import type { FastApiPage } from '@/types/story';
import type { Opportunity } from '@/types/opportunity';

function page(overrides: Partial<FastApiPage<Opportunity>>): FastApiPage<Opportunity> {
  return { items: [], total: 0, page: 1, page_size: 20, pages: 0, ...overrides };
}

describe('categories', () => {
  it('offers All plus the four supported opportunity types', () => {
    expect(DISCOVER_CATEGORIES.map((category) => category.label)).toEqual([
      'All',
      'Jobs',
      'Internships',
      'Apprenticeships',
      'Projects & Gigs',
    ]);
  });

  it('maps each category to its API type value', () => {
    expect(categoryToType('all')).toBeUndefined();
    expect(categoryToType('jobs')).toBe('job');
    expect(categoryToType('internships')).toBe('internship');
    expect(categoryToType('apprenticeships')).toBe('apprenticeship');
    expect(categoryToType('projects-gigs')).toBe('project_gig');
  });

  it('returns undefined for an unknown category id', () => {
    expect(categoryToType('does-not-exist')).toBeUndefined();
  });

  it('gives every category both a label and both platform icons', () => {
    for (const category of DISCOVER_CATEGORIES) {
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.icon.ios.length).toBeGreaterThan(0);
      expect(category.icon.android.length).toBeGreaterThan(0);
    }
  });
});

describe('filterToQueryRecord', () => {
  it('is empty for the default "All / any / no search" state', () => {
    expect(filterToQueryRecord({ category: 'all', workMode: null, query: '' })).toEqual({});
  });

  it('omits undefined fields so the key is stable whether set or cleared', () => {
    expect(filterToQueryRecord({ category: 'jobs', workMode: null, query: '' })).toEqual({
      type: 'job',
    });
  });

  it('carries the work mode and the trimmed search query', () => {
    expect(
      filterToQueryRecord({ category: 'internships', workMode: 'remote', query: '  backend  ' }),
    ).toEqual({ type: 'internship', workMode: 'remote', query: 'backend' });
  });

  it('drops a whitespace-only query so it does not become a real filter', () => {
    expect(filterToQueryRecord({ category: 'all', workMode: 'hybrid', query: '   ' })).toEqual({
      workMode: 'hybrid',
    });
  });

  it('round-trips back into the fetch params the API layer accepts', () => {
    const record = filterToQueryRecord({
      category: 'apprenticeships',
      workMode: 'onsite',
      query: 'rust',
    });
    expect(recordToFetchParams(record)).toEqual({
      type: 'apprenticeship',
      workMode: 'onsite',
      query: 'rust',
    });
  });
});

describe('activeFacets', () => {
  const remove = { onClearSearch: () => {}, onClearCategory: () => {}, onClearWorkMode: () => {} };

  it('is empty for the default "All / any / no search" state', () => {
    expect(activeFacets({ category: 'all', workMode: null, query: '' }, remove)).toEqual([]);
  });

  it('drops a whitespace-only search so it never becomes a facet', () => {
    expect(activeFacets({ category: 'all', workMode: null, query: '   ' }, remove)).toEqual([]);
  });

  it('lists query, category and work mode in a stable order', () => {
    const facets = activeFacets(
      { category: 'jobs', workMode: 'remote', query: 'backend' },
      remove,
    );
    expect(facets.map((facet) => facet.id)).toEqual(['query', 'category', 'workMode']);
    expect(facets.map((facet) => facet.label)).toEqual(['“backend”', 'Jobs', 'Remote']);
  });

  it('omits the category facet for "All", which is no narrowing', () => {
    const facets = activeFacets({ category: 'all', workMode: 'hybrid', query: '' }, remove);
    expect(facets.map((facet) => facet.id)).toEqual(['workMode']);
  });
});

describe('nextPageParam', () => {
  it('advances while there is another page', () => {
    expect(nextPageParam(page({ page: 1, pages: 3 }))).toBe(2);
    expect(nextPageParam(page({ page: 2, pages: 3 }))).toBe(3);
  });

  it('stops on the last page', () => {
    expect(nextPageParam(page({ page: 3, pages: 3 }))).toBeUndefined();
  });

  it('stops immediately on an empty feed (zero pages)', () => {
    expect(nextPageParam(page({ page: 1, pages: 0 }))).toBeUndefined();
  });
});

describe('formatCompensation', () => {
  it('is null when no figure is set', () => {
    expect(formatCompensation(null, null, 'INR', 'year')).toBeNull();
  });

  it('formats a range with grouping and period', () => {
    expect(formatCompensation(500000, 800000, 'INR', 'year')).toBe('INR 500,000 – 800,000 / year');
  });

  it('reads a lone minimum as a floor', () => {
    expect(formatCompensation(1200, null, 'USD', 'month')).toBe('USD 1,200+ / month');
  });

  it('reads a lone maximum as a ceiling', () => {
    expect(formatCompensation(null, 45, 'USD', 'hour')).toBe('Up to USD 45 / hour');
  });

  it('keeps decimals only when present', () => {
    expect(formatCompensation(1000, 1500.5, 'INR', null)).toBe('INR 1,000 – 1,500.5');
  });

  it('omits the currency and period when the server sends none', () => {
    expect(formatCompensation(1000, 2000, null, null)).toBe('1,000 – 2,000');
  });
});

describe('formatDeadline', () => {
  const now = new Date(2026, 9, 10); // 10 Oct 2026, local

  it('formats a future deadline as not past', () => {
    expect(formatDeadline('2026-10-12', now)).toEqual({
      label: 'Apply by 12 Oct 2026',
      isPast: false,
      urgency: 'soon',
    });
  });

  it('marks a deadline before today as past', () => {
    expect(formatDeadline('2026-10-01', now)).toEqual({
      label: 'Apply by 1 Oct 2026',
      isPast: true,
      urgency: 'past',
    });
  });

  it('treats today as not yet past', () => {
    expect(formatDeadline('2026-10-10', now)?.isPast).toBe(false);
    // Today is the closest "soon" a deadline can be: zero days out.
    expect(formatDeadline('2026-10-10', now)?.urgency).toBe('soon');
  });

  it('calls today..7 days out "soon"', () => {
    // 7 days out is the inclusive boundary of the soon band.
    expect(formatDeadline('2026-10-17', now)?.urgency).toBe('soon');
  });

  it('calls more than 7 days out "normal"', () => {
    expect(formatDeadline('2026-10-18', now)?.urgency).toBe('normal');
  });

  it('is null for a missing deadline', () => {
    expect(formatDeadline(null, now)).toBeNull();
  });

  it('is null for a malformed date rather than showing "Invalid Date"', () => {
    expect(formatDeadline('not-a-date', now)).toBeNull();
  });
});

describe('formatRelativePublishedAt', () => {
  const now = new Date('2026-10-10T12:00:00.000Z');

  it('says "Just now" under a minute', () => {
    expect(formatRelativePublishedAt('2026-10-10T11:59:40.000Z', now)).toBe('Just now');
  });

  it('counts minutes, hours, days, weeks, months, years', () => {
    expect(formatRelativePublishedAt('2026-10-10T11:30:00.000Z', now)).toBe('30m ago');
    expect(formatRelativePublishedAt('2026-10-10T06:00:00.000Z', now)).toBe('6h ago');
    expect(formatRelativePublishedAt('2026-10-07T12:00:00.000Z', now)).toBe('3d ago');
    expect(formatRelativePublishedAt('2026-09-26T12:00:00.000Z', now)).toBe('2w ago');
    expect(formatRelativePublishedAt('2026-07-10T12:00:00.000Z', now)).toBe('3mo ago');
    expect(formatRelativePublishedAt('2024-10-10T12:00:00.000Z', now)).toBe('2y ago');
  });

  it('is null when there is no timestamp', () => {
    expect(formatRelativePublishedAt(null, now)).toBeNull();
  });

  it('is null for an unparseable timestamp', () => {
    expect(formatRelativePublishedAt('nonsense', now)).toBeNull();
  });
});

describe('companyIsVerified', () => {
  it('is true only for the server value "verified"', () => {
    expect(companyIsVerified('verified')).toBe(true);
    expect(companyIsVerified('unverified')).toBe(false);
    expect(companyIsVerified('pending')).toBe(false);
    expect(companyIsVerified('rejected')).toBe(false);
    expect(companyIsVerified(null)).toBe(false);
    expect(companyIsVerified(undefined)).toBe(false);
  });
});

