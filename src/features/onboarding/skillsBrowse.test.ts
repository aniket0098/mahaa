/**
 * Tests for the onboarding skill picker's browse/search behaviour.
 *
 * The bug was that the step issued **no catalogue request at all** until
 * somebody typed, so these start from the request the picker would make with an
 * empty field — the case that used not to exist.
 */

import { describe, expect, it } from 'vitest';

import {
  CATALOG_PAGE_SIZE,
  catalogCaption,
  catalogMode,
  catalogRequest,
  catalogTerm,
  catalogViewState,
  ownedSkillIds,
  showMoreLabel,
} from '@/features/onboarding/skillsBrowse';

/** The seeded production catalogue, for realistic totals. */
const CATALOGUE_TOTAL = 140;

describe('1. the step loads a catalogue without any search query', () => {
  it('treats an empty field as a request for the first browse page', () => {
    // The regression. There is no longer a state in which this step asks for
    // nothing; an empty term is a list-all request.
    const request = catalogRequest('');
    expect(request.q).toBe('');
    expect(request.offset).toBe(0);
    expect(request.limit).toBe(CATALOG_PAGE_SIZE);
  });

  it('treats a whitespace-only field as no search typed', () => {
    expect(catalogTerm('   ')).toBe('');
    expect(catalogMode(catalogTerm('   '))).toBe('browse');
    expect(catalogRequest('  ').q).toBe('');
  });

  it('reads as browsing, not searching, before anything is typed', () => {
    expect(catalogMode('')).toBe('browse');
  });

  it('asks for a page the server will actually serve', () => {
    // `MAX_PAGE_LIMIT` is 200 and `DEFAULT_PAGE_LIMIT` is 100, so the request is
    // a fraction of what the endpoint allows and nothing gets truncated.
    expect(CATALOG_PAGE_SIZE).toBeGreaterThan(0);
    expect(CATALOG_PAGE_SIZE).toBeLessThanOrEqual(100);
    expect(CATALOG_PAGE_SIZE).toBeLessThan(CATALOGUE_TOTAL);
  });

  it('shows a loading state rather than an empty catalogue while it fetches', () => {
    expect(
      catalogViewState({ mode: 'browse', hasData: false, isFetching: true, shown: 0 }),
    ).toBe('loading');
    // Not started yet either: still loading, never "the catalogue is empty".
    expect(
      catalogViewState({ mode: 'browse', hasData: false, isFetching: false, shown: 0 }),
    ).toBe('loading');
  });

  it('shows the first page of skills once it arrives', () => {
    expect(
      catalogViewState({ mode: 'browse', hasData: true, isFetching: false, shown: CATALOG_PAGE_SIZE }),
    ).toBe('results');
  });
});

describe('2. search still filters', () => {
  it('sends the trimmed term and switches to search mode', () => {
    const request = catalogRequest('  python  ');
    expect(request.q).toBe('python');
    expect(catalogMode(request.q)).toBe('search');
    expect(request.limit).toBe(CATALOG_PAGE_SIZE);
  });

  it('resets paging to the first page for a new term', () => {
    expect(catalogRequest('python').offset).toBe(0);
  });

  it('accumulates pages for the same term without re-requesting page one', () => {
    expect(catalogRequest('python', CATALOG_PAGE_SIZE).offset).toBe(CATALOG_PAGE_SIZE);
    expect(catalogRequest('', CATALOG_PAGE_SIZE).offset).toBe(CATALOG_PAGE_SIZE);
  });

  it('clamps an invalid offset rather than sending one the server rejects', () => {
    expect(catalogRequest('python', -5).offset).toBe(0);
    expect(catalogRequest('python', 1.5).offset).toBe(0);
  });

  it('reports match counts from the server total', () => {
    expect(catalogCaption({ mode: 'search', term: 'python', shown: 1, total: 1 })).toBe(
      '1 match for “python”.',
    );
    expect(catalogCaption({ mode: 'search', term: 'design', shown: 13, total: 13 })).toBe(
      '13 matches for “design”.',
    );
  });
});
describe('3. an empty result is not confused with no search typed', () => {
  it('reports "no matches" when a term matched nothing', () => {
    expect(
      catalogViewState({ mode: 'search', hasData: true, isFetching: false, shown: 0 }),
    ).toBe('no-matches');
  });

  it('reports an empty catalogue separately, for a browse with no rows', () => {
    expect(
      catalogViewState({ mode: 'browse', hasData: true, isFetching: false, shown: 0 }),
    ).toBe('catalogue-empty');
  });

  it('does not confuse the two', () => {
    const searched = catalogViewState({ mode: 'search', hasData: true, isFetching: false, shown: 0 });
    const browsed = catalogViewState({ mode: 'browse', hasData: true, isFetching: false, shown: 0 });
    expect(searched).not.toBe(browsed);
  });
});

describe('4/5. selection and already-held skills', () => {
  const HELD = [{ skill_id: 'id-python' }, { skill_id: 'id-react' }, { skill_id: 'id-figma' }];

  it('collects the catalogue ids the candidate already holds', () => {
    const owned = ownedSkillIds(HELD);
    expect(owned.has('id-python')).toBe(true);
    expect(owned.has('id-react')).toBe(true);
    expect(owned.has('id-figma')).toBe(true);
    expect(owned.has('id-aws')).toBe(false);
  });

  it('is empty for a brand-new account, so everything stays addable', () => {
    expect(ownedSkillIds([]).size).toBe(0);
  });

  it('tolerates a not-yet-loaded query result', () => {
    // react-query hands back `undefined` before it resolves and after it fails,
    // so the helper must not throw on the most common value it will see.
    expect(ownedSkillIds(undefined).size).toBe(0);
    expect(ownedSkillIds(null).size).toBe(0);
  });

  it('keys on skill_id, not the profile row id, so the two sides join', () => {
    // The catalogue item's `id` is the catalogue row; the profile row has its own
    // `id` plus `skill_id`. Matching the wrong one would let an already-held
    // skill be added a second time.
    const held = [{ id: 'row-1', skill_id: 'cat-1' } as { skill_id: string }];
    expect(ownedSkillIds(held).has('cat-1')).toBe(true);
    expect(ownedSkillIds(held).has('row-1')).toBe(false);
  });
});

describe('6. paging the browse list', () => {
  it('says how much of the catalogue is on screen', () => {
    expect(catalogCaption({ mode: 'browse', term: '', shown: 24, total: CATALOGUE_TOTAL })).toBe(
      'Showing 24 of 140 catalogue skills.',
    );
  });

  it('says when everything is on screen', () => {
    expect(catalogCaption({ mode: 'browse', term: '', shown: 140, total: CATALOGUE_TOTAL })).toBe(
      'All 140 catalogue skills.',
    );
  });

  it('labels the next page by what is actually left', () => {
    expect(showMoreLabel(24, CATALOGUE_TOTAL)).toBe('Show 116 more skills');
    expect(showMoreLabel(CATALOGUE_TOTAL, CATALOGUE_TOTAL)).toBe('Show 0 more skills');
    expect(showMoreLabel(CATALOGUE_TOTAL - 1, CATALOGUE_TOTAL)).toBe('Show 1 more skill');
  });

  it('never asks for more than are left', () => {
    expect(showMoreLabel(200, CATALOGUE_TOTAL)).toBe('Show 0 more skills');
  });
});