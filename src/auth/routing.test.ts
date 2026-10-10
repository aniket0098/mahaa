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
  COLLEGE_HOME_ROUTE,
  EMPLOYER_HOME_ROUTE,
  ONBOARDING_ROUTE,
  entryPathForRole,
  homePathForRole,
  isCandidateRole,
  isCollegeRole,
  isEmployerRole,
  isRouteAllowedForRole,
} from '@/auth/roleHome';
import {
  APP_TAB_NAMES,
  CANDIDATE_DETAIL_ROUTES,
  CANDIDATE_TABS,
  COLLEGE_TABS,
  tabsForRole,
} from '@/config/navConfig';

describe('entryPathForRole — onboarding comes before home', () => {
  /**
   * These are the tests for the bug this project started with: a new account used
   * to be sent straight to its dashboard, skipping onboarding entirely. The rule is
   * that home is reachable only when the server says onboarding is complete.
   */
  const roles = ['candidate', 'employer', 'college'] as const;

  for (const role of roles) {
    it(`sends a new ${role} to the wizard, not to home`, () => {
      // `not_started` is what the server reports for an account with no data yet.
      expect(entryPathForRole(role, { state: 'not_started' })).toBe(ONBOARDING_ROUTE);
    });

    it(`keeps a part-finished ${role} in the wizard`, () => {
      // Mid-flow is the case that matters most on a relaunch: the person quit,
      // came back, and must not be dropped onto a dashboard built from a
      // half-written profile.
      expect(entryPathForRole(role, { state: 'in_progress' })).toBe(ONBOARDING_ROUTE);
    });

    it(`sends a finished ${role} to their own home`, () => {
      expect(entryPathForRole(role, { state: 'completed' })).toBe(homePathForRole(role));
    });
  }

  it('never sends anybody to a home before the server says complete', () => {
    // The negative case, spelled out for all three states. If any of these
    // regressed to a home path, the original bug would be back.
    for (const role of roles) {
      for (const state of ['not_started', 'in_progress']) {
        expect(entryPathForRole(role, { state })).not.toBe(homePathForRole(role));
      }
    }
  });

  it('holds the wizard when the server state is missing or unknown', () => {
    // A missing answer must NOT be read as "finished". This is the assertion that
    // would have caught the original bug's inverse: the earlier implementation
    // required a truthy `onboarding` object before checking the state, so a failed
    // state call or a caller that passed nothing landed somebody on their
    // dashboard. Only the literal string 'completed' may unlock home.
    expect(entryPathForRole('candidate', null)).toBe(ONBOARDING_ROUTE);
    expect(entryPathForRole('candidate', undefined)).toBe(ONBOARDING_ROUTE);
    expect(entryPathForRole('candidate', {})).toBe(ONBOARDING_ROUTE);
    // A state the server has never issued is likewise not "completed".
    expect(entryPathForRole('candidate', { state: 'something_new' })).toBe(ONBOARDING_ROUTE);
    // And the same for every other role, not just the candidate.
    for (const role of roles) {
      expect(entryPathForRole(role, undefined), role).toBe(ONBOARDING_ROUTE);
    }
  });

  it('never holds admin, which has no onboarding surface', () => {
    // Admin is never self-registered and has nothing to be incomplete about, so
    // sending it to a wizard would be a dead end.
    expect(entryPathForRole('admin', { state: 'not_started' })).toBe(EMPLOYER_HOME_ROUTE);
  });
});

describe('homePathForRole', () => {
  it('sends each role into its own tree', () => {
    expect(homePathForRole('candidate')).toBe(CANDIDATE_HOME_ROUTE);
    expect(homePathForRole('employer')).toBe(EMPLOYER_HOME_ROUTE);
    expect(homePathForRole('college')).toBe(COLLEGE_HOME_ROUTE);
  });

  it('gives the three roles different entry points', () => {
    // A shared entry route would be a bug rather than a simplification: it would
    // let one role land inside the other's navigation.
    const paths = [homePathForRole('candidate'), homePathForRole('employer'), homePathForRole('college')];
    expect(new Set(paths).size).toBe(3);
  });

  it('sends admin to the employer tree, where every call stays server-guarded', () => {
    expect(homePathForRole('admin')).toBe(EMPLOYER_HOME_ROUTE);
  });

  it('points each entry at a real tab in that role’s own tab set', () => {
    for (const role of ['candidate', 'employer', 'college'] as const) {
      expect(tabsForRole(role).map((tab) => tab.path)).toContain(homePathForRole(role));
    }
  });
});

