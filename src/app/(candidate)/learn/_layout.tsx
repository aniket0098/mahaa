/**
 * Learning Hub layout — the nested four-section navigator inside the
 * candidate tree.
 *
 * `/learn` used to be a single screen (the catalogue). It is now a nested
 * `Tabs` layout: the parent candidate navigator sees exactly one route
 * (`learn`) and never the hub's children, and this navigator owns its own
 * bottom bar ({@link LearningHubTabBar}) — which is why the main candidate bar
 * renders nothing while the hub is open (`CandidateTabBar`), so two bars can
 * never be stacked on screen.
 *
 * Transitions: sections cross-fade over 220 ms (`motion` band, 180–280 ms) and
 * collapse to an instant switch when the system asks for reduced motion. Tabs
 * stay lazy-mounted and retained, so a section keeps its scroll position and
 * state across switches, and `backBehavior="history"` makes Android Back walk
 * the sections the user actually visited before leaving the hub for the
 * candidate tab it was opened from.
 */

import { Tabs } from 'expo-router';
import { Easing } from 'react-native';

import { LearningHubTabBar } from '@/features/navigation/LearningHubTabBar';
import { LEARNING_HUB_TABS, learningHubScreenNameForPath } from '@/config/navConfig';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { colors } from '@/theme/tokens';

/** The section cross-fade, inside the required 180–280 ms band. */
export const HUB_SECTION_TRANSITION = {
  animation: 'timing' as const,
  config: { duration: 220, easing: Easing.out(Easing.cubic) },
};

export default function LearningHubLayout() {
  const reducedMotion = useReducedMotion();

  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <LearningHubTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        // The scene is pre-painted in the page colour, so switching sections
        // never flashes white or black while the destination mounts.
        sceneStyle: { backgroundColor: colors.colorBgPage },
        animation: reducedMotion ? 'none' : 'fade',
        transitionSpec: reducedMotion ? undefined : HUB_SECTION_TRANSITION,
      }}>
      {LEARNING_HUB_TABS
        // Only hub-internal routes (under /learn) are declared as nested tabs.
        // The Home tab (/home) exits the hub to the main candidate home page and
        // is handled externally in LearningHubTabBar, so it is not a Tabs.Screen.
        .filter((tab) => tab.path.startsWith('/learn'))
        .map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={learningHubScreenNameForPath(tab.path)}
            options={{
              title: tab.label,
              tabBarAccessibilityLabel: tab.label,
            }}
          />
        ))}
    </Tabs>
  );
}
