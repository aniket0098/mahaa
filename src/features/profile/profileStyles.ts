/** Candidate profile screen styles. */

import { StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';

export const styles = StyleSheet.create({
  stack: {
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xs,
  },
  card: {
    gap: spacing.md,
  },
  sections: {
    gap: spacing.md,
  },
  sectionRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  sectionText: {
    flex: 1,
    gap: 2,
  },
  marker: {
    borderRadius: radius.full,
    height: 8,
    marginTop: 6,
    width: 8,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.colorPrimarySubtle,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  entry: {
    borderTopColor: colors.colorBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
    paddingTop: spacing.md,
  },
});
