/**
 * Candidate shell — the authenticated tab navigator for candidates.
 *
 * The tabs come from `@/config/navConfig`, so the visible navigation and the
 * route inventory can never disagree (asserted in `routeTree.test.ts`).
 *
 * Candidate and employer are **separate route trees** (`(candidate)` and
 * `(employer)`), which is what keeps the two sets from mixing: there is no
 * shared tab bar to leak a foreign screen into, and a candidate deep-linking
 * into `/employer/*` is bounced by `useRoleGuard` before any screen renders.
 *
 * The tab bar is 64px, safe-area padded, and the active tab is signalled by the
 * filled icon plus a semibold label — never by colour alone.
 */

import { Redirect, Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { useRoleGuard } from '@/auth/RoleGuard';
import { CANDIDATE_TABS, detailScreensForRole } from '@/config/navConfig';
import { colors, layout, typography } from '@/theme/tokens';

const TAB_BAR_PADDING_TOP = 6;

export default function CandidateLayout() {
  const guard = useRoleGuard({ allow: 'candidate' });
  const insets = useSafeAreaInsets();

  if (guard.kind === 'loading') return null;
  if (guard.kind === 'unauthenticated') return <Redirect href={guard.redirect} />;
  if (guard.kind === 'wrong-role') return <Redirect href={guard.redirect} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.colorPrimary,
        tabBarInactiveTintColor: colors.colorTextTertiary,
        tabBarStyle: [styles.tabBar, { height: layout.bottomNavHeight + insets.bottom }],
        tabBarLabelStyle: styles.tabLabel,
        sceneStyle: { backgroundColor: colors.colorBgPage },
      }}>
      {CANDIDATE_TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.label,
            tabBarAccessibilityLabel: tab.label,
            tabBarIcon: ({ color }) => (
              <AppIcon
                name={tab.icon}
                size={24}
                color={typeof color === 'string' ? color : colors.colorTextSecondary}
              />
            ),
          }}
        />
      ))}

      {/*
        expo-router injects EVERY route it discovers under a `Tabs` layout into
        the tab navigator, and `href: null` is the only way to keep one out of
        the bar. Declared implicitly, the seven detail screens below (settings,
        notifications, the four profile sections, and jobs/[id]) would each add
        a tab item and the bar would carry twelve entries instead of the
        documented five. They stay navigable — `href: null` hides the button, it
        does not unregister the route.
      */}
      {detailScreensForRole('candidate').map((route) => (
        <Tabs.Screen key={`detail:${route.name}`} name={route.name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.colorBgSurface,
    borderTopColor: colors.colorBorder,
    paddingTop: TAB_BAR_PADDING_TOP,
  },
  tabLabel: {
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightSemibold,
  },
});