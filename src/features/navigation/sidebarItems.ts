/**
 * Sidebar navigation items — the single source of truth for the candidate drawer.
 *
 * Requirements:
 * 1. Home             -> /home
 * 2. Add Post         -> /add-post
 * 3. Learning         -> /learn (same destination as bottom tab Learn)
 * 4. Community        -> /community
 * 5. Innovation Lab   -> /innovation-lab
 * 6. Project Gallery  -> /profile/projects (reuses existing profile projects section)
 */

export interface SidebarItem {
  id: string;
  label: string;
  path: string;
  icon: { ios: string; android: string };
  badge?: string;
}

export const SIDEBAR_ITEMS: readonly SidebarItem[] = [
  {
    id: 'home',
    label: 'Home',
    path: '/home',
    icon: { ios: 'house.fill', android: 'home' },
  },
  {
    id: 'add-post',
    label: 'Add Post',
    path: '/add-post',
    icon: { ios: 'plus.circle.fill', android: 'add_circle' },
  },
  {
    id: 'learning',
    label: 'Learning',
    path: '/learn',
    icon: { ios: 'book.fill', android: 'school' },
  },
  {
    id: 'community',
    label: 'Community',
    path: '/community',
    icon: { ios: 'person.3.fill', android: 'groups' },
  },
  {
    id: 'innovation-lab',
    label: 'Innovation Lab',
    path: '/innovation-lab',
    icon: { ios: 'lightbulb.fill', android: 'lightbulb' },
  },
  {
    id: 'project-gallery',
    label: 'Project Gallery',
    path: '/profile/projects',
    icon: { ios: 'square.grid.2x2.fill', android: 'grid_view' },
  },
] as const;

/**
 * Checks if a given pathname matches the sidebar item's path.
 */
export function isSidebarItemActive(itemPath: string, currentPathname: string): boolean {
  if (itemPath === '/home') {
    return currentPathname === '/home' || currentPathname === '/';
  }
  return currentPathname === itemPath || currentPathname.startsWith(`${itemPath}/`);
}
