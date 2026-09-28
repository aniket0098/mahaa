import { describe, expect, it } from 'vitest';

import { CANDIDATE_TABS } from '@/config/navConfig';
import { isSidebarItemActive, SIDEBAR_ITEMS } from './sidebarItems';

describe('sidebarItems', () => {
  it('defines exactly the 6 required menu items in the specified order', () => {
    expect(SIDEBAR_ITEMS.map((item) => item.label)).toEqual([
      'Home',
      'Add Post',
      'Learning',
      'Community',
      'Innovation Lab',
      'Project Gallery',
    ]);
  });

  it('routes each sidebar item to the correct destination', () => {
    expect(SIDEBAR_ITEMS.map((item) => item.path)).toEqual([
      '/home',
      '/add-post',
      '/learn',
      '/community',
      '/innovation-lab',
      '/profile/projects',
    ]);
  });

  it('guarantees that Learning in sidebar and Learn in bottom tabs lead to the exact same route', () => {
    const sidebarLearning = SIDEBAR_ITEMS.find((item) => item.id === 'learning');
    const bottomTabLearn = CANDIDATE_TABS.find((tab) => tab.name === 'learn');

    expect(sidebarLearning?.path).toBe('/learn');
    expect(bottomTabLearn?.path).toBe('/learn');
    expect(sidebarLearning?.path).toEqual(bottomTabLearn?.path);
  });

  it('correctly determines active state based on current pathname', () => {
    expect(isSidebarItemActive('/home', '/home')).toBe(true);
    expect(isSidebarItemActive('/home', '/')).toBe(true);
    expect(isSidebarItemActive('/home', '/jobs')).toBe(false);

    expect(isSidebarItemActive('/learn', '/learn')).toBe(true);
    expect(isSidebarItemActive('/learn', '/profile')).toBe(false);

    expect(isSidebarItemActive('/profile/projects', '/profile/projects')).toBe(true);
    expect(isSidebarItemActive('/profile/projects', '/profile/skills')).toBe(false);
  });
});
