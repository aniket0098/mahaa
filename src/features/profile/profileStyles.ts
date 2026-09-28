/**
 * Candidate profile screen styles.
 *
 * Every value comes from `@/theme/tokens` — no raw hex, no magic number that is
 * not a spacing, radius, or layout token. The two exceptions are the cover band
 * geometry and the avatar overlap, which are fixed dimensions rather than scale
 * values because they have to hold the overlapping avatar without pushing the
 * name below the fold on a 360px phone.
 */

import { StyleSheet } from 'react-native';

import { colors, elevation, radius, spacing, typography } from '@/theme/tokens';

/** Cover band height. The avatar hangs `AVATAR_OVERLAP` px below its edge. */
export const COVER_HEIGHT = 132;
export const AVATAR_SIZE = 96;
/** How much of the avatar sits below the cover; the rest overlaps the cover. */
export const AVATAR_OVERLAP = 48;

export const styles = StyleSheet.create({
  /* ------------------------------- page ------------------------------- */
  root: {
    backgroundColor: colors.colorBgPage,
    flex: 1,
  },
  page: {
    gap: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  padded: {
    paddingHorizontal: spacing.pagePadding,
  },
  stack: {
    gap: spacing.lg,
  },

  /* ------------------------------ cover ------------------------------- */
  cover: {
    backgroundColor: colors.colorPrimary,
    height: COVER_HEIGHT,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    padding: spacing.lg,
  },
  /** Token-blue bands so the default cover is not a flat block of colour. */
  coverBand: {
    backgroundColor: colors.colorPrimaryHover,
    borderRadius: radius.full,
    height: 72,
    position: 'absolute',
    right: -48,
    top: -24,
    width: 232,
  },
  coverBandSecond: {
    backgroundColor: colors.colorPrimaryActive,
    opacity: 0.5,
    right: -80,
    top: 44,
  },
  coverLabel: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightMedium,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  /* ------------------------------ header ------------------------------ */
  headerBlock: {
    gap: spacing.sm,
    marginTop: -AVATAR_OVERLAP,
  },
  /**
   * A page-coloured ring around the avatar so it reads as separated from the
   * blue cover rather than sitting flat on it. `alignSelf` keeps it hugging the
   * circle instead of stretching across the column.
   */
  avatarRing: {
    alignSelf: 'flex-start',
    borderColor: colors.colorBgPage,
    borderRadius: radius.full,
    borderWidth: 3,
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metaLine: {
    color: colors.colorTextSecondary,
    fontSize: typography.fontSizeSmall,
    lineHeight: typography.lineHeightSmall,
  },
  metaLineTertiary: {
    color: colors.colorTextTertiary,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },

  /* --------------------------- statistics row -------------------------- */
  statRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCol: {
    alignItems: 'center',
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.card,
    borderWidth: 1,
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 76,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md,
  },
  statColPressed: {
    backgroundColor: colors.colorPrimarySubtle,
    borderColor: colors.colorPrimary,
  },
  statValue: {
    color: colors.colorTextPrimary,
    fontSize: typography.fontSizeH2,
    fontWeight: typography.fontWeightBold,
    lineHeight: typography.lineHeightH2,
  },
  statLabel: {
    color: colors.colorTextTertiary,
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightMedium,
    textAlign: 'center',
  },
  /* -------------------------- activity grid --------------------------- */
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gridCell: {
    // Two even columns with a shared gap: a percentage basis plus `flexGrow`
    // fills the row exactly without measuring the screen width.
    flexBasis: '47%',
    flexGrow: 1,
    maxWidth: '48%',
  },
  activityCard: {
    gap: spacing.xs,
    height: '100%',
    minHeight: 112,
  },
  activityIcon: {
    alignItems: 'center',
    backgroundColor: colors.colorPrimarySubtle,
    borderRadius: radius.sm,
    height: 32,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    width: 32,
  },
  activityValue: {
    color: colors.colorTextPrimary,
    fontSize: typography.fontSizeH2,
    fontWeight: typography.fontWeightBold,
    lineHeight: typography.lineHeightH2,
  },
  activityTitle: {
    color: colors.colorTextPrimary,
    fontSize: typography.fontSizeSmall,
    fontWeight: typography.fontWeightSemibold,
  },
  activityCaption: {
    color: colors.colorTextTertiary,
    fontSize: typography.fontSizeCaption,
  },

  /* ------------------------------ sections ---------------------------- */
  card: {
    gap: spacing.md,
  },
  section: {
    gap: spacing.md,
  },
  /** Completeness breakdown rows in the footer card. */
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
  empty: {
    gap: spacing.xs,
  },
  /** Vertical form stack used by the section editors. */
  form: {
    gap: spacing.md,
  },

  /* -------------------------------- chips ----------------------------- */
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: colors.colorPrimarySubtle,
    borderColor: colors.colorBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipLabel: {
    color: colors.colorPrimary,
    fontSize: typography.fontSizeSmall,
    fontWeight: typography.fontWeightMedium,
  },

  /* ------------------------------ timelines --------------------------- */
  entry: {
    borderTopColor: colors.colorBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
    paddingTop: spacing.md,
  },
  entryFirst: {
    borderTopWidth: 0,
    paddingTop: 0,
  },
  entryTitle: {
    color: colors.colorTextPrimary,
    fontSize: typography.fontSizeBody,
    fontWeight: typography.fontWeightSemibold,
    lineHeight: typography.lineHeightBody,
  },
  entryMeta: {
    color: colors.colorTextSecondary,
    fontSize: typography.fontSizeSmall,
    lineHeight: typography.lineHeightSmall,
  },
  entryMuted: {
    color: colors.colorTextTertiary,
    fontSize: typography.fontSizeCaption,
    lineHeight: typography.lineHeightCaption,
  },

  /* ------------------------------ projects ---------------------------- */
  projectGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  projectCell: {
    flexBasis: '47%',
    flexGrow: 1,
    maxWidth: '48%',
  },
  projectCard: {
    gap: spacing.sm,
    height: '100%',
  },
  thumb: {
    alignItems: 'center',
    backgroundColor: colors.colorPrimarySubtle,
    borderColor: colors.colorBorder,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 84,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  projectTitle: {
    color: colors.colorTextPrimary,
    fontSize: typography.fontSizeBody,
    fontWeight: typography.fontWeightSemibold,
    lineHeight: typography.lineHeightBody,
  },
  projectDescription: {
    color: colors.colorTextSecondary,
    fontSize: typography.fontSizeCaption,
    lineHeight: typography.lineHeightCaption,
  },
  linkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  linkChip: {
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },

  /* ------------------------------ gallery ----------------------------- */
  gallery: {
    gap: spacing.sm,
  },
  galleryCard: {
    gap: spacing.sm,
    width: 220,
    ...elevation.sm,
  },
  galleryThumb: {
    alignItems: 'center',
    backgroundColor: colors.colorInfoSubtle,
    borderColor: colors.colorBorder,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 96,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  galleryBody: {
    gap: 2,
  },
  galleryTitle: {
    color: colors.colorTextPrimary,
    fontSize: typography.fontSizeSmall,
    fontWeight: typography.fontWeightSemibold,
    lineHeight: typography.lineHeightSmall,
  },
  galleryIssuer: {
    color: colors.colorTextSecondary,
    fontSize: typography.fontSizeCaption,
    lineHeight: typography.lineHeightCaption,
  },
  galleryDate: {
    color: colors.colorTextTertiary,
    fontSize: typography.fontSizeCaption,
    lineHeight: typography.lineHeightCaption,
  },

  /* ------------------------------ posts ------------------------------- */
  postsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  posts: {
    gap: spacing.md,
  },
});

