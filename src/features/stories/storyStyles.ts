/**
 * Story bubble styles — the horizontal row of publisher circles.
 *
 * The rings are the one piece of state the row communicates, so they are the
 * only thing colour is used for here: an unread story wears the primary accent,
 * a viewed one wears the muted border token. The DEMO chip reuses the same
 * primary pair, because a demo story is not a company and must read as a label
 * rather than as a verification.
 */

import { StyleSheet } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme/tokens';

export const storyStyles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  bubbleContainer: {
    alignItems: 'center',
    width: 72,
  },
  ringContainer: {
    width: 68,
    height: 68,
    borderRadius: 34,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
  },
  ringUnread: {
    borderColor: colors.colorPrimary,
  },
  ringViewed: {
    borderColor: colors.colorBorder,
  },
  /**
   * The premium ring: a job or internship story in the group. The extra width
   * (3 rather than 2.5) plus the gold token is what reads as "premium" at
   * circle size — a colour change alone disappears against the blue at 2.5.
   */
  ringPremium: {
    borderColor: colors.colorStoryPremium,
    borderWidth: 3,
  },
  /** A premium group that is already viewed: gold, but held back from shouting. */
  ringPremiumViewed: {
    borderColor: colors.colorStoryPremiumBright,
    borderWidth: 3,
    opacity: 0.55,
  },
  avatarInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    overflow: 'hidden',
    backgroundColor: colors.colorBgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeContainer: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: colors.colorBgSurface,
    borderRadius: 10,
    padding: 2,
  },
  verifiedBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.colorPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: spacing.xs,
    fontSize: typography.fontSizeCaption,
    color: colors.colorTextPrimary,
    textAlign: 'center',
    width: '100%',
  },
  labelViewed: {
    color: colors.colorTextTertiary,
  },
  /**
   * Reserved slot under the name. It keeps the row of labels on one baseline
   * whether or not the bubble is a demo one, so the circles stay aligned.
   */
  labelSlot: {
    alignItems: 'center',
    height: 14,
    marginTop: 2,
  },
  demoChip: {
    backgroundColor: colors.colorPrimarySubtle,
    borderRadius: radius.full,
    paddingHorizontal: 5,
  },
  demoChipText: {
    color: colors.colorPrimary,
    fontSize: 9,
    fontWeight: typography.fontWeightBold,
    letterSpacing: 0.5,
    lineHeight: 13,
  },
});
