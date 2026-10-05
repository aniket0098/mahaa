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

  /* ------------------------- create-post entry ------------------------- */
  /**
   * First circle in the stories row. 68px to match the story bubbles, blue
   * fill with a white plus, and a white-border ring that reads as distinct
   * without leaving the blue-and-white scheme. The label slot mirrors the
   * story bubbles so every item in the row shares one baseline.
   */
  createContainer: { alignItems: 'center', width: STORY_ITEM_WIDTH },
  /**
   * The `Your story` circle: the caller's own avatar, ringed like a story bubble
   * so the row scans as one rhythm, with the surface colour behind it rather
   * than the primary fill. Phase 12 changed this from a solid blue plus — from a
   * row of other people's faces, "add an opportunity" was never what it meant.
   */
  createCircle: {
    alignItems: 'center',
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorPrimary,
    borderRadius: STORY_CIRCLE / 2,
    borderWidth: 2,
    height: STORY_CIRCLE,
    justifyContent: 'center',
    width: STORY_CIRCLE,
    ...elevation.sm,
  },
  /** The "+" badge, bottom-right of the circle: says "add" without hiding the face. */
  createBadge: {
    alignItems: 'center',
    backgroundColor: colors.colorPrimary,
    borderColor: colors.colorBgSurface,
    borderRadius: 11,
    borderWidth: 2,
    bottom: -2,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
    width: 22,
  },
  createLabel: {
    color: colors.colorTextPrimary,
    fontSize: typography.fontSizeCaption,
    marginTop: spacing.xs,
    textAlign: 'center',
    width: '100%',
  },
  createSlot: { alignItems: 'center', height: 14, marginTop: 2 },

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
  /**
   * One row: logo, search, bell, avatar. `gap: sm` and no `justifyContent`
   * space-between, because the search field is the only element allowed to
   * grow (`flex: 1`) and the other three are fixed-size touch targets. That
   * keeps the row from spreading out on a tablet and from clipping on a 360pt
   * phone.
   */
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  /**
   * Sidebar menu toggle. A circular muted button with the same primary touch
   * target as the bell and avatar, so the four-element row stays aligned on
   * narrow screens and web.
   */
  menuToggle: {
    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    borderRadius: radius.full,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  /**
   * Collapsed search. A muted pill with the icon and the placeholder, sized to
   * the 44px inline-secondary touch target, and shrinking before anything else
   * does because it is the only flexible child of the row.
   */
  searchTrigger: {
    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    borderRadius: radius.full,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 40,
    minWidth: 0,
    paddingHorizontal: spacing.md,
  },
  searchPlaceholder: { flexShrink: 1, flexGrow: 0, flexBasis: 'auto' },
  /** Bell and avatar: 44px targets with no chrome of their own. */
  headerAction: {
    alignItems: 'center',
    borderRadius: radius.full,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  /** The subtle ring that separates the avatar from the header surface. */
  avatarRing: {
    borderColor: colors.colorBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    padding: 2,
  },
  /** Expanded search field — replaces the pill in the same row. */
  searchFieldExpanded: {
    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorPrimary,
    borderRadius: radius.full,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 40,
    minWidth: 0,
    paddingHorizontal: spacing.md,
  },
  searchClear: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  searchCancel: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingLeft: spacing.sm,
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
  /** Note under the story row: the demo disclaimer, or the honest empty state. */
  storiesNote: { paddingTop: spacing.sm },
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
  /* The composer card was removed from this page: the stories row's Create (+)
     button is the only publishing entry point, and it opens the honest
     `/add-post` notice. The feed has no composer of its own. */

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

  /* The feed styles live with the feed: see `features/feed/feedStyles.ts`.
     They were removed from this file when the dashboard's own-records stream and
     the Community Feed were folded into one section. */

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
