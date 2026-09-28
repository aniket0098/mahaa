/**
 * Story viewer — the full-screen reader for the stories row.
 *
 * One viewer serves real and demo stories: the list it is handed is already
 * merged, and the differences are drawn, not branched around. A demo story adds
 * a visible DEMO chip and a title (the API has no title field), and because it
 * carries no `opportunity` it renders no "View Job" CTA — the CTA is gated on
 * the story having a real opportunity, so there is nothing to switch off.
 *
 * Progress, auto-advance, hold-to-pause and the 35/65 tap zones are unchanged,
 * and `onStoryViewed` hands the *whole story* to the caller: the screen needs to
 * see the demo marker to decide whether to record a view against the server, and
 * it cannot learn that from an id alone.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { Avatar } from '@/components/ui/Avatar';
import { colors, radius, spacing, typography } from '@/theme/tokens';
import type { StoryItem } from '@/types/story';
import { DEMO_STORY_BADGE, isDemoStory } from './demoStories';
import {
  formatStoryRelativeTime,
  getStoryTypeBadgeLabel,
  nextStoryIndex,
  prevStoryIndex,
  STORY_AUTO_ADVANCE_DURATION_MS,
} from './storyModel';

export interface StoryViewerProps {
  readonly stories: readonly StoryItem[];
  readonly initialIndex: number;
  readonly onClose: () => void;
  readonly onStoryViewed?: (story: StoryItem) => void;
  readonly onOpenOpportunity?: (opportunityId: string) => void;
}

export function StoryViewer({
  stories,
  initialIndex,
  onClose,
  onStoryViewed,
  onOpenOpportunity,
}: StoryViewerProps) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(
    Math.max(0, Math.min(initialIndex, stories.length - 1)),
  );
  const [isPaused, setIsPaused] = useState(false);

  // A lazy state initialiser, not a ref: the progress value is interpolated
  // during render, and reading a ref there is what the react-hooks lint rules
  // forbid. The instance is stable for the component's lifetime either way.
  const [progressAnim] = useState(() => new Animated.Value(0));
  const currentStory = stories[currentIndex];

  const handleNext = useCallback(() => {
    const next = nextStoryIndex(currentIndex, stories.length);
    if (next === -1) {
      onClose();
    } else {
      progressAnim.setValue(0);
      setCurrentIndex(next);
    }
  }, [currentIndex, stories.length, onClose, progressAnim]);

  const handlePrev = useCallback(() => {
    const prev = prevStoryIndex(currentIndex);
    progressAnim.setValue(0);
    setCurrentIndex(prev);
  }, [currentIndex, progressAnim]);

  useEffect(() => {
    if (currentStory && onStoryViewed) {
      onStoryViewed(currentStory);
    }
  }, [currentStory, onStoryViewed]);

  useEffect(() => {
    if (!currentStory || isPaused) {
      progressAnim.stopAnimation();
      return;
    }

    progressAnim.setValue(0);
    const anim = Animated.timing(progressAnim, {
      toValue: 1,
      duration: STORY_AUTO_ADVANCE_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    });

    anim.start(({ finished }) => {
      if (finished) {
        handleNext();
      }
    });

    return () => {
      anim.stop();
    };
  }, [currentStory, currentIndex, isPaused, handleNext, progressAnim]);

  if (!currentStory) return null;

  const publisher = currentStory.publisher;
  const isDemo = isDemoStory(currentStory);
  // A demo story may carry a label the API's content-type enum cannot express
  // ("Career info"); a real story falls back to its own content type.
  const typeBadge = currentStory.typeLabel ?? getStoryTypeBadgeLabel(currentStory.contentType);
  const relTime = formatStoryRelativeTime(currentStory.createdAt);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Top Multi-story Progress Bars */}
      <View style={styles.progressRow}>
        {stories.map((story, i) => {
          return (
            <View key={story.id} style={styles.progressBarTrack}>
              {i < currentIndex ? (
                <View style={[styles.progressBarFill, { width: '100%' }]} />
              ) : i === currentIndex ? (
                <Animated.View
                  style={[
                    styles.progressBarFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              ) : null}
            </View>
          );
        })}
      </View>

      {/* Publisher Header & Close */}
      <View style={styles.header}>
        <View style={styles.publisherInfo}>
          <Avatar src={publisher.logoUrl} name={publisher.name} size={40} />
          <View style={styles.publisherMeta}>
            <View style={styles.nameRow}>
              <Text style={styles.publisherName} numberOfLines={1}>
                {publisher.name}
              </Text>
              {isDemo && (
                <View style={styles.demoChip}>
                  <Text style={styles.demoChipText}>{DEMO_STORY_BADGE}</Text>
                </View>
              )}
              {publisher.verified && (
                <View style={styles.verifiedBadge}>
                  <AppIcon
                    name={{ ios: 'checkmark', android: 'check' }}
                    size={10}
                    color={colors.colorTextOnPrimary}
                  />
                </View>
              )}
            </View>
            <View style={styles.typeRow}>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{typeBadge}</Text>
              </View>
              <Text style={styles.timeText}>{relTime}</Text>
            </View>
          </View>
        </View>

        <Pressable
          style={styles.closeButton}
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close story">
          <AppIcon
            name={{ ios: 'xmark', android: 'close' }}
            size={22}
            color={colors.colorTextOnPrimary}
          />
        </Pressable>
      </View>

      {/* Touch Areas */}
      <View style={styles.touchArea}>
        <Pressable
          style={styles.leftTouchZone}
          onPress={handlePrev}
          onPressIn={() => setIsPaused(true)}
          onPressOut={() => setIsPaused(false)}
          accessibilityRole="button"
          accessibilityLabel="Previous story"
        />
        <Pressable
          style={styles.rightTouchZone}
          onPress={handleNext}
          onPressIn={() => setIsPaused(true)}
          onPressOut={() => setIsPaused(false)}
          accessibilityRole="button"
          accessibilityLabel="Next story"
        />

        {/* Story Card & CTA */}
        <View style={styles.cardContainer} pointerEvents="box-none">
          <View style={styles.storyCard}>
            {currentStory.title ? (
              <Text style={styles.titleText} accessibilityRole="header">
                {currentStory.title}
              </Text>
            ) : null}
            <Text style={styles.captionText}>{currentStory.caption}</Text>
          </View>

          {currentStory.opportunity && onOpenOpportunity && (
            <View style={styles.ctaContainer} pointerEvents="auto">
              <Pressable
                style={styles.ctaButton}
                onPress={() => onOpenOpportunity(currentStory.opportunity!.id)}
                accessibilityRole="button"
                accessibilityLabel={`View job: ${currentStory.opportunity.title}`}>
                <View style={styles.ctaContent}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ctaLabel}>OPPORTUNITY</Text>
                    <Text style={styles.ctaTitle} numberOfLines={1}>
                      {currentStory.opportunity.title}
                    </Text>
                  </View>
                  <View style={styles.ctaActionPill}>
                    <Text style={styles.ctaActionText}>View Job</Text>
                    <AppIcon
                      name={{ ios: 'chevron.right', android: 'chevron_right' }}
                      size={14}
                      color={colors.colorTextOnPrimary}
                    />
                  </View>
                </View>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  progressRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    gap: 4,
    height: 12,
    alignItems: 'center',
  },
  progressBarTrack: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.colorTextOnPrimary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  publisherInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  publisherMeta: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  /**
   * DEMO chip on the dark viewer surface: the same word the bubble shows, so a
   * reader who opened a demo story sees it labelled in both places.
   */
  demoChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.full,
  },
  demoChipText: {
    fontSize: 9,
    fontWeight: typography.fontWeightBold,
    letterSpacing: 0.5,
    lineHeight: 12,
    color: colors.colorTextOnPrimary,
  },
  titleText: {
    fontSize: typography.fontSizeH3,
    fontWeight: typography.fontWeightBold,
    lineHeight: typography.lineHeightH3,
    color: colors.colorTextPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  publisherName: {
    fontSize: typography.fontSizeBody,
    fontWeight: typography.fontWeightSemibold,
    color: colors.colorTextOnPrimary,
  },
  verifiedBadge: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.colorPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  typeBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.full,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeightMedium,
    color: colors.colorTextOnPrimary,
    textTransform: 'uppercase',
  },
  timeText: {
    fontSize: typography.fontSizeCaption,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  touchArea: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
  },
  leftTouchZone: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '35%',
    zIndex: 1,
  },
  rightTouchZone: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '65%',
    zIndex: 1,
  },
  cardContainer: {
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  storyCard: {
    backgroundColor: colors.colorBgSurface,
    borderRadius: radius.dialog,
    padding: spacing.xl,
    width: '100%',
    minHeight: 180,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  captionText: {
    fontSize: typography.fontSizeH3,
    fontWeight: typography.fontWeightRegular,
    color: colors.colorTextPrimary,
    lineHeight: 26,
    textAlign: 'center',
  },
  ctaContainer: {
    width: '100%',
    marginTop: spacing.lg,
  },
  ctaButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 52,
    justifyContent: 'center',
  },
  ctaContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  ctaLabel: {
    fontSize: 9,
    fontWeight: typography.fontWeightBold,
    color: colors.colorSecondary,
    letterSpacing: 0.8,
  },
  ctaTitle: {
    fontSize: typography.fontSizeBody,
    fontWeight: typography.fontWeightSemibold,
    color: colors.colorTextOnPrimary,
  },
  ctaActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.colorPrimary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    gap: 4,
  },
  ctaActionText: {
    fontSize: typography.fontSizeSmall,
    fontWeight: typography.fontWeightSemibold,
    color: colors.colorTextOnPrimary,
  },
});
