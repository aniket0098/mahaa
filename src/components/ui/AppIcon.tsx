/**
 * Icon — one wrapper for the platform icon set.
 *
 * iOS renders SF Symbols, Android renders the Material equivalent supplied by
 * `expo-symbols`, and the web preview falls back to text so the browser build
 * never renders an empty box. `name` always carries both platform names
 * because a tab icon is never conveyed by colour alone.
 */

import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

export interface AppIconProps {
  name: { ios: string; android: string; web?: string };
  size?: number;
  color?: string;
}

export function AppIcon({ name, size = 24, color = colors.colorTextSecondary }: AppIconProps) {
  const resolved = { ios: name.ios, android: name.android, web: name.web ?? name.android } as
    SymbolViewProps['name'];

  return (
    <View style={styles.container} accessibilityElementsHidden importantForAccessibility="no">
      <SymbolView name={resolved} size={size} tintColor={color} resizeMode="scaleAspectFit" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
