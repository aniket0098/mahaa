/**
 * College shell — the authenticated tab navigator for colleges.
 *
 * Structurally the same as the other two role trees, and separate for the same
 * reason: a college workspace is not a candidate workspace, and sharing a tab bar
 * would eventually leak one role's screen into another's. Routes are namespaced
 * under `/college/*` so a stale deep link is a wrong-role redirect rather than a
 * half-rendered screen.
 */

import { Redirect, Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { useRoleGuard } from '@/auth/RoleGuard';
import { COLLEGE_TABS, detailScreensForRole, screenNameForPath } from '@/config/navConfig';
import { colors, layout, typography } from '@/theme/tokens';

const TAB_BAR_PADDING_TOP = 6;

export default function CollegeLayout() {
  const guard = useRoleGuard({ allow: 'college' });
  const insets = useSafeAreaInsets();

  if (guard.kind === 'loading') return null;
  if (guard.kind !== 'ready') return <Redirect href={guard.redirect as never} />;

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.colorPrimary,
        tabBarInactiveTintColor: colors.colorTextTertiary,
        tabBarStyle: [styles.tabBar, { height: layout.bottomNavHeight + insets.bottom }],
        tabBarLabelStyle: styles.tabLabel,
        sceneStyle: { backgroundColor: colors.colorBgPage },
      }}>
      {COLLEGE_TABS.map((tab) => (
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

      {/* Hidden detail routes, declared with `href: null` so they stay navigable
          without each adding a tab-bar entry. */}
      {detailScreensForRole('college').map((route) => (
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