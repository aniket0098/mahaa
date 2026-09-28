/**
 * MediaViewer — the full-screen image viewer.
 *
 * Built from what the app already ships: a React Native `Modal`, `expo-image`,
 * the safe-area context, and a **paging `ScrollView`** for swipe navigation. No
 * new dependency, and no motion runtime: a paging ScrollView gives real swipe
 * paging on iOS, Android, and web without hand-rolled gesture maths, and it
 * keeps working with a screen reader, which a custom pan gesture does not.
 *
 * Deliberate limits:
 *
 *  - **Images only.** The feed has no video (see the stage note in the feed
 *    section), so there is no player here and no playback to stop on close.
 *  - **Explicit previous/next buttons as well as swipe.** A swipe is not
 *    reachable for every user, so the buttons carry the same action.
 *  - **A failed image says so.** The frame never sits empty, which would be
 *    indistinguishable from a slow load.
 *  - **Reduced motion is respected** — the open/close transition is dropped when
 *    the OS asks for it (`useReduceMotion`).
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { colors, spacing } from '@/theme/tokens';
import { authenticatedImageSource } from '@/api/media';
import { styles } from '@/features/feed/feedStyles';
import { clampMediaIndex, mediaCountLabel, type FeedMedia } from '@/features/feed/feedModel';
import { useReduceMotion } from '@/features/feed/useReduceMotion';

export interface MediaViewerProps {
  media: readonly FeedMedia[];
  /** Index to open at. Clamped to the list, so a stale index cannot crash. */
  index: number;
  visible: boolean;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

export function MediaViewer({ media, index, visible, onClose, onIndexChange }: MediaViewerProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const scrollRef = useRef<ScrollView>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [failedIds, setFailedIds] = useState<readonly string[]>([]);

  const safeIndex = clampMediaIndex(index, media.length);
  const current = media[safeIndex];
  const countLabel = mediaCountLabel(safeIndex, media.length);

  // Reset per-open error state, so reopening a fixed image retries it. Done in
  // the close handler rather than in an effect on `visible`: an effect that
  // calls setState synchronously forces a second render pass on every open, and
  // the close handler is the only path that actually ends a viewing session.
  const handleClose = () => {
    setFailedIds([]);
    onClose();
  };

  // Position the pager when it opens, once the stage has been measured. This one
  // is a genuine external synchronisation — a ScrollView ref, not state.
  useLayoutEffect(() => {
    if (!visible || stageWidth === 0) return;
    scrollRef.current?.scrollTo({ x: safeIndex * stageWidth, animated: false });
  }, [visible, safeIndex, stageWidth]);

  if (media.length === 0) return null;

  const hasPrevious = safeIndex > 0;
  const hasNext = safeIndex < media.length - 1;

  // The pager needs the measured width to page by exactly one image; until the
  // first layout the ScrollView is not rendered at all rather than jumping.
  const onStageLayout = (event: LayoutChangeEvent) => {
    setStageWidth(event.nativeEvent.layout.width);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={handleClose}
      statusBarTranslucent
      testID="feed-media-viewer">
      <View style={[styles.viewerRoot, { paddingTop: insets.top + spacing.sm }]}>
        <View style={[styles.viewerCloseRow, { paddingHorizontal: spacing.pagePadding }]}>
          <AppText variant="small" tone="onPrimary" style={styles.viewerCounter}>
            {countLabel ?? 'Image'}
          </AppText>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close image"
            onPress={handleClose}
            hitSlop={8}
            style={styles.viewerClose}>
            <AppIcon
              name={{ ios: 'xmark', android: 'close' }}
              size={20}
              color={colors.colorTextOnPrimary}
            />
          </Pressable>
        </View>

        <View style={styles.viewerStage} onLayout={onStageLayout}>
          {stageWidth > 0 ? (
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(event) => {
                const next = clampMediaIndex(
                  Math.round(event.nativeEvent.contentOffset.x / stageWidth),
                  media.length,
                );
                if (next !== safeIndex) onIndexChange(next);
              }}>
              {media.map((item, itemIndex) => {
                const failed = failedIds.includes(item.id);
                return (
                  <View key={item.id} style={{ width: stageWidth }}>
                    {failed ? (
                      <View style={styles.viewerStage}>
                        <AppText variant="body" tone="onPrimary">
                          This image could not be loaded.
                        </AppText>
                      </View>
                    ) : (
                      <Image
                        source={authenticatedImageSource(item.uri)}
                        style={styles.viewerImage}
                        contentFit="contain"
                        accessibilityLabel={item.alt}
                        onError={() => setFailedIds((ids) => [...ids, item.id])}
                        testID={`media-viewer-image-${itemIndex}`}
                      />
                    )}
                  </View>
                );
              })}
            </ScrollView>
          ) : null}
        </View>

        <View style={[styles.viewerNav, { paddingHorizontal: spacing.pagePadding }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous image"
            accessibilityState={{ disabled: !hasPrevious }}
            disabled={!hasPrevious}
            onPress={() => onIndexChange(safeIndex - 1)}
            style={[styles.viewerNavButton, hasPrevious ? null : viewerStyles.disabled]}>
            <AppIcon
              name={{ ios: 'chevron.left', android: 'chevron_left' }}
              size={22}
              color={hasPrevious ? colors.colorTextPrimary : colors.colorTextDisabled}
            />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next image"
            accessibilityState={{ disabled: !hasNext }}
            disabled={!hasNext}
            onPress={() => onIndexChange(safeIndex + 1)}
            style={[styles.viewerNavButton, hasNext ? null : viewerStyles.disabled]}>
            <AppIcon
              name={{ ios: 'chevron.right', android: 'chevron_right' }}
              size={22}
              color={hasNext ? colors.colorTextPrimary : colors.colorTextDisabled}
            />
          </Pressable>
        </View>

        {current ? (
          <AppText
            variant="caption"
            style={[
              styles.viewerCaption,
              { paddingBottom: insets.bottom + spacing.sm, paddingHorizontal: spacing.pagePadding },
            ]}>
            {current.alt}
          </AppText>
        ) : null}
      </View>
    </Modal>
  );
}

const viewerStyles = StyleSheet.create({
  disabled: { opacity: 0.5 },
});
