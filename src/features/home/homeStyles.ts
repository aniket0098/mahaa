/**
 * Candidate dashboard styles.
 *
 * Native port of `apps/web/src/routes/candidate/home/dashboardHome.module.css`
 * and `feed.module.css`, with the CSS custom properties resolved to the token
 * values in `src/theme/tokens.ts` (the same values the web `:root` block
 * declares, so both apps render the same product).
 *
 * Two conversions are deliberate rather than literal:
 *
 *  - **Mobile measurements win.** The web stylesheet carries desktop and mobile
 *    values for the same rule; the values used here are the `max-width: 1023px`
 *    ones, because that is the surface this file renders. Where a value is not
 *    viewport-dependent it is carried across unchanged.
 *  - **Fixed height becomes `minHeight` + padding.** A CSS `height` clips text
 *    at a large font scale; `minHeight` keeps the documented 48/40/32px touch
 *    and reading sizes without truncating content.
 *
 * No raw hex appears here: every colour is a semantic token.
 */

import { StyleSheet } from 'react-native';

import { colors, elevation, radius, spacing, typography } from '@/theme/tokens';

/** Section rhythm: `.section` gap plus a little more air between sections. */
export const SECTION_GAP = spacing.xxl; // --space-2xl (32)
export const CARD_PADDING = spacing.cardPadding; // 16

/** Story bubble: 68px on desktop, 66px under 1024px — this surface. */
export const STORY_CIRCLE = 66;
/** Fixed item width so every label column lines up across the row. */
export const STORY_ITEM_WIDTH = 88; // 5.5rem
export const STORY_AVATAR = 56;

