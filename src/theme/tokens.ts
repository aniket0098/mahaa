/**
 * MahaJob design tokens — React Native port of `docs/DESIGN_TOKENS.md` (Stage 3),
 * transcribed from `apps/web/src/styles/tokens.css` so Android and iOS render the
 * same product identity as the web app.
 *
 * Layers (never skip a layer in component code):
 *   primitive tokens -> semantic tokens -> component tokens
 *
 * Light is the primary V1 theme. The dark map is documented in DESIGN_TOKENS.md
 * §3 and ships in V1.1 by remapping ONLY the semantic layer. React Native has no
 * CSS custom properties, so this module plays the role the `:root` block plays
 * in the web app: components read semantic names (`colors.colorPrimary`) and
 * never a primitive or a raw hex value.
 *
 * Breakpoints (min-width; keep in sync with docs/MOBILE_UX_SPEC.md §1 and
 * DESIGN_TOKENS.md §9): 360 / 390 / 431 / 768 / 1024.
 */

/* ===================== Primitive tokens (never used by components) ===================== */

export const palette = {
  white: '#ffffff',
  blue50: '#eff6ff',
  blue300: '#7db4ff',
  blue400: '#3b8dff',
  blue600: '#2563eb',
  blue700: '#1d4ed8',
  blue800: '#1e40af',
  sky50: '#f0f9ff',
  sky500: '#0ea5e9',
  sky700: '#0369a1',
  emerald50: '#ecfdf5',
  emerald400: '#34d399',
  emerald600: '#059669',
  emerald700: '#047857',
  amber50: '#fffbeb',
  amber400: '#fbbf24',
  amber600: '#d97706',
  amber700: '#b45309',
  red50: '#fef2f2',
  red400: '#f87171',
  red600: '#dc2626',
  red700: '#b91c1c',
  slate50: '#f8fafc',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate600: '#475569',
  slate900: '#0f172a',
  // Navy ramp — the public landing surface only (DESIGN_TOKENS §14).
  navy950: '#06111f',
  navy900: '#08182a',
  navy850: '#0b1d32',
  navy300: '#9baec4',
  navy100: '#f5f8fc',
  overlay: 'rgba(2, 6, 23, 0.55)',
} as const;

/* ===================== Semantic tokens (product-level meaning) ===================== */

export const colors = {
  // Action + accent
  colorPrimary: palette.blue600,
  colorOnPrimary: palette.white,
  colorPrimaryHover: palette.blue700,
  colorPrimaryActive: palette.blue800,
  colorPrimarySubtle: palette.blue50,
  colorSecondary: palette.sky500,

  // Feedback families
  colorSuccess: palette.emerald600,
  colorSuccessSubtle: palette.emerald50,
  colorWarning: palette.amber600,
  colorWarningSubtle: palette.amber50,
  colorDanger: palette.red600,
  colorDangerSubtle: palette.red50,
  colorInfo: palette.sky700,
  colorInfoSubtle: palette.sky50,

  // Text
  colorTextPrimary: palette.slate900,
  colorTextSecondary: palette.slate600,
  colorTextTertiary: palette.slate500,
  colorTextDisabled: palette.slate400,
  colorTextOnPrimary: palette.white,

  // Surfaces
  colorBgPage: palette.slate100,
  colorBgSurface: palette.white,
  colorBgRaised: palette.white,
  colorBgMuted: palette.slate50,

  // Borders + focus + overlay
  colorBorder: palette.slate200,
  colorBorderStrong: palette.slate300,
  colorOverlay: palette.overlay,
  colorFocusRing: palette.blue600,

  // Public landing surface (navy) — scoped, never used by product screens.
  landingBg: palette.navy900,
  landingBgDeep: palette.navy950,
  landingSurface: palette.navy850,
  landingTextPrimary: palette.white,
  landingTextSecondary: palette.navy300,
  landingAccent: palette.blue300,
  landingAccentStrong: palette.blue400,
} as const;

export type Colors = typeof colors;

/* ===================== Typography ===================== */

