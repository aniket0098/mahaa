/**
 * Lecture poster tile — the visual anchor of the featured and feed cards.
 *
 * **A placeholder on purpose, never a fake photograph.** A course thumbnail or
 * lecture media on the server is a *pointer id*, and `GET /media/{id}` serves
 * the bytes only to the uploader, so one reader's lecture card cannot show
 * another creator's uploaded poster (the same reason `CourseCard` renders a
 * neutral tile). The tile is therefore a clean, brand-token gradient with a
 * kind-appropriate affordance — a play mark for the two video kinds, a book
 * for reading — at a fixed 16:9 ratio, so nothing is ever distorted.
 *
 * The duration chip renders **only** when the server supplied
 * `duration_seconds`: NULL means unknown, and unknown is shown as nothing.
 */

import { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { isVideoLecture } from '@/features/learningHub/learningHubModel';
import { colors, radius, spacing } from '@/theme/tokens';
import type { LectureKind } from '@/types/course';

export interface LecturePosterProps {
  kind: LectureKind;
  /** Preformatted by `formatLectureDuration`; `null` shows no chip at all. */
  durationLabel?: string | null;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
}

const KIND_ICON: Record<LectureKind, { ios: string; android: string }> = {
  hosted_video: { ios: 'play.fill', android: 'play_arrow' },
  external_video: { ios: 'play.circle', android: 'play_circle' },
  reading: { ios: 'book', android: 'book' },
};

export function LecturePoster({ kind, durationLabel, iconSize = 28, style }: LecturePosterProps) {
  const affordance: ReactNode = (
    <AppIcon name={KIND_ICON[kind]} size={iconSize} color={colors.colorOnPrimary} />
  );

  return (
    <View style={[styles.poster, style]} accessibilityElementsHidden importantForAccessibility="no">
      {isVideoLecture(kind) ? (
        <LinearGradient
          colors={[colors.colorPrimary, colors.colorPrimaryHover]}
          style={styles.fill}>
          <View style={styles.affordance}>{affordance}</View>
        </LinearGradient>
      ) : (
        <View style={[styles.fill, styles.readingSurface]}>
          <View style={styles.affordance}>
            <AppIcon name={KIND_ICON[kind]} size={iconSize} color={colors.colorTextTertiary} />
          </View>
        </View>
      )}

      {durationLabel ? (
        <View style={styles.durationChip}>
          <AppText variant="caption" weight="medium" tone="onPrimary">
            {durationLabel}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  poster: {
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: colors.colorBgMuted,
  },
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readingSurface: {
    backgroundColor: colors.colorBgMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.colorBorder,
  },
  affordance: {
    // The play/book mark never covers the title area; the chip is the only
    // text on the tile.
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationChip: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    backgroundColor: colors.colorOverlay,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
});
