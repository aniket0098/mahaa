/**
 * Route-tree consistency tests.
 *
 * Vitest runs in Node, so the route directory is read straight off disk and
 * compared against the declared inventory. That is the point of these tests: a
 * screen that is added, renamed, or deleted cannot silently drift away from the
 * navigation that is supposed to reach it.
 *
 * The checks are the failure modes that matter for a route file:
 *   - a tab or detail route with no screen behind it (a dead navigation item);
 *   - a screen file the inventory does not describe (an unreachable screen);
 *   - a file in the wrong group directory (a candidate screen in the employer
 *     tree, or an employer route reachable from the candidate bar).
 */

import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_DETAIL_ROUTES,
  CANDIDATE_TABS,
  EMPLOYER_DETAIL_ROUTES,
  EMPLOYER_TABS,
  PUBLIC_ROUTES,
  detailRoutesForRole,
  detailScreensForRole,
  tabsForRole,
} from '@/config/navConfig';

const APP_DIR = fileURLToPath(new URL('../app', import.meta.url));

/**
 * Resolves a declared URL path to the file that implements it.
 *
 * expo-router strips a route-group directory from the URL but keeps every other
 * segment, and the employer tree deliberately keeps a literal `employer/`
 * directory inside its group so its URLs stay namespaced. The two rules together
 * mean a declared path maps to the file of the same relative path inside the
 * group that owns it:
 *
 *   `/home`            -> app/(candidate)/home.tsx
 *   `/employer/home`   -> app/(employer)/employer/home.tsx
 *
 * This used to strip the `employer` prefix and look for
 * `app/(employer)/home.tsx`, which is served at `/home` and therefore collides
 * with the candidate home. That mapping made the test agree with itself while
 * the app showed "Unmatched Route" for every `/employer/*` push, so the test
 * passed and the employer tree was unreachable. Resolution now goes through the
 * directory that actually produces the URL.
 */
const GROUPS = ['(candidate)', '(employer)'] as const;

/**
 * The URL path a file inside a group directory is served at.
 *
 * The group contributes nothing (a route group is transparent in the URL) and
 * every other directory level is kept, so the relative path is the whole answer.
 */
function routePathFor(relative: string): string {
  return `/${relative}`;
}

