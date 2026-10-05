/**
 * Community Feed styles.
 *
 * Every value is a semantic token from `src/theme/tokens.ts` — no raw hex, no
 * literal font size. Two measurement rules from the design brief are encoded
 * here rather than repeated per component:
 *
 *  - **Primary actions are 48px high** (`minHeight: 48`), inline secondary
 *    controls are at least 40px, and every icon-only control is 40–44px square
 *    with `hitSlop` at the call site.
 *  - **Media is never cropped to a fixed box**: the image container takes its
 *    height from the image's own aspect ratio, capped by `MAX_MEDIA_HEIGHT` in
 *    `feedModel.ts`, and the image itself uses `contain`.
 */

import { StyleSheet } from 'react-native';

import { colors, elevation, radius, spacing, typography } from '@/theme/tokens';

/** Height shared by the action row's controls, so the row reads as one rhythm. */
export const ACTION_HEIGHT = 44;

export const styles = StyleSheet.create({
  /* --------------------------------- section -------------------------------- */
  section: { gap: spacing.md, marginTop: spacing.sm },

  /* --------------------------------- filters -------------------------------- */
  filterRow: { flexDirection: 'row', gap: spacing.xs, paddingVertical: spacing.xs },
  filterChip: {
    borderColor: colors.colorBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.lg,
  },
  filterChipActive: {
    backgroundColor: colors.colorPrimarySubtle,
    borderColor: colors.colorPrimary,
  },
  filterChipLabel: { color: colors.colorTextSecondary },

  /* ---------------------------------- list ---------------------------------- */
  list: { gap: spacing.lg },
  card: { overflow: 'hidden' },
  cardBody: { gap: spacing.md, padding: spacing.cardPadding },
  /** Media is inset like the text, so the card's edges stay clean. */
  mediaPad: { paddingHorizontal: spacing.cardPadding },

  /* ------------------------------- post header ------------------------------ */
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  authorBlock: { alignItems: 'flex-start', flex: 1, flexDirection: 'row', gap: spacing.md },
  authorText: { flex: 1, gap: 2 },
  authorName: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  menuButton: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: ACTION_HEIGHT,
    justifyContent: 'center',
    width: ACTION_HEIGHT,
  },

  /* -------------------------------- post body ------------------------------- */
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  title: { color: colors.colorTextPrimary },
  metaList: { gap: 2 },
  bodyText: { color: colors.colorTextSecondary },
  seeMore: {
    color: colors.colorPrimary,
    fontWeight: typography.fontWeightMedium,
    minHeight: 32,
  },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },

  /* ---------------------------------- media --------------------------------- */
  mediaStack: { gap: spacing.sm },
  mediaFrame: {
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    overflow: 'hidden',
    ...elevation.sm,
  },
  mediaImage: { height: '100%', width: '100%' },
  mediaCountPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.colorOverlay,
    borderRadius: radius.full,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 28,
    paddingHorizontal: spacing.md,
  },
  mediaCountText: { color: colors.colorTextOnPrimary },
  /** A failed image must say so — an empty frame is indistinguishable from loading. */
  mediaError: {
    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 120,
    padding: spacing.md,
  },

  /* --------------------------- project / achievement -------------------------- */
  detailBlock: {
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  detailRow: { flexDirection: 'row', gap: spacing.sm },
  detailLabel: {
    color: colors.colorTextTertiary,
    fontWeight: typography.fontWeightSemibold,
    letterSpacing: 0.04,
    width: 108,
  },
  detailValue: { color: colors.colorTextPrimary, flex: 1 },
  detailHeading: { color: colors.colorTextPrimary },
  techRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },

  /* --------------------------------- links ---------------------------------- */
  linksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  link: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
  },
  linkLabel: { color: colors.colorPrimary, fontWeight: typography.fontWeightMedium },
  linkNote: { color: colors.colorTextTertiary },

  /* ------------------------------- action row -------------------------------- */
  actionRow: {
    alignItems: 'center',
    borderTopColor: colors.colorBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  actionList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  action: {
    alignItems: 'center',
    borderRadius: radius.control,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: ACTION_HEIGHT,
    paddingHorizontal: spacing.md,
  },
  actionActive: { backgroundColor: colors.colorPrimarySubtle },
  actionLabel: { color: colors.colorTextSecondary },
  /** A busy Like button dims rather than disappearing, so the row does not reflow. */
  actionDisabled: { opacity: 0.6 },
  actionPressed: { opacity: 0.7 },
  /** The count beside an icon. Toned down so the icon stays the primary signal. */
  actionCount: { color: colors.colorTextTertiary },
  /** Local-only state must be visible, not implied (see localEngagement.ts). */
  localNote: { color: colors.colorTextTertiary },

  /* ------------------------------- empty state ------------------------------- */
  emptyState: { alignItems: 'flex-start', gap: spacing.sm },
  emptyTitle: { color: colors.colorTextPrimary },

  /* ------------------------------ media viewer ------------------------------- */
  viewerRoot: { backgroundColor: colors.colorOverlay, flex: 1 },
  viewerCounter: {
    alignSelf: 'center',
    color: colors.colorTextOnPrimary,
    fontWeight: typography.fontWeightSemibold,
  },
  viewerClose: {
    alignItems: 'center',
    backgroundColor: colors.colorOverlay,
    borderRadius: radius.full,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  viewerCloseRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  viewerStage: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  viewerImage: { height: '100%', width: '100%' },
  viewerNav: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.lg,
    justifyContent: 'center',
    paddingBottom: spacing.md,
  },
  viewerNavButton: {
    alignItems: 'center',
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  viewerCaption: { color: colors.colorTextOnPrimary, textAlign: 'center' },

  /* ------------------------------ comments sheet ----------------------------- */
  sheetBackdrop: { backgroundColor: colors.colorOverlay, flex: 1, justifyContent: 'flex-end' },
  sheetCard: {
    backgroundColor: colors.colorBgSurface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    gap: spacing.md,
    maxHeight: '80%',
    padding: spacing.cardPadding,
  },
  sheetHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  sheetBody: { gap: spacing.md },
  /** Lets the list shrink under the keyboard instead of being pushed off-screen. */
  sheetKeyboard: { flexShrink: 1 },

  /* ------------------------------ comment rows -------------------------------- */
  commentRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  commentBody: { flex: 1, gap: 2 },
  commentMeta: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  /** An optimistic row is dimmed because it is not on the server yet. */
  commentPendingText: { color: colors.colorTextTertiary },
  commentComposerRow: { alignItems: 'center', justifyContent: 'center', minHeight: 72 },

  /** The composer: a 48px field and a 44px send target, per the touch rules. */
  commentComposer: { alignItems: 'flex-end', flexDirection: 'row', gap: spacing.sm },
  commentInput: {
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    color: colors.colorTextPrimary,
    flex: 1,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  commentSend: {
    alignItems: 'center',
    backgroundColor: colors.colorPrimary,
    borderRadius: radius.full,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  /** Dimmed rather than hidden, so the row never reflows under the reader's thumb. */
  commentSendDisabled: { opacity: 0.4 },
  sheetEmpty: {
    alignItems: 'flex-start',
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  /** The composer is rendered disabled, with the reason stated beneath it. */
  sheetComposer: {
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    color: colors.colorTextDisabled,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sheetComposerNote: { color: colors.colorTextTertiary },

  /* ------------------------------ engagement summary --------------------------- */
  /** Counts sit above the action row, left-aligned like the rest of the card. */
  summaryRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  summaryText: { color: colors.colorTextSecondary },
  summaryLink: { justifyContent: 'center', minHeight: 32 },
  summaryLinkText: { color: colors.colorTextSecondary },
  summaryEmpty: { color: colors.colorTextTertiary },

  /* ----------------------------- post overflow menu ---------------------------- */
  /** A centred dialog rather than a bottom sheet — it is a short action list. */
  dialogCard: {
    backgroundColor: colors.colorBgSurface,
    borderRadius: radius.sheet,
    gap: spacing.md,
    padding: spacing.cardPadding,
    ...elevation.md,
  },
  menuRow: {
    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-start',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  menuRowCentered: { justifyContent: 'center' },
  menuRowText: { flex: 1 },
  /** Centred backdrop for the action dialog, versus the bottom sheets. */
  dialogBackdrop: {
    backgroundColor: colors.colorOverlay,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.pagePadding,
  },
});
