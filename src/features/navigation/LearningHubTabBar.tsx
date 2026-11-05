/**
 * Learning Hub internal bottom bar — exactly four destinations.
 *
 * Same visual language as the main candidate bar (3px top indicator, soft
 * primary pill, dual-state icons, labels always visible) so the hub reads as
 * one product, but it is its own navigator's bar: it lives in **normal flow**
 * (never `position: 'absolute'`), so it can never be stacked beneath the main
 * bar — and `CandidateTabBar` renders nothing while the hub is open, which is
 * what keeps the two bars from ever appearing together.
 *
 * The active indicator slides between destinations with a 200 ms
 * (`motion.durationNormal`) native-driver timing, collapsed to an instant jump
 * when the system asks for reduced motion.
 */

import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { type Tabs, useRouter } from 'expo-router';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { LEARNING_HUB_TABS, type TabDefinition } from '@/config/navConfig';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { colors, layout, motion, radius, typography } from '@/theme/tokens';

export type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const INDICATOR_HEIGHT = 3;

export function LearningHubTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const router = useRouter();

  const currentRouteName = state.routes[state.index]?.name;
  const [rowWidth, setRowWidth] = useState(0);

  const tabWidth = LEARNING_HUB_TABS.length > 0 ? rowWidth / LEARNING_HUB_TABS.length : 0;
  const activeIndex = LEARNING_HUB_TABS.findIndex((tab) => tab.name === currentRouteName);
  const [translateX] = useState(() => new Animated.Value(0));
  const positionedOnce = useRef(false);

  useEffect(() => {
    if (tabWidth <= 0) return;
    const toValue = Math.max(activeIndex, 0) * tabWidth;
    // The first layout is a jump, not a slide: the indicator has no distance
    // to travel yet, only a position to take up.
    if (!positionedOnce.current) {
      positionedOnce.current = true;
      translateX.setValue(toValue);
      return;
    }
    Animated.timing(translateX, {
      toValue,
      duration: reducedMotion ? 0 : motion.durationNormal,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [tabWidth, activeIndex, reducedMotion, translateX]);

  return (
    <View
      style={[
        styles.barContainer,
        { height: layout.bottomNavHeight + insets.bottom, paddingBottom: insets.bottom },
      ]}>
      <View style={styles.tabRow} onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
        {tabWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[styles.indicator, { width: tabWidth, transform: [{ translateX }] }]}
          />
        )}

        {LEARNING_HUB_TABS.map((tab: TabDefinition) => {
          const isFocused = currentRouteName === tab.name;
          const routeIndex = state.routes.findIndex((route) => route.name === tab.name);
          const route = state.routes[routeIndex];

          const onPress = () => {
            // Home exits the hub to the main candidate home page.
            if (tab.path === '/home') {
              router.push('/home');
              return;
            }
            if (!route) {
              navigation.navigate(tab.name as never);
              return;
            }
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            if (route) {
              navigation.emit({ type: 'tabLongPress', target: route.key });
            }
          };

          const iconToRender = isFocused ? tab.icon : (tab.iconOutline ?? tab.icon);
          const iconColor = isFocused ? colors.colorPrimary : colors.colorTextTertiary;

          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={tab.label}
              testID={`hub-tab-${tab.name}`}
              onPress={onPress}
              onLongPress={onLongPress}
              style={({ pressed }) => [styles.tabButton, pressed && styles.tabPressed]}>
              <View style={styles.indicatorSpacer} />
              <View style={styles.tabContent}>
                <View style={[styles.pill, isFocused && styles.pillActive]}>
                  <AppIcon name={iconToRender} size={22} color={iconColor} />
                </View>
                <AppText
                  variant="caption"
                  style={[
                    styles.tabLabel,
                    { color: isFocused ? colors.colorPrimary : colors.colorTextTertiary },
                  ]}
                  weight={isFocused ? 'semibold' : 'medium'}
                  numberOfLines={1}>
                  {tab.label}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  barContainer: {
    backgroundColor: colors.colorBgSurface,
    borderTopColor: colors.colorBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    // Normal flow, never absolute: the hub's own bar owns the bottom of the
    // screen, so content can never slide beneath it and it can never stack
    // under the main bar.
    position: 'relative',
  },
  tabRow: {
    flex: 1,
    flexDirection: 'row',
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    height: INDICATOR_HEIGHT,
    backgroundColor: colors.colorPrimary,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    minHeight: layout.touchTargetPrimary,
  },
  tabPressed: {
    opacity: 0.6,
  },
  // Reserves the indicator's 3px lane so labels never shift when the
  // animated indicator arrives above them.
  indicatorSpacer: {
    width: 24,
    height: INDICATOR_HEIGHT,
    backgroundColor: 'transparent',
  },
  tabContent: {
    alignItems: 'center',
    paddingTop: 4,
    gap: 2,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: colors.colorPrimarySubtle,
  },
  tabLabel: {
    textAlign: 'center',
    fontSize: typography.fontSizeCaption,
  },
});
