/**
 * Shared styles for the Discover feature — one `StyleSheet` so the pinned
 * header, search field, category tabs, work-mode control, cards, skeleton,
 * results summary, empty states, list and detail all draw from the same
 * spacing, radius and colour tokens. Mirrors the per-feature styles convention
 * (`homeStyles`, `feedStyles`, `storyStyles`): no component picks its own raw
 * value, and no colour is a literal.
 *
 * Layout contract for the 2026 premium hybrid redesign:
 *   - the header (title + search) is pinned outside the list, so search stays
 *     reachable while the feed scrolls (the LinkedIn/Indeed anchor);
 *   - the FlatList header holds only categories → work mode → results summary,
 *     so the first real card appears without a wall of chrome above it;
 *   - metadata is `small` (13px) not `caption` (12px) — nothing the reader must
 *     actually read is 12px.
 */

import { StyleSheet } from 'react-native';

import { colors, elevation, layout, radius, spacing, typography } from '@/theme/tokens';

export const styles = StyleSheet.create({
  /* ---- screen root (header + list) ---- */
  screen: {
    backgroundColor: colors.colorBgPage,
    flex: 1,
  },

  /* ---- pinned header ---- */
  header: {
    backgroundColor: colors.colorBgPage,
    gap: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.pagePadding,
  },
  headerTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: layout.touchTargetPrimary,
  },
  headerTitle: {
    flex: 1,
  },
  avatarButton: {
    alignItems: 'center',
    borderRadius: radius.full,
    justifyContent: 'center',
    minHeight: layout.touchTargetSecondary,
    minWidth: layout.touchTargetSecondary,
  },

  /* ---- list ---- */
  flatList: {
    flex: 1,
  },
  listContent: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.pagePadding,
  },
  headerBlock: {
    gap: spacing.md,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  footerError: {
    marginTop: spacing.sm,
  },

  /* ---- search field ---- */
  searchWrap: {
    alignItems: 'center',
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    elevation: elevation.sm.elevation,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: layout.inputHeight,
    paddingHorizontal: spacing.md,
    shadowColor: elevation.sm.shadowColor,
    shadowOffset: elevation.sm.shadowOffset,
    shadowOpacity: elevation.sm.shadowOpacity,
    shadowRadius: elevation.sm.shadowRadius,
  },
  searchWrapFocused: {
    borderColor: colors.colorPrimary,
  },
  searchInput: {
    color: colors.colorTextPrimary,
    flex: 1,
    fontSize: typography.fontSizeBody,
    paddingVertical: spacing.md,
  },
  searchClear: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.touchTargetSecondary,
    minWidth: layout.touchTargetSecondary,
  },

  /* ---- category tabs ---- */
  categoryRow: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  categoryChip: {
    alignItems: 'center',
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: layout.touchTargetSecondary,
    paddingHorizontal: spacing.lg,
  },
  categoryChipActive: {
    backgroundColor: colors.colorPrimarySubtle,
    borderColor: colors.colorPrimary,
  },
  // The icon + label row carries the press-scale so the chip's padded shell
  // (border, background) stays perfectly still while the content springs.
  categoryChipInner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
  },

  /* ---- work-mode segmented control ---- */
  segmentedTrack: {
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 2,
    padding: 3,
  },
  segmented: {
    alignItems: 'center',
    borderRadius: radius.control - 3,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
  },
  segmentedActive: {
    backgroundColor: colors.colorBgSurface,
    elevation: elevation.sm.elevation,
    shadowColor: elevation.sm.shadowColor,
    shadowOffset: elevation.sm.shadowOffset,
    shadowOpacity: elevation.sm.shadowOpacity,
    shadowRadius: elevation.sm.shadowRadius,
  },

  /* ---- results summary ---- */
  resultsBlock: {
    gap: spacing.sm,
  },
  facetRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  facetChip: {
    alignItems: 'center',
    backgroundColor: colors.colorPrimarySubtle,
    borderRadius: radius.full,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  clearAll: {
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.xs,
  },

  /* ---- empty state ---- */
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  emptyIconCircle: {
    alignItems: 'center',
    backgroundColor: colors.colorPrimarySubtle,
    borderRadius: radius.full,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },

  /* ---- opportunity card ---- */
  card: {
    gap: spacing.md,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  cardHeaderText: {
    flex: 1,
    gap: 2,
  },
  companyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metaItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },

  /* ---- skeleton ---- */
  skeletonCard: {
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.cardPadding,
  },
  skeletonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  skeletonRowText: {
    flex: 1,
    gap: spacing.sm,
  },
  skeletonBadgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  /* ---- detail ---- */
  detail: {
    gap: spacing.lg,
  },
  detailHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  detailHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  sectionCard: {
    gap: spacing.sm,
  },
  factRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  factText: {
    flex: 1,
  },
  reqRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  bodyText: {
    color: colors.colorTextSecondary,
    lineHeight: typography.lineHeightH3,
  },
});