describe('role predicates', () => {
  it('separates the candidate, employer, and college shells', () => {
    expect(isCandidateRole('candidate')).toBe(true);
    expect(isCandidateRole('employer')).toBe(false);
    expect(isCandidateRole('college')).toBe(false);
    expect(isEmployerRole('employer')).toBe(true);
    expect(isEmployerRole('candidate')).toBe(false);
    // A college is neither: conflating it with "any non-candidate" is what made
    // the college tree reachable by employers in the first draft of the guard.
    expect(isEmployerRole('college')).toBe(false);
    expect(isCollegeRole('college')).toBe(true);
    expect(isCollegeRole('employer')).toBe(false);
    expect(isCollegeRole('candidate')).toBe(false);
  });
});

describe('isRouteAllowedForRole', () => {
  it('keeps a candidate out of the employer tree on a deep link', () => {
    expect(isRouteAllowedForRole('/employer/company', 'candidate')).toBe(false);
    expect(isRouteAllowedForRole('/employer/home', 'candidate')).toBe(false);
  });

  it('keeps a candidate out of the college tree on a deep link', () => {
    expect(isRouteAllowedForRole('/college/home', 'candidate')).toBe(false);
    expect(isRouteAllowedForRole('/college/programs', 'candidate')).toBe(false);
  });

  it('keeps the college tree separate from the employer tree', () => {
    // Both are "non-candidate", so this is the boundary most likely to be missed.
    expect(isRouteAllowedForRole('/college/home', 'employer')).toBe(false);
    expect(isRouteAllowedForRole('/employer/company', 'college')).toBe(false);
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

  it('lets a college into the college tree', () => {
    for (const tab of COLLEGE_TABS) {
      expect(isRouteAllowedForRole(tab.path, 'college'), tab.path).toBe(true);
    }
  });
});

describe('tabsForRole', () => {
  it('never mixes candidate and employer navigation', () => {
    const candidate = tabsForRole('candidate');
    const employer = tabsForRole('employer');

    expect(candidate.map((tab) => tab.name)).toEqual([
      'home',
      'jobs',
      'messages',
      'learn',
      'profile',
    ]);
    expect(employer.map((tab) => tab.name)).toEqual([
      'home',
      'company',
      'jobs',
      'applicants',
      'more',
    ]);
    expect(tabsForRole('college').map((tab) => tab.name)).toEqual([
      'college/home',
      'college/institution',
      'college/programs',
      'college/more',
    ]);
  });

  it('gives no two roles a tab path in common', () => {
    // The three tab sets must describe three different destinations. A shared
    // path would mean one role's tab bar could push another role's screen.
    const paths = ['candidate', 'employer', 'college'] as const;
    for (const role of paths) {
      const mine = tabsForRole(role).map((tab) => tab.path);
      for (const other of paths) {
        if (other === role) continue;
        const theirs = tabsForRole(other).map((tab) => tab.path);
        expect(mine.filter((path) => theirs.includes(path)), `${role} vs ${other}`).toEqual([]);
      }
    }
  });

  it('keeps the college tree reachable by a college and nobody else', () => {
    for (const path of COLLEGE_TABS.map((tab) => tab.path)) {
      expect(isRouteAllowedForRole(path, 'college'), path).toBe(true);
      expect(isRouteAllowedForRole(path, 'candidate'), path).toBe(false);
      expect(isRouteAllowedForRole(path, 'employer'), path).toBe(false);
    }
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
    for (const role of ['candidate', 'employer', 'college'] as const) {
      expect(tabsForRole(role).length).toBeLessThanOrEqual(5);
    }
  });

  it('gives every tab a label, both platform icons, and a unique path', () => {
    for (const role of ['candidate', 'employer', 'college'] as const) {
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
    ).toEqual(['home', 'jobs', 'profile']);
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
    for (const role of ['candidate', 'employer', 'college'] as const) {
      for (const tab of tabsForRole(role)) {
        expect(names).toContain(tab.name);
      }
    }
    expect(new Set(names).size).toBe(names.length);
  });
});
