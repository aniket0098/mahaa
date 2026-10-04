/**
 * Create Post screen styles.
 *
 * Token values only, exactly like the rest of the app: no raw hex, no literal
 * font size. The measurement rules from the design brief are encoded here rather
 * than repeated per control: primary actions are 48px, inline secondary controls
 * are at least 40px, and inputs are 48px tall.
 */

import { StyleSheet } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme/tokens';

export const composerStyles = StyleSheet.create({
  root: { backgroundColor: colors.colorBgPage, flex: 1 },
  header: {
    alignItems: 'center',
    backgroundColor: colors.colorBgSurface,
    borderBottomColor: colors.colorBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  headerTitle: { flex: 1 },
  scroll: { flex: 1 },
  content: { gap: spacing.lg, padding: spacing.pagePadding, paddingBottom: spacing.huge },

  section: { gap: spacing.md },
  sectionLabel: {
    color: colors.colorTextTertiary,
    fontSize: typography.fontSizeCaption,
    fontWeight: typography.fontWeightSemibold,
    letterSpacing: 0.06,
    textTransform: 'uppercase',
  },

  /* ------------------------------- author ---------------------------------- */
  author: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  authorText: { flex: 1, gap: 2 },

  /* ---------------------------- type selector ------------------------------ */
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeChip: {
    alignItems: 'flex-start',
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    gap: 2,
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: '31%',
  },
  typeChipActive: {
    backgroundColor: colors.colorPrimarySubtle,
    borderColor: colors.colorPrimary,
  },
  typeChipDisabled: { backgroundColor: colors.colorBgMuted, opacity: 0.7 },
  typeChipLabel: { color: colors.colorTextPrimary, fontSize: typography.fontSizeSmall },
  typeChipHint: { color: colors.colorTextTertiary, fontSize: typography.fontSizeCaption },

  /* -------------------------------- inputs --------------------------------- */
  input: {
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    color: colors.colorTextPrimary,
    fontSize: typography.fontSizeBody,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputInvalid: { borderColor: colors.colorDanger },
  textarea: { minHeight: 132, textAlignVertical: 'top' },
  inputRow: { gap: spacing.xs },
  counterRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  counterOver: { color: colors.colorDanger },

  /* --------------------------------- media --------------------------------- */
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumbnail: {
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    height: 92,
    overflow: 'hidden',
    width: 92,
  },
  /**
   * A chosen video before it is uploaded. `expo-image` cannot decode an `.mp4`,
   * so a thumbnail would be an empty square that reads as a broken image.
   */
  videoTile: {
    alignItems: 'center',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  removeButton: {
    alignItems: 'center',
    backgroundColor: colors.colorOverlay,
    borderRadius: radius.full,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 2,
    top: 2,
    width: 28,
  },
  addTile: {
    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: spacing.xs,
    height: 92,
    justifyContent: 'center',
    width: 92,
  },
  uploadRow: { gap: spacing.xs },
  uploadLine: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  progressTrack: {
    backgroundColor: colors.colorBorder,
    borderRadius: radius.full,
    height: 6,
    overflow: 'hidden',
  },
  progressFill: { backgroundColor: colors.colorPrimary, height: 6 },

  /* ------------------------------- messages -------------------------------- */
  notice: {
    borderRadius: radius.control,
    gap: spacing.xs,
    padding: spacing.md,
  },
  noticeInfo: { backgroundColor: colors.colorInfoSubtle },
  noticeWarning: { backgroundColor: colors.colorWarningSubtle },
  noticeDanger: { backgroundColor: colors.colorDangerSubtle },
  noticeSuccess: { backgroundColor: colors.colorSuccessSubtle },
  fieldError: { color: colors.colorDanger, fontSize: typography.fontSizeCaption },

  /* -------------------------------- publish -------------------------------- */
  publishBar: {
    backgroundColor: colors.colorBgSurface,
    borderTopColor: colors.colorBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  publishButton: { flex: 1 },
});