export const typography = {
  fontWeightRegular: '400',
  fontWeightMedium: '500',
  fontWeightSemibold: '600',
  fontWeightBold: '700',

  fontSizeDisplay: 28,
  fontSizeH1: 22,
  fontSizeH2: 18,
  fontSizeH3: 16,
  fontSizeBody: 15,
  fontSizeSmall: 13,
  fontSizeCaption: 12,
  fontSizeButton: 15,

  lineHeightDisplay: 34,
  lineHeightH1: 28,
  lineHeightH2: 24,
  lineHeightH3: 22,
  lineHeightBody: 22,
  lineHeightSmall: 18,
  lineHeightCaption: 16,
  lineHeightButton: 20,
} as const;

/* ===================== Spacing (4pt scale + usage aliases) ===================== */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,

  pagePadding: 16,
  cardPadding: 16,
  rowPaddingY: 12,
} as const;

/* ===================== Radius ===================== */

export const radius = {
  none: 0,
  sm: 6,
  control: 10,
  card: 14,
  dialog: 16,
  sheet: 20,
  full: 999,
} as const;

/* ===================== Elevation (borders first; shadows only when earned) ===================== */


/* ===================== Status vocabulary (DESIGN_TOKENS §4) ===================== */

export type ApplicationStatus =
  | 'applied'
  | 'under_review'
  | 'shortlisted'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

export interface StatusVisual {
  /** Human label. The stored enum never changes. */
  label: string;
  /** SF Symbol (iOS) / Material icon (Android) — status is never colour-only. */
  icon: { ios: string; android: string };
  fg: string;
  bg: string;
}

/** Canonical status vocabulary — never bypassed. */
export const applicationStatusVisuals: Record<ApplicationStatus, StatusVisual> = {
  applied: {
    label: 'Applied',
    icon: { ios: 'paperplane.fill', android: 'send' },
    fg: palette.sky700,
    bg: palette.sky50,
  },
  under_review: {
    label: 'Under review',
    icon: { ios: 'eye.fill', android: 'visibility' },
    fg: palette.slate600,
    bg: palette.slate100,
  },
  shortlisted: {
    label: 'Shortlisted',
    icon: { ios: 'star.fill', android: 'star' },
    fg: palette.blue600,
    bg: palette.blue50,
  },
  interview: {
    label: 'Interview',
    icon: { ios: 'calendar', android: 'event' },
    fg: palette.amber700,
    bg: palette.amber50,
  },
  offer: {
    label: 'Offer',
    icon: { ios: 'doc.text.fill', android: 'description' },
    fg: palette.emerald700,
    bg: palette.emerald50,
  },
  hired: {
    label: 'Hired',
    icon: { ios: 'checkmark.seal.fill', android: 'verified' },
    fg: palette.white,
    bg: palette.emerald700,
  },
  rejected: {
    label: 'Not selected',
    icon: { ios: 'xmark.circle.fill', android: 'cancel' },
    fg: palette.red700,
    bg: palette.red50,
  },
  withdrawn: {
    label: 'Withdrawn',
    icon: { ios: 'arrow.uturn.backward', android: 'undo' },
    fg: palette.slate500,
    bg: palette.slate50,
  },
};

export const elevation = {
  none: {},
  sm: {
    shadowColor: palette.slate900,
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: palette.slate900,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  lg: {
    shadowColor: palette.slate900,
    shadowOpacity: 0.16,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
} as const;

/* ===================== Layout + touch targets ===================== */

export const layout = {
  topbarHeight: 56,
  bottomNavHeight: 64,
  containerNarrow: 640,
  containerContent: 1024,
  // MOBILE_UX_SPEC §4: >= 48x48 primary targets, >= 44 secondary inline.
  touchTargetPrimary: 48,
  touchTargetSecondary: 44,
  inputHeight: 48,
  hitSlop: 8,
} as const;

/* ===================== Motion ===================== */

/* ===================== Motion ===================== */

export const motion = {
  durationInstant: 80,
  durationFast: 150,
  durationNormal: 200,
  durationSlow: 300,
  durationMax: 400,
} as const;

/* ===================== Assembled theme ===================== */

/**
 * Declared last so every layer above is initialised before the aggregate is
 * built. Consumers import the individual layers (`colors`, `spacing`, …) rather
 * than this object, which exists for convenience and for tests.
 */
export const theme = {
  palette,
  colors,
  typography,
  spacing,
  radius,
  elevation,
  layout,
  motion,
  applicationStatusVisuals,
} as const;

export type Theme = typeof theme;

