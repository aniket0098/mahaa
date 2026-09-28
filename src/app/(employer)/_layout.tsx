/**
 * Employer shell — the authenticated tab navigator for employers.
 *
 * Structurally identical to the candidate shell but a separate tree, so the two
 * tab sets can never be mixed on one bar. Routes are namespaced under
 * `/employer/*` for the same reason: a stale deep link into the candidate tree
 * is a wrong-role redirect, not a half-rendered employer screen.
 */

import { Redirect, Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { useRoleGuard } from '@/auth/RoleGuard';
import { EMPLOYER_TABS, detailScreensForRole, screenNameForPath } from '@/config/navConfig';
import { colors, layout, typography } from '@/theme/tokens';

const TAB_BAR_PADDING_TOP = 6;

export default function EmployerLayout() {
  const guard = useRoleGuard({ allow: 'employer' });
  const insets = useSafeAreaInsets();

  if (guard.kind === 'loading') return null;
  // `needs-onboarding` lands here too: the wizard is outside this tree, so a user
  // who has not finished it is bounced out rather than shown an employer dashboard
  // built from a company record that does not exist yet.
  if (guard.kind !== 'ready') return <Redirect href={guard.redirect as never} />;

  return (
    <Tabs
      /*
       * Same reasoning as the candidate shell: a hidden detail route is a tab in
       * this navigator, so `history` keeps Back pointing at the tab the user came
       * from instead of bouncing to the first route.
       */
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.colorPrimary,
        tabBarInactiveTintColor: colors.colorTextTertiary,
        tabBarStyle: [styles.tabBar, { height: layout.bottomNavHeight + insets.bottom }],
        tabBarLabelStyle: styles.tabLabel,
        sceneStyle: { backgroundColor: colors.colorBgPage },
      }}>
      {/*
        The screen name is the route path relative to this layout, so an employer
        tab is `employer/home`, not `home`. `<Tabs.Screen name="home">` names a
        route that does not exist in this tree, which is how the whole employer
        tab bar ended up unregistered.
      */}
      {EMPLOYER_TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={screenNameForPath(tab.path)}
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
        the bar. Declared implicitly, the six detail screens below (jobs/new,
        jobs/[id], applicants/[id], messages, notifications, and settings) would
        each add a tab item and the bar would carry eleven entries instead of the
        documented five. They stay navigable — `href: null` hides the button, it
        does not unregister the route.
      */}
      {detailScreensForRole('employer').map((route) => (
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