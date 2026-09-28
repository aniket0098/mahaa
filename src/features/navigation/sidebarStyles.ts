import { StyleSheet } from 'react-native';

import { colors, elevation, layout, radius, spacing, typography } from '@/theme/tokens';

export const SIDEBAR_WIDTH = 300;

export const sidebarStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.colorOverlay,
    zIndex: 1000,
  },
  backdropPressable: {
    ...StyleSheet.absoluteFill,
  },
  drawerContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: SIDEBAR_WIDTH,
    maxWidth: '85%',
    backgroundColor: colors.colorBgSurface,
    zIndex: 1001,
    ...elevation.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.colorBorder,
    minHeight: layout.topbarHeight,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.colorBgMuted,
  },
  menuScroll: {
    flex: 1,
  },
  menuContent: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.control,
    gap: spacing.md,
    minHeight: layout.touchTargetSecondary,
  },
  menuItemActive: {
    backgroundColor: colors.colorPrimarySubtle,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.colorBgMuted,
  },
  iconBoxActive: {
    backgroundColor: colors.colorPrimary,
  },
  menuLabel: {
    flex: 1,
    fontSize: typography.fontSizeBody,
    color: colors.colorTextPrimary,
    fontWeight: typography.fontWeightMedium,
  },
  menuLabelActive: {
    color: colors.colorPrimary,
    fontWeight: typography.fontWeightSemibold,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.colorBorder,
    marginVertical: spacing.sm,
    marginHorizontal: spacing.sm,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.colorBorder,
    backgroundColor: colors.colorBgMuted,
  },
  footerText: {
    fontSize: typography.fontSizeCaption,
    color: colors.colorTextTertiary,
  },
});
