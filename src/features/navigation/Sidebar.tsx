/**
 * Sidebar Drawer Component — a collapsible navigation menu that slides from the left.
 *
 * Implements:
 * - BrandMark logo header with close button
 * - Six navigation items in exact order:
 *   1. Home (/home)
 *   2. Add Post (/add-post)
 *   3. Learning (/learn)
 *   4. Community (/community)
 *   5. Innovation Lab (/innovation-lab)
 *   6. Project Gallery (/profile/projects)
 * - Highlights active route
 * - Closes on: close button, backdrop tap, Escape key on web, left-swipe gesture, and Android back
 * - Safe area handling
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'expo-router';
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { BrandMark } from '@/components/ui/BrandMark';
import { colors } from '@/theme/tokens';
import { useSidebar } from './SidebarContext';
import { isSidebarItemActive, SIDEBAR_ITEMS, type SidebarItem } from './sidebarItems';
import { SIDEBAR_WIDTH, sidebarStyles } from './sidebarStyles';

const ANIM_DURATION = 240;

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { isOpen, isMounted, closeSidebar, finishClose } = useSidebar();

  const [slideAnim] = useState(() => new Animated.Value(-SIDEBAR_WIDTH));
  const [fadeAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (isOpen) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: ANIM_DURATION,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: ANIM_DURATION,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    // Closing: the drawer stays mounted until the slide-out finishes, so the
    // animation is never cut short by an unmount. Reopening before it lands
    // stops this animation, and `finished: false` keeps it from unmounting.
    if (!isMounted) return;

    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -SIDEBAR_WIDTH,
        duration: ANIM_DURATION - 40,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: ANIM_DURATION - 40,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        finishClose();
      }
    });
  }, [isOpen, isMounted, slideAnim, fadeAnim, finishClose]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSidebar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeSidebar]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return gestureState.dx < -15 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx < -40 || gestureState.vx < -0.3) {
            closeSidebar();
          }
        },
      }),
    [closeSidebar],
  );

  const handleSelect = useCallback(
    (item: SidebarItem) => {
      closeSidebar();
      if (pathname !== item.path) {
        router.push(item.path as never);
      }
    },
    [closeSidebar, pathname, router],
  );

  if (!isMounted) {
    return null;
  }

  return (
    <Modal
      transparent
      visible={isMounted}
      animationType="none"
      onRequestClose={closeSidebar}>
      <View style={sidebarStyles.overlay}>
        {/* Dimmed Backdrop */}
        <Animated.View style={[sidebarStyles.backdropPressable, { opacity: fadeAnim }]}>
          <Pressable
            style={sidebarStyles.backdropPressable}
            onPress={closeSidebar}
            accessibilityRole="button"
            accessibilityLabel="Close sidebar overlay"
          />
        </Animated.View>

        {/* Sliding Drawer Container */}
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            sidebarStyles.drawerContainer,
            {
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              transform: [{ translateX: slideAnim }],
            },
          ]}>
          {/* Header with Brand Logo & Close Button */}
          <View style={sidebarStyles.header}>
            <BrandMark size="sm" />
            <Pressable
              style={sidebarStyles.closeButton}
              onPress={closeSidebar}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close navigation menu">
              <AppIcon
                name={{ ios: 'xmark', android: 'close' }}
                size={20}
                color={colors.colorTextPrimary}
              />
            </Pressable>
          </View>

          {/* Scrollable Navigation Menu */}
          <ScrollView
            style={sidebarStyles.menuScroll}
            contentContainerStyle={sidebarStyles.menuContent}
            showsVerticalScrollIndicator={false}>
            {SIDEBAR_ITEMS.map((item, index) => {
              const active = isSidebarItemActive(item.path, pathname);
              const isSecondInGroup = index === 1 || index === 3;

              return (
                <View key={item.id}>
                  <Pressable
                    style={[
                      sidebarStyles.menuItem,
                      active && sidebarStyles.menuItemActive,
                    ]}
                    onPress={() => handleSelect(item)}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={item.label}>
                    <View
                      style={[
                        sidebarStyles.iconBox,
                        active && sidebarStyles.iconBoxActive,
                      ]}>
                      <AppIcon
                        name={item.icon}
                        size={18}
                        color={active ? colors.colorTextOnPrimary : colors.colorTextSecondary}
                      />
                    </View>
                    <Text
                      style={[
                        sidebarStyles.menuLabel,
                        active && sidebarStyles.menuLabelActive,
                      ]}>
                      {item.label}
                    </Text>
                  </Pressable>

                  {/* Group Separator */}
                  {isSecondInGroup && index < SIDEBAR_ITEMS.length - 1 && (
                    <View style={sidebarStyles.separator} />
                  )}
                </View>
              );
            })}
          </ScrollView>

          {/* Footer info */}
          <View style={sidebarStyles.footer}>
            <Text style={sidebarStyles.footerText}>MahaJob Candidate Hub</Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
