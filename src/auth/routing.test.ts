/**
 * Role resolution tests.
 *
 * The two shells are separate route trees (`(candidate)` and `(employer)`), so
 * "where does this role land?" and "may this role open that path?" are the two
 * questions that keep the shells from bleeding into each other.
 */

import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_HOME_ROUTE,
  EMPLOYER_HOME_ROUTE,
  homePathForRole,
  isCandidateRole,
  isEmployerRole,
  isRouteAllowedForRole,
} from '@/auth/roleHome';
import {
  APP_TAB_NAMES,
  CANDIDATE_DETAIL_ROUTES,
  CANDIDATE_TABS,
  EMPLOYER_TABS,
  tabsForRole,
} from '@/config/navConfig';

describe('homePathForRole', () => {
  it('sends each role into its own tree', () => {
    expect(homePathForRole('candidate')).toBe(CANDIDATE_HOME_ROUTE);
    expect(homePathForRole('employer')).toBe(EMPLOYER_HOME_ROUTE);
  });

  it('gives the two roles different entry points', () => {
    // A shared entry route would be a bug rather than a simplification: it would
    // let one role land inside the other's navigation.
    expect(homePathForRole('candidate')).not.toBe(homePathForRole('employer'));
  });

  it('sends admin to the employer tree, where every call stays server-guarded', () => {
    expect(homePathForRole('admin')).toBe(EMPLOYER_HOME_ROUTE);
  });

  it('points each entry at a real tab in that role’s own tab set', () => {
    for (const role of ['candidate', 'employer'] as const) {
      expect(tabsForRole(role).map((tab) => tab.path)).toContain(homePathForRole(role));
    }
  });
});

describe('role predicates', () => {
  it('separates the candidate shell from the employer shell', () => {
    expect(isCandidateRole('candidate')).toBe(true);
    expect(isCandidateRole('employer')).toBe(false);
    expect(isEmployerRole('employer')).toBe(true);
    expect(isEmployerRole('candidate')).toBe(false);
  });
});

describe('isRouteAllowedForRole', () => {
  it('keeps a candidate out of the employer tree on a deep link', () => {
    expect(isRouteAllowedForRole('/employer/company', 'candidate')).toBe(false);
    expect(isRouteAllowedForRole('/employer/home', 'candidate')).toBe(false);
  });

  it('keeps a candidate inside their own screens', () => {
    for (const tab of CANDIDATE_TABS) {
      expect(isRouteAllowedForRole(tab.path, 'candidate')).toBe(true);
    }
    for (const route of CANDIDATE_DETAIL_ROUTES) {
      expect(isRouteAllowedForRole(route.path, 'candidate')).toBe(true);
    }
  });

  it('lets an employer into the employer tree', () => {
    expect(isRouteAllowedForRole('/employer/company', 'employer')).toBe(true);
  });
});

describe('tabsForRole', () => {
  it('never mixes candidate and employer navigation', () => {
    const candidate = tabsForRole('candidate');
    const employer = tabsForRole('employer');

    expect(candidate.map((tab) => tab.name)).toEqual([
      'home',
      'jobs',
      'applications',
      'saved',
      'profile',
    ]);
    expect(employer.map((tab) => tab.name)).toEqual([
      'home',
      'company',
      'jobs',
      'applicants',
      'more',
    ]);
  });

  it('resolves every tab to a path only that role can open', () => {
    // `home` and `jobs` are shared as tab *names* because each navigator holds
    // its own screen. What must not be shared is the path they resolve to —
    // otherwise the two tab bars would be describing the same destinations.
    const candidate = tabsForRole('candidate').map((tab) => tab.path);
    const employer = tabsForRole('employer').map((tab) => tab.path);
    expect(candidate.filter((path) => employer.includes(path))).toEqual([]);

    for (const path of employer) {
      expect(isRouteAllowedForRole(path, 'candidate'), `${path} must be employer-only`).toBe(false);
    }
  });

  it('keeps to the documented five-tab maximum', () => {
    for (const role of ['candidate', 'employer'] as const) {
      expect(tabsForRole(role).length).toBeLessThanOrEqual(5);
    }
  });

  it('gives every tab a label, both platform icons, and a unique path', () => {
    for (const role of ['candidate', 'employer'] as const) {
      const tabs = tabsForRole(role);
      const paths = tabs.map((tab) => tab.path);
      expect(new Set(paths).size).toBe(paths.length);
      for (const tab of tabs) {
        expect(tab.label.length).toBeGreaterThan(0);
        expect(tab.icon.ios.length).toBeGreaterThan(0);
        expect(tab.icon.android.length).toBeGreaterThan(0);
        expect(tab.path.startsWith('/')).toBe(true);
      }
    }
  });

  it('only marks screens backed by a real endpoint as implemented', () => {
    expect(
      tabsForRole('candidate')
        .filter((tab) => tab.implemented)
        .map((tab) => tab.name),
    ).toEqual(['home', 'profile']);
    expect(
      tabsForRole('employer')
        .filter((tab) => tab.implemented)
        .map((tab) => tab.name),
    ).toEqual(['home', 'company', 'more']);
  });
});

describe('APP_TAB_NAMES', () => {
  it('contains both role shells and no duplicate names', () => {
    const names = [...APP_TAB_NAMES];
    for (const role of ['candidate', 'employer'] as const) {
      for (const tab of tabsForRole(role)) {
        expect(names).toContain(tab.name);
      }
    }
    expect(new Set(names).size).toBe(names.length);
  });
});
