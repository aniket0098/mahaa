/**
 * PostMedia — the image band inside a post card.
 *
 * Rules taken straight from the design brief:
 *
 *  - **Nothing is cropped.** The frame's height follows the image's own aspect
 *    ratio (via `mediaDisplayHeight`) and the image uses `contain`, so a
 *    certificate's edges and a screenshot's text are never cut off.
 *  - **One capped height.** `MAX_MEDIA_HEIGHT` stops a single tall screenshot
 *    from filling the screen.
 *  - **Multi-image posts say so.** A count pill reads "2 of 3", and the images
 *    page horizontally; the tallest image sets the band's height so the layout
 *    does not jump as you swipe.
 *  - **A failed image says so.** The frame states the failure instead of sitting
 *    blank, which would look identical to a slow load.
 *
 * Tapping any image opens the full-screen viewer at that image.
 */

import { useState } from 'react';
import { Image } from 'expo-image';
import { Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { colors } from '@/theme/tokens';
import { authenticatedImageSource } from '@/api/media';
import { styles } from '@/features/feed/feedStyles';
import { PostVideo } from '@/features/feed/PostVideo';
import { clampMediaIndex, mediaCountLabel, mediaDisplayHeight, type FeedMedia } from '@/features/feed/feedModel';

export interface PostMediaProps {
  media: readonly FeedMedia[];
  onOpen: (index: number) => void;
}

export function PostMedia({ media, onOpen }: PostMediaProps) {
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const [failedIds, setFailedIds] = useState<readonly string[]>([]);

  if (media.length === 0) return null;

  const onLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  // One height for the whole band, taken from the tallest image, so paging does
  // not resize the card underneath the reader.
  const bandHeight =
    width > 0 ? Math.max(...media.map((item) => mediaDisplayHeight(item, width))) : 0;
  const isMulti = media.length > 1;
  const countLabel = mediaCountLabel(page, media.length);

  return (
    <View style={styles.mediaStack} onLayout={onLayout} testID="feed-post-media">
      {width > 0 ? (
        <>
          <View style={[styles.mediaFrame, { height: bandHeight }]}>
            <ScrollView
              horizontal
              pagingEnabled={isMulti}
              scrollEnabled={isMulti}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(event) => {
                const next = clampMediaIndex(
                  Math.round(event.nativeEvent.contentOffset.x / width),
                  media.length,
                );
                setPage(next);
              }}>
              {media.map((item, index) => {
                const failed = failedIds.includes(item.id);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole={item.kind === "video" ? "button" : "imagebutton"}
                    accessibilityLabel={
                      item.kind === "video"
                        ? item.alt
                        : `Open image ${index + 1} of ${media.length}. ${item.alt}`
                    }
                    // A video plays in place. Sending it to the image viewer
                    // would hand a `.mp4` to `expo-image`, which renders nothing
                    // at all — a blank frame that reads as a broken post.
                    onPress={item.kind === "video" ? undefined : () => onOpen(index)}
                    style={{ width }}>
                    {failed ? (
                      <View style={[styles.mediaError, { height: bandHeight }]}>
                        <AppIcon
                          name={{ ios: 'photo', android: 'image' }}
                          size={20}
                          color={colors.colorTextTertiary}
                        />
                        <AppText variant="small" tone="secondary">
                          This image could not be loaded.
                        </AppText>
                      </View>
                    ) : item.kind === "video" ? (
                      <PostVideo uri={item.uri} alt={item.alt} height={bandHeight} />
                    ) : (
                      <Image
                        source={authenticatedImageSource(item.uri)}
                        style={styles.mediaImage}
                        contentFit="contain"
                        accessibilityLabel={item.alt}
                        onError={() => setFailedIds((ids) => [...ids, item.id])}
                        testID={`feed-post-image-${index}`}
                      />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {isMulti ? (
            <View style={styles.mediaCountPill}>
              <AppIcon
                name={{ ios: 'photo.on.rectangle', android: 'photo_library' }}
                size={14}
                color={colors.colorTextOnPrimary}
              />
              <AppText variant="caption" style={styles.mediaCountText}>
                {countLabel}
              </AppText>
            </View>
          ) : null}
        </>
      ) : (
        // Before the first layout there is no width to size the band with, so an
        // empty muted block holds the space instead of the card jumping.
        <View style={[styles.mediaFrame, { height: 180 }]} />
      )}
    </View>
  );
}
