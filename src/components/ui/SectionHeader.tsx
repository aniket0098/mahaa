/**
 * Section header — the repeated heading + optional action pattern.
 *
 * The heading is a real accessibility header so screen-reader users can jump
 * between sections instead of reading the page linearly.
 */

import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, spacing } from '@/theme/tokens';

export interface SectionHeaderProps {
  title: string;
  description?: string | null;
  action?: React.ReactNode;
}

export function SectionHeader({ title, description, action }: SectionHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.text}>
        <AppText variant="h3" accessibilityRole="header">
          {title}
        </AppText>
        {description ? (
          <AppText variant="small" tone="tertiary">
            {description}
          </AppText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  text: {
    flex: 1,
    gap: 2,
  },
});

export const sectionDivider = {
  backgroundColor: colors.colorBorder,
  height: StyleSheet.hairlineWidth,
};
