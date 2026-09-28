/**
 * Candidate custom bottom tab bar.
 *
 * Implements the approved polished bottom navigation design:
 * - Exactly five tabs (Home, Jobs, Messages, Learn, Profile)
 * - 3px top active indicator bar on the focused tab
 * - Soft primary-blue pill highlight behind the focused tab's icon
 * - Dual-state icons (filled when active, outlined when inactive)
 * - Safe area handling for iOS home bar and Android gesture pill
 * - High-contrast accessible touch targets (>= 48px)
 */

import { type ComponentProps } from 'react';
import { type Tabs } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { CANDIDATE_TABS, screenNameForPath, type TabDefinition } from '@/config/navConfig';
import { colors, layout, radius, typography } from '@/theme/tokens';

export type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export function CandidateTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  // Find the active route name
  const currentRouteName = state.routes[state.index]?.name;

  return (
    <View
      style={[
        styles.barContainer,
        {
          height: layout.bottomNavHeight + insets.bottom,
          paddingBottom: insets.bottom,
        },
      ]}>
      <View style={styles.tabRow}>
        {CANDIDATE_TABS.map((tab: TabDefinition) => {
          const tabRouteName = screenNameForPath(tab.path);
          const isFocused = currentRouteName === tabRouteName;

          // Find the route in navigation state to handle navigation events properly
          const routeIndex = state.routes.findIndex((r) => r.name === tabRouteName);
          const route = state.routes[routeIndex];

          const onPress = () => {
            if (!route) {
              navigation.navigate(tabRouteName as never);
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
              navigation.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            }
          };

          const activeIcon = tab.icon;
          const inactiveIcon = tab.iconOutline ?? tab.icon;
          const iconToRender = isFocused ? activeIcon : inactiveIcon;
          const iconColor = isFocused ? colors.colorPrimary : colors.colorTextTertiary;

          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={tab.label}
              testID={`tab-${tab.name}`}
              onPress={onPress}
              onLongPress={onLongPress}
              style={styles.tabButton}>
              {/* 3px Top Active Indicator Bar */}
              <View
                style={[
                  styles.topIndicator,
                  isFocused && styles.topIndicatorActive,
                ]}
              />

              <View style={styles.tabContent}>
                {/* Active Pill Container */}
                <View style={[styles.pill, isFocused && styles.pillActive]}>
                  <AppIcon name={iconToRender} size={22} color={iconColor} />
                </View>

                {/* Tab Label */}
                <Text
                  style={[
                    styles.tabLabel,
                    isFocused ? styles.tabLabelActive : styles.tabLabelInactive,
                  ]}
                  numberOfLines={1}>
                  {tab.label}
                </Text>
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
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  tabRow: {
    flex: 1,
    flexDirection: 'row',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    position: 'relative',
    minHeight: layout.touchTargetPrimary,
  },
  topIndicator: {
    width: 24,
    height: 3,
    backgroundColor: 'transparent',
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  topIndicatorActive: {
    backgroundColor: colors.colorPrimary,
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
    fontSize: typography.fontSizeCaption,
    textAlign: 'center',
  },
  tabLabelActive: {
    fontWeight: typography.fontWeightSemibold,
    color: colors.colorPrimary,
  },
  tabLabelInactive: {
    fontWeight: typography.fontWeightMedium,
    color: colors.colorTextTertiary,
  },
});
