/**
 * Screen — the page shell shared by every route.
 *
 * Handles the safe-area insets (notch, gesture bar, Android status bar) and the
 * standard page padding so no screen has to repeat that arithmetic. Scrollable
 * by default because every MahaJob screen is a vertical flow.
 */

import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/tokens';

export interface ScreenProps {
  children: ReactNode;
  /** Extra bottom padding, e.g. to clear a sticky action bar. */
  bottomInset?: number;
  /** Remove the default horizontal padding (the landing hero owns its own). */
  flush?: boolean;
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Screen({
  children,
  bottomInset = 0,
  flush = false,
  scrollable = true,
  style,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const paddingTop = insets.top;
  const paddingBottom = insets.bottom + spacing.xl + bottomInset;

  const container = [flush ? null : styles.padded, { paddingTop, paddingBottom }, style];

  if (!scrollable) {
    return (
      <View testID={testID} style={[styles.root, container]}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      testID={testID}
      style={styles.root}
      contentContainerStyle={container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.colorBgPage,
    flex: 1,
  },
  padded: {
    paddingHorizontal: spacing.pagePadding,
  },
});