export const styles = StyleSheet.create({
  /* ------------------------------ page rhythm ------------------------------ */
  root: { backgroundColor: colors.colorBgPage, flex: 1 },
  page: { gap: SECTION_GAP, paddingHorizontal: spacing.pagePadding },
  section: { gap: spacing.md, marginTop: spacing.sm },
  footnote: { textAlign: 'center' },
  /** The story row is the first thing on the page, so it carries no top margin. */
  storiesSection: { marginTop: 0 },
  sectionHeader: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  sectionLink: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, minHeight: 32 },
  /** Shared empty-state body: icon, title, explanation, then the real action. */
  emptyState: { alignItems: 'flex-start', gap: spacing.sm },

  /* ------------------------------ header chrome ------------------------------ */
  header: {
    backgroundColor: colors.colorBgSurface,
    borderBottomColor: colors.colorBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    // The header is chrome, so it runs the full width of the screen while the
    // content below keeps the page gutters. The negative margins cancel the
    // page's own horizontal padding.
    marginHorizontal: -spacing.pagePadding,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.pagePadding,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerBrand: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  brandName: {
    fontSize: typography.fontSizeH3,
    fontWeight: typography.fontWeightBold,
    lineHeight: typography.lineHeightH3,
  },
  searchField: {
    alignItems: 'center',
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    // 42px on mobile (navSearch.module.css max-width: 1023px), trimmed from the
    // 44px desktop value so the two-row header stays compact.
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    color: colors.colorTextPrimary,
    flex: 1,
    fontSize: typography.fontSizeSmall,
    paddingVertical: 0,
  },
  searchResults: {
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: 2,
    marginTop: spacing.xs,
    padding: spacing.xs,
    ...elevation.md,
  },
  searchResult: {
    alignItems: 'center',
    borderRadius: radius.control,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 40,
    padding: spacing.sm,
  },
  searchHint: { paddingHorizontal: spacing.sm, paddingTop: spacing.xs },

  /* -------------------------------- stories -------------------------------- */
  storyRow: { flexDirection: 'row', gap: spacing.md }, // --space-md on mobile
  storyItem: { alignItems: 'center', gap: spacing.xs, width: STORY_ITEM_WIDTH },
  storyBubble: { alignItems: 'center', gap: spacing.xs },
  storyCircle: {
    alignItems: 'center',
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.full,
    borderWidth: 2,
    height: STORY_CIRCLE,
    justifyContent: 'center',
    width: STORY_CIRCLE,
  },
  /**
   * Unread ring — the one coloured circular indicator in the dashboard, and it
   * is driven by real `hasNewOpportunities` data, never by a timer or a guess.
   * The original pairs the primary border with a 2px `color-primary-subtle`
   * halo (`box-shadow: 0 0 0 2px`); on native the halo becomes an outer ring
   * view, because a zero-radius shadow cannot express an even ring on both
   * platforms.
   */
  storyRingNew: {
    alignItems: 'center',
    backgroundColor: colors.colorPrimarySubtle,
    borderRadius: radius.full,
    height: STORY_CIRCLE + 4,
    justifyContent: 'center',
    width: STORY_CIRCLE + 4,
  },
  storyCircleNew: { borderColor: colors.colorPrimary },
  storyCircleCreate: {
    backgroundColor: colors.colorPrimarySubtle,
    borderColor: colors.colorPrimary,
    borderStyle: 'dashed',
  },
  storyName: {
    color: colors.colorTextSecondary,
    fontSize: typography.fontSizeCaption,
    lineHeight: typography.lineHeightCaption,
    textAlign: 'center',
  },
  storyNew: {
    color: colors.colorPrimary,
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightSemibold,
    lineHeight: typography.lineHeightCaption,
  },
  /* -------------------------------- composer -------------------------------- */
  composer: { gap: spacing.md },
  composerTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  trigger: {
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    color: colors.colorTextTertiary,
    flex: 1,
    fontSize: typography.fontSizeBody,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    textAlign: 'left',
  },
  composerBottom: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },

  /* ------------------------------ quick actions ------------------------------ */
  quickActions: { gap: spacing.sm },
  quickActionsList: { flexDirection: 'row', gap: spacing.sm },
  quickAction: {
    alignItems: 'center',
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  quickActionSoon: {
    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorBorderStrong,
    borderRadius: radius.full,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  quickActionLabel: {
    fontSize: typography.fontSizeSmall,
    fontWeight: typography.fontWeightMedium,
    lineHeight: typography.lineHeightSmall,
  },
  soonTag: {
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightSemibold,
    letterSpacing: 0.04,
  },

  /* ---------------------------------- feed ---------------------------------- */
  feed: { gap: spacing.md },
  feedHeader: { gap: spacing.xs },
  feedControls: { gap: spacing.sm, marginTop: spacing.xs },
  filters: { flexDirection: 'row', gap: spacing.xs },
  filterButton: {
    borderColor: colors.colorBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: spacing.lg,
  },
  filterButtonActive: {
    backgroundColor: colors.colorPrimarySubtle,
    borderColor: colors.colorPrimary,
  },
  list: { gap: spacing.lg },
  card: { overflow: 'hidden' },
  cardTop: { gap: spacing.md, padding: CARD_PADDING },
  cardBottom: { gap: spacing.sm, padding: CARD_PADDING, paddingTop: 0 },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  author: { alignItems: 'flex-start', flex: 1, flexDirection: 'row', gap: spacing.md },
  authorText: { flex: 1, gap: 2 },
  manage: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  cardBody: { gap: spacing.sm },
  cardTitle: {
    fontSize: typography.fontSizeH3,
    fontWeight: typography.fontWeightSemibold,
    lineHeight: typography.lineHeightH3,
  },
  recordMeta: {
    color: colors.colorTextTertiary,
    fontSize: typography.fontSizeSmall,
    lineHeight: typography.lineHeightSmall,
  },
  cardText: {
    color: colors.colorTextSecondary,
    fontSize: typography.fontSizeBody,
    lineHeight: typography.lineHeightBody,
  },
  expand: {
    color: colors.colorPrimary,
    fontSize: typography.fontSizeSmall,
    fontWeight: typography.fontWeightMedium,
    minHeight: 32,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  link: {
    alignItems: 'center',
    color: colors.colorPrimary,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
  },
  /* ----------------------------- engagement bar ----------------------------- */
  actions: {
    alignItems: 'center',
    borderTopColor: colors.colorBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
  },
  actionList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  actionButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  actionsNote: {
    color: colors.colorTextDisabled,
    fontSize: typography.fontSizeCaption,
    lineHeight: typography.lineHeightCaption,
  },

  /* ---------------------------- career snapshot ---------------------------- */
  careerGrid: { gap: spacing.lg },
  careerBlock: {
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  careerLabel: {
    color: colors.colorTextTertiary,
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightSemibold,
    letterSpacing: 0.06,
  },
  careerValue: {
    fontSize: typography.fontSizeH3,
    fontWeight: typography.fontWeightSemibold,
    lineHeight: typography.lineHeightH3,
  },
  careerText: {
    color: colors.colorTextSecondary,
    fontSize: typography.fontSizeSmall,
    lineHeight: typography.lineHeightSmall,
  },
  careerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  careerLink: {
    color: colors.colorPrimary,
    fontSize: typography.fontSizeSmall,
    fontWeight: typography.fontWeightMedium,
    minHeight: 32,
  },
  /**
   * Profile completeness — the original indicator.
   *
   * An 8px horizontal track with a fully rounded fill, exactly as
   * `.completenessTrack` / `.completenessFill` define it. It is deliberately NOT
   * a circular progress ring: no such ring exists in the original design, and
   * the numeric percentage beneath it is the value the server returns from
   * `GET /profile/completeness`.
   */
  completenessTrack: {
    backgroundColor: colors.colorBorder,
    borderRadius: radius.full,
    height: 8,
    overflow: 'hidden',
  },
  completenessFill: {
    backgroundColor: colors.colorPrimary,
    borderRadius: radius.full,
    height: '100%',
  },
});