/** The file that serves a declared path, or null when nothing does. */
function fileForPath(path: string): string | null {
  const relative = path.replace(/^\//, '');
  // Only the group that owns the path may serve it. A candidate path is never
  // allowed to resolve inside `(employer)`, and vice versa.
  const groups: (typeof GROUPS)[number][] = relative.startsWith('employer/')
    ? ['(employer)']
    : ['(candidate)'];
  for (const group of groups) {
    const direct = `${APP_DIR}/${group}/${relative}.tsx`;
    if (existsSync(direct)) return direct;
  }
  return null;
}

describe('public routes', () => {
  it('has a real screen behind every public route', () => {
    for (const route of PUBLIC_ROUTES) {
      const path = route === '/' ? '/index' : route;
      expect(existsSync(`${APP_DIR}${path}.tsx`), `missing public route ${route}`).toBe(true);
    }
  });
});

describe('authenticated routes', () => {
  it('has a real screen behind every tab', () => {
    for (const tab of [...CANDIDATE_TABS, ...EMPLOYER_TABS]) {
      expect(fileForPath(tab.path), `missing tab screen ${tab.path}`).not.toBeNull();
    }
  });

  it('has a real screen behind every detail route', () => {
    for (const route of [...CANDIDATE_DETAIL_ROUTES, ...EMPLOYER_DETAIL_ROUTES]) {
      expect(fileForPath(route.path), `missing detail screen ${route.path}`).not.toBeNull();
    }
  });

  it('keeps each role’s files inside that role’s own group directory', () => {
    for (const role of ['candidate', 'employer'] as const) {
      for (const route of [...tabsForRole(role), ...detailRoutesForRole(role)]) {
        if (role === 'candidate') {
          expect(route.path.startsWith('/employer'), `${route.path} is employer-only`).toBe(false);
        } else {
          expect(route.path.startsWith('/employer/'), `${route.path} must be namespaced`).toBe(
            true,
          );
        }
      }
    }
  });

  it('declares each tab path exactly once across both roles', () => {
    const paths = [...CANDIDATE_TABS, ...EMPLOYER_TABS].map((tab) => tab.path);
    for (const path of paths) {
      expect(paths.filter((entry) => entry === path).length).toBe(1);
    }
  });
});

describe('route files on disk', () => {
  it('has no screen file the inventory does not describe', () => {
    const declared = new Set<string>([
      ...PUBLIC_ROUTES,
      ...CANDIDATE_TABS.map((tab) => tab.path),
      ...EMPLOYER_TABS.map((tab) => tab.path),
      ...CANDIDATE_DETAIL_ROUTES.map((route) => route.path),
      ...EMPLOYER_DETAIL_ROUTES.map((route) => route.path),
    ]);

    for (const group of GROUPS) {
      for (const file of walk(`${APP_DIR}/${group}`)) {
        if (file.endsWith('_layout.tsx')) continue;
        const relative = file
          .slice(`${APP_DIR}/${group}/`.length)
          .replace(/\\/g, '/')
          .replace(/\.tsx$/, '');
        const route = routePathFor(relative);
        expect(declared.has(route), `undeclared screen: ${group}/${relative}`).toBe(true);

        // A screen must also sit in the group that owns its route. Without this,
        // `app/(employer)/home.tsx` resolves to `/home` — a route the candidate
        // inventory already declares — so the screen looked declared while
        // shadowing the candidate home and leaving `/employer/home` unserved.
        const ownedByEmployer = route.startsWith('/employer/');
        expect(
          ownedByEmployer,
          `${group}/${relative} is served at ${route}, which does not belong to the ${group} tree`,
        ).toBe(group === '(employer)');
      }
    }
  });

  it('resolves every declared path to a file inside the right group directory', () => {
    // The employer tree keeps a literal `employer/` segment in its URLs, so a
    // path can only be served by the group that owns that prefix. This is what
    // makes "candidate and employer never mix" a property of the file tree.
    for (const route of [...CANDIDATE_TABS, ...CANDIDATE_DETAIL_ROUTES]) {
      expect(fileForPath(route.path), route.path).toContain('(candidate)');
    }
    for (const route of [...EMPLOYER_TABS, ...EMPLOYER_DETAIL_ROUTES]) {
      expect(fileForPath(route.path), route.path).toContain('(employer)');
    }
  });
});

describe('role guard wiring in the authenticated shells', () => {
  const SHELLS = ['(candidate)', '(employer)'] as const;

  /**
   * The shells decide what happens before a screen renders, so the redirect the
   * guard computes has to actually be performed. Returning `null` for
   * `unauthenticated`/`wrong-role` renders a blank screen forever: a cold start
   * on a protected deep link, or a stale link across the role boundary, strands
   * the user on an empty view with no way out. The guard returns a `redirect`
   * precisely so the shell can follow it.
   */
  for (const shell of SHELLS) {
    it(`${shell} redirects instead of rendering nothing when the session is unresolved`, () => {
      const source = readFileSync(`${APP_DIR}/${shell}/_layout.tsx`, 'utf8');

      expect(source).toContain("guard.kind === 'unauthenticated'");
      expect(source).toContain("guard.kind === 'wrong-role'");
      // A redirect must be rendered for both blocking states...
      expect(source).toContain('<Redirect href={guard.redirect} />');
      // ...and neither of them may fall through to a bare `return null`.
      expect(source).not.toMatch(/guard\.kind === '(unauthenticated|wrong-role)'\) return null/);
    });
  }
});

