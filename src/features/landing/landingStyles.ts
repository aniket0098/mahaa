/** Landing screen styles — kept beside the content they render. */

import { StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';

export const landingStyles = StyleSheet.create({
  root: {
    backgroundColor: colors.colorBgPage,
    flex: 1,
  },
  hero: {
    backgroundColor: colors.landingBg,
    gap: spacing.xl,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.pagePadding,
  },
  heroCopy: {
    gap: spacing.md,
  },
  eyebrow: {
    opacity: 0.8,
  },
  lead: {
    opacity: 0.85,
  },
  heroActions: {
    gap: spacing.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: colors.landingSurface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  band: {
    gap: spacing.md,
    paddingHorizontal: spacing.pagePadding,
    paddingVertical: spacing.xxl,
  },
  pillar: {
    gap: spacing.xs,
  },
  spaced: {
    marginTop: spacing.lg,
  },
  list: {
    gap: spacing.md,
  },
  listRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  bullet: {
    borderRadius: radius.full,
    height: 8,
    marginTop: 6,
    width: 8,
  },
  closing: {
    backgroundColor: colors.landingBgDeep,
    marginTop: spacing.lg,
  },
  closingButton: {
    marginTop: spacing.sm,
  },
});