describe('stage screens', () => {
  /**
   * `StageScreen` is shared by both role trees, so its "Back" action has to
   * follow the signed-in role. Hardcoding the candidate `/home` makes an
   * employer leave their own tree on a route the guard forbids them, which
   * bounces straight back and leaves the foreign route in their back stack.
   * The resolution now lives in the shared `BackButton`, so that is what is
   * asserted here.
   */
  it('resolves the stage screen back action from the role, not a fixed path', () => {
    const back = readFileSync(
      fileURLToPath(new URL('../components/ui/BackButton.tsx', import.meta.url)),
      'utf8',
    );
    expect(back).toContain('homePathForRole(principal?.role');

    const stage = readFileSync(
      fileURLToPath(new URL('../features/stages/StageScreen.tsx', import.meta.url)),
      'utf8',
    );
    // The control is delegated, not re-implemented, so the role logic cannot
    // drift back into a per-screen hardcoded path.
    expect(stage).toContain('<BackButton />');
    expect(stage).not.toMatch(/router\.(push|replace)\(\s*'\/home/);
  });

  /**
   * A stage screen with no way out is a dead end. It is reachable by a deep
   * link or by a push from a tab, it renders no header (both shells set
   * `headerShown: false`), and a tab bar offers no edge-swipe — so on iOS the
   * user is stranded. The back control is therefore unconditional: the old
   * `backToHome={false}` escape hatch is exactly what stranded `/notifications`.
   */
  it('always renders a back control, so a stage screen is never a dead end', () => {
    const stage = readFileSync(
      fileURLToPath(new URL('../features/stages/StageScreen.tsx', import.meta.url)),
      'utf8',
    );
    expect(stage).toContain('<BackButton />');
    // The opt-out is gone; a caller passing it would get no back control.
    expect(stage).not.toMatch(/\{\s*backToHome\s*\?\s*\(?\s*<Button/);

    // No stage screen may opt out.
    for (const group of GROUPS) {
      for (const file of walk(`${APP_DIR}/${group}`)) {
        const source = readFileSync(file, 'utf8');
        if (!source.includes('StageScreen')) continue;
        expect(source, `${file} must not disable the back control`).not.toMatch(
          /backToHome=\{false\}/,
        );
      }
    }
  });
});

/**
 * expo-router's `Tabs` injects **every** route it discovers under a Tabs layout
 * into the tab navigator — `useOnlyUserDefinedScreens` is false for `Tabs` — and
 * the only way to keep a screen out of the bar is to declare it with
 * `href: null`. Left implicit, every detail screen silently became a tab item:
 * twelve entries in the candidate bar and eleven in the employer bar, against a
 * documented maximum of five. These tests fail if a detail route is ever added
 * without the matching `href: null` declaration.
 */
describe('tab bar contents', () => {
  for (const role of ['candidate', 'employer'] as const) {
    const shell = `${APP_DIR}/${role === 'candidate' ? '(candidate)' : '(employer)'}/_layout.tsx`;

    it(`${role}: keeps the tab bar at five items`, () => {
      expect(tabsForRole(role)).toHaveLength(5);
    });

    it(`${role}: declares every tab and hides every detail route from the bar`, () => {
      const source = readFileSync(shell, 'utf8');

      // Tabs are rendered by mapping over the inventory, so the bar can never
      // drift from the declared tab set.
      expect(source).toContain(role === 'candidate' ? 'CANDIDATE_TABS' : 'EMPLOYER_TABS');
      expect(source).toMatch(/\.map\(\(tab\) =>[\s\S]*?<Tabs\.Screen/);

      // And each tab must be named by the route expo-router actually has.
      // `name={tab.name}` declares a screen the employer tree does not contain
      // (`home` instead of `employer/home`), which unregisters the whole bar.
      expect(
        source,
        `${shell} must name its tabs by route name, not the short logical name`,
      ).toContain('name={screenNameForPath(tab.path)}');
      expect(source, `${shell} must not name a tab by its logical name`).not.toContain(
        'name={tab.name}',
      );

      // Detail routes come from the same inventory, each declared `href: null`.
      expect(source).toContain(`detailScreensForRole('${role}')`);
      expect(source).toContain('options={{ href: null }}');

      // And the two sets are disjoint, so nothing is both a tab and hidden.
      const tabNames = tabsForRole(role).map((tab) => tab.name);
      for (const detail of detailScreensForRole(role)) {
        expect(tabNames, `${detail.name} is declared twice`).not.toContain(detail.name);
      }
    });
  }
});

describe('detail route back navigation', () => {
  /**
   * The shells render no header, so a detail screen is only escapable through
   * the in-app back control. Every detail screen that renders its own `Screen`
   * must therefore include one — either directly or through a shared shell
   * (`SectionEditor`, `StageScreen`).
   */
  const SHARED_SHELLS = [
    "from '@/features/stages/StageScreen'",
    "from '@/features/profile/SectionEditor'",
  ];

  for (const role of ['candidate', 'employer'] as const) {
    it(`${role}: every detail screen offers a way back`, () => {
      // The declared path is the source of truth; `detailScreensForRole` only
      // renames it for `<Tabs.Screen>`, so the URL is read from the inventory
      // rather than rebuilt from a screen name (rebuilding it re-introduced the
      // double `employer/employer/` prefix the router cannot resolve).
      for (const route of detailRoutesForRole(role)) {
        const file = fileForPath(route.path);
        expect(file, `${route.path} has no screen file`).not.toBeNull();

        const source = readFileSync(file as string, 'utf8');
        const viaSharedShell = SHARED_SHELLS.some((shell) => source.includes(shell));
        const hasBackControl = source.includes('<BackButton />') || viaSharedShell;

        expect(
          hasBackControl,
          `${route.path} is a detail route with no header and no back control`,
        ).toBe(true);
      }
    });
  }
});

describe('cross-role navigation', () => {
  /**
   * Every screen that renders a role-guarded tree must not send the user to the
   * other role's dashboard through any hardcoded push.
   */
  it('never hardcodes a push into the employer tree from the candidate tree', () => {
    for (const file of walk(`${APP_DIR}/(candidate)`)) {
      if (file.endsWith('_layout.tsx')) continue;
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} must not push into the employer tree`).not.toMatch(
        /router\.(push|replace)\(\s*'\/employer/,
      );
    }
  });

  it('never hardcodes a push into the candidate tree from the employer tree', () => {
    for (const file of walk(`${APP_DIR}/(employer)`)) {
      if (file.endsWith('_layout.tsx')) continue;
      const source = readFileSync(file, 'utf8');
      // `/employer/...` is this tree's own namespace and is always allowed.
      expect(source, `${file} must not push into the candidate tree`).not.toMatch(
        /router\.(push|replace)\(\s*'\/(?!employer|login|signup|reset-password)[a-z]/,
      );
    }
  });
});

/** Recursively lists every `.tsx` file under a directory. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}