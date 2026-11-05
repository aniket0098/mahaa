/**
 * LecturePlayer — the premium video surface at the heart of the lecture
 * experience.
 *
 * `useVideoPlayer` is keyed on the source: when `videoUri` changes the hook
 * releases the old player and creates one for the new media, so curriculum
 * navigation swaps sources instead of replaying a stale stream. No autoplay
 * with sound: playback begins on a deliberate play action. Controls fade
 * during playback, reappear on tap, and stay visible when paused. Every
 * interactive control has a real behavior — nothing decorative.
 *
 * Honest states only: loading, buffering, ready, paused, playing, error.
 * No fake progress, no fabricated completion.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  GestureResponderEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  resolveExternalUrl,
  toggleFullscreen,
  useLecturePlaybackState,
} from '@/features/learn/lecturePlayerModel';
import { colors, layout, radius, spacing, typography } from '@/theme/tokens';
import type { CourseLecture } from '@/types/course';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const CONTROLS_HIDE_DELAY_MS = 3000;
const SKIP_SECONDS = 10;

// SF Symbols (iOS) / Material Symbols (Android) names keyed by intent so the
// player never passes a raw string where the icon component expects a map.
const ICONS: Record<string, { ios: string; android: string }> = {
  play: { ios: 'play.fill', android: 'play_arrow' },
  pause: { ios: 'pause.fill', android: 'pause' },
  skipBack: { ios: 'gobackward.10', android: 'replay_10' },
  skipForward: { ios: 'goforward.10', android: 'forward_10' },
  fullscreenEnter: {
    ios: 'arrow.up.left.and.arrow.down.right',
    android: 'fullscreen',
  },
  fullscreenExit: {
    ios: 'arrow.down.left.and.arrow.up.right',
    android: 'fullscreen_exit',
  },
  speed: { ios: 'chevron.right', android: 'speed' },
  close: { ios: 'xmark.circle.fill', android: 'close' },
  curriculum: { ios: 'list.bullet', android: 'book' },
  volume: { ios: 'volume.fill', android: 'volume_up' },
  volumeOff: { ios: 'volume.off.fill', android: 'volume_off' },
  link: { ios: 'link', android: 'link' },
  book: { ios: 'book.fill', android: 'book' },
};

type PlayerViewState = 'loading' | 'buffering' | 'ready' | 'error';

interface LecturePlayerProps {
  lecture: CourseLecture | null;
  videoUri: string | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onOpenExternal?: (url: string) => void;
  playbackRates?: readonly number[];
  onCurriculumPress?: () => void;
  onClose?: () => void;
}

export function LecturePlayer({
  lecture,
  videoUri,
  isLoading,
  error,
  onRetry,
  onOpenExternal,
  playbackRates = [0.5, 1, 1.25, 1.5, 2],
  onCurriculumPress,
  onClose,
}: LecturePlayerProps) {
  const player = useVideoPlayer(
    videoUri ? { uri: videoUri } : null,
    (p) => {
      p.timeUpdateEventInterval = 0.5;
      p.staysActiveInBackground = false;
      p.showNowPlayingNotification = false;
    }
  );

  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [showRateMenu, setShowRateMenu] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackWidthRef = useRef(0);
  // The `VideoView` owns the native fullscreen surface. It exposes no readable
  // fullscreen flag, so `isFullscreen` is mirrored from the view's
  // onFullscreenEnter/onFullscreenExit callbacks wired on the JSX element.
  const videoViewRef = useRef<VideoView>(null);
  // Live handles for the stable PanResponder closures below: the responder
  // objects keep one identity for the native responder system, so their
  // handlers read these refs (current at event time) instead of capturing
  // render-scope values.
  const playerRef = useRef(player);
  const canSeekRef = useRef(false);
  const durationRef = useRef(0);

  // Reactive playback: each status/playing/time event forces a render, and the
  // snapshot below is re-derived from the player's live fields at that moment.
  const playback = useLecturePlaybackState(player);

  const duration = playback.duration ?? 0;
  const currentTime = playback.currentTime ?? 0;
  const isPlaying = player.playing;
  const isBuffering = playback.isLoading && videoUri != null;

  // Resolve failures (the authenticated media API — auth, not-enrolled, 404)
  // arrive as the `error` prop; decode and network failures arrive from the
  // player itself. Both are one persistent error surface carrying the server's
  // message with Retry — never a toast.
  //
  // 'loading' is the pre-first-frame surface only: a (re)created player starts
  // 'idle', and buffering at position 0 is still initial load. Mid-play
  // buffering keeps the video surface mounted and shows the overlay instead.
  const viewState: PlayerViewState =
    error != null || playback.hasError
      ? 'error'
      : videoUri != null &&
        (playback.state === 'idle' ||
          (playback.isLoading && currentTime <= 0))
      ? 'loading'
      : 'ready';

  // --- lifecycle -----------------------------------------------------------

  useEffect(() => {
    return () => {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      player.pause();
    };
  }, [player]);

  // --- playback transitions ------------------------------------------------

  // Hides the controls a beat after playback starts, or after any control
  // action while playing. Never schedules while paused, so a paused surface
  // keeps its controls. `player.playing` is read live: a listener callback can
  // fire before React re-renders with the new `isPlaying`, so the render-scope
  // value would lag the event.
  const scheduleControlsHide = useCallback(() => {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    if (!player.playing) return;
    hideTimeout.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY_MS);
  }, [player]);

  // The tap-to-toggle responder keeps one identity across renders, so it reads
  // the latest schedule helper through this ref.
  const scheduleControlsHideRef = useRef(scheduleControlsHide);
  useEffect(() => {
    scheduleControlsHideRef.current = scheduleControlsHide;
  });

  // Every playback transition is a user-relevant moment: surface the controls
  // (and let them fade while playback runs). The state updates live in the
  // listener callbacks — updates arriving from an external system — not in the
  // effect body, which would cascade renders.
  useEffect(() => {
    const subStatus = player.addListener('statusChange', () => {
      setControlsVisible(true);
    });
    const subPlaying = player.addListener('playingChange', () => {
      setControlsVisible(true);
      if (player.playing) scheduleControlsHide();
    });
    return () => {
      subStatus.remove();
      subPlaying.remove();
    };
  }, [player, scheduleControlsHide]);

  // --- derived -------------------------------------------------------------

  const progressPercent = useMemo(() => {
    if (!duration || duration <= 0) return 0;
    return Math.min(100, (currentTime / duration) * 100);
  }, [currentTime, duration]);

  const bufferedPercent = useMemo(() => {
    if (!duration || duration <= 0) return 0;
    return Math.min(100, (player.bufferedPosition / duration) * 100);
  }, [player.bufferedPosition, duration]);

  const formatTime = useCallback(
    (seconds: number): string => {
      if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${m}:${s.toString().padStart(2, '0')}`;
    },
    []
  );

  // --- playback actions ----------------------------------------------------

  function handlePlayPause() {
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  }

  function handleSeekBackward() {
    player.seekBy(-SKIP_SECONDS);
  }

  function handleSeekForward() {
    player.seekBy(SKIP_SECONDS);
  }

  // Native fullscreen through the `VideoView` ref. `isFullscreen` is mirrored
  // from the view's onFullscreenEnter/onFullscreenExit — there is no readable
  // fullscreen flag to consult on the view itself.
  function handleFullscreen() {
    toggleFullscreen(videoViewRef, isFullscreen);
  }

  function handleRate(rate: number) {
    // expo-video's public API is property assignment on the shared native
    // player; no setter method exists. This is controller configuration,
    // not React state.
    // eslint-disable-next-line react-hooks/immutability -- expo-video API
    player.playbackRate = rate;
    setShowRateMenu(false);
    setControlsVisible(true);
    scheduleControlsHide();
  }

  function handleMuteToggle() {
    // Same expo-video property-assignment API as the rate control above.
    // eslint-disable-next-line react-hooks/immutability -- expo-video API
    player.muted = !player.muted;
    setControlsVisible(true);
    scheduleControlsHide();
  }

  // --- PanResponder for the video tap-to-toggle ----------------------------
  // PanResponder is an imperative native bridge: each responder object must
  // keep one identity for the native system, and its handlers are touch-time
  // callbacks that legitimately read live refs — not render-time reads. The
  // compiler's render-purity rules do not model responder callbacks, so they
  // are disabled across these two responder blocks.
  /* eslint-disable react-hooks/refs, react-hooks/preserve-manual-memoization */

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => false,
        onPanResponderGrant: () => {
          setControlsVisible((visible) => !visible);
          if (playerRef.current?.playing) scheduleControlsHideRef.current();
        },
      }),
    []
  );

  // --- scrubbing: tap-to-seek and drag along the timeline -----------------
  // The responder identity must stay stable for the native responder system,
  // so its handlers read live values through the refs above and seek through
  // expo-video's `seekBy` method rather than writing player fields.
  const scrubPan = useMemo(() => {
    const seekToTouch = (event: GestureResponderEvent) => {
      const current = playerRef.current;
      const width = trackWidthRef.current;
      const total = durationRef.current;
      if (!current || width <= 0 || total <= 0) return;
      const x = event.nativeEvent.locationX ?? 0;
      const ratio = Math.max(0, Math.min(1, x / width));
      current.seekBy(ratio * total - current.currentTime);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => canSeekRef.current,
      onMoveShouldSetPanResponder: () => canSeekRef.current,
      onPanResponderGrant: (event) => {
        setIsSeeking(true);
        seekToTouch(event);
      },
      onPanResponderMove: (event) => {
        seekToTouch(event);
      },
      onPanResponderRelease: () => setIsSeeking(false),
      onPanResponderTerminate: () => setIsSeeking(false),
    });
  }, []);
  /* eslint-enable react-hooks/refs, react-hooks/preserve-manual-memoization */

  // --- render --------------------------------------------------------------

  const showControls =
    controlsVisible || viewState === 'error' || viewState === 'loading';

  const canSeek = duration > 0 && !isSeeking;
  const canSkip = duration > 0;

  // Commit-sync: the stable responder closures read these at event time, so
  // they are kept current after every commit rather than during render.
  useEffect(() => {
    canSeekRef.current = canSeek;
    durationRef.current = duration;
    playerRef.current = player;
  });

  // Loading / error surfaces ------------------------------------------------

  if (viewState === 'error') {
    return (
      <View style={styles.videoContainer}>
        <View style={styles.videoSurface} {...panResponder.panHandlers}>
          <StatusBanner
            title="Couldn't play this lecture"
            description={
              error?.message ??
              'The media source could not be loaded. Check your connection and try again.'
            }
            onRetry={onRetry}
          />
          <Pressable
            accessibilityLabel="Play"
            accessibilityHint="Retry playback"
            onPress={onRetry}
            style={styles.centerPlay}
            testID="lecture-player-retry"
          >
            <AppIcon name={ICONS.play} size={48} color={colors.colorOnPrimary} />
          </Pressable>
        </View>
      </View>
    );
  }

  if (viewState === 'loading' || isLoading) {
    return (
      <View style={styles.videoContainer}>
        <View style={styles.videoSurface} {...panResponder.panHandlers}>
          <Skeleton height={(SCREEN_WIDTH * 9) / 16} width={SCREEN_WIDTH} />
          <Pressable
            accessibilityLabel="Play"
            accessibilityHint="Start playback"
            onPress={handlePlayPause}
            style={styles.centerPlay}
            testID="lecture-player-play"
          >
            <AppIcon name={ICONS.play} size={48} color={colors.colorOnPrimary} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.videoContainer, isFullscreen ? styles.fullscreen : {}]}>
      <View
        style={[styles.videoSurface, isFullscreen ? styles.fullscreenSurface : {}]}
        {...panResponder.panHandlers}
      >
        <VideoView
          ref={videoViewRef}
          player={player}
          nativeControls={false}
          contentFit="contain"
          style={styles.videoView}
          testID="lecture-player-video"
          onFullscreenEnter={() => setIsFullscreen(true)}
          onFullscreenExit={() => setIsFullscreen(false)}
        />

        {isBuffering && (
          <View style={styles.bufferingOverlay}>
            <AppText variant="caption" tone="onPrimary">
              Buffering…
            </AppText>
          </View>
        )}

        {!isPlaying && (
          <Pressable
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            accessibilityHint="Toggle playback"
            onPress={handlePlayPause}
            style={styles.centerPlay}
            testID="lecture-player-play-pause"
          >
            <AppIcon
              name={isPlaying ? ICONS.pause : ICONS.play}
              size={56}
              color={colors.colorOnPrimary}
            />
          </Pressable>
        )}

        {showControls && (
          <View style={styles.controlsContainer}>
            <View style={styles.controlsTop}>
              <Pressable
                accessibilityLabel="Close"
                accessibilityHint="Return to the course"
                onPress={onClose}
                style={styles.controlIcon}
                testID="lecture-player-close"
              >
                <AppIcon name={ICONS.close} size={24} color={colors.colorOnPrimary} />
              </Pressable>
              <View style={styles.controlsSpacer} />
              {lecture && (
                <Pressable
                  accessibilityLabel="Curriculum"
                  accessibilityHint="Open the course curriculum"
                  onPress={onCurriculumPress}
                  style={styles.controlIcon}
                  testID="lecture-player-curriculum"
                >
                  <AppIcon
                    name={ICONS.curriculum}
                    size={24}
                    color={colors.colorOnPrimary}
                  />
                </Pressable>
              )}
              <Pressable
                accessibilityLabel={
                  isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'
                }
                accessibilityHint="Toggle fullscreen playback"
                onPress={handleFullscreen}
                style={styles.controlIcon}
                testID="lecture-player-fullscreen"
              >
                <AppIcon
                  name={isFullscreen ? ICONS.fullscreenExit : ICONS.fullscreenEnter}
                  size={24}
                  color={colors.colorOnPrimary}
                />
              </Pressable>
            </View>

            <View style={styles.controlsBottom}>
              <Pressable
                accessibilityLabel="Skip backward 10 seconds"
                accessibilityHint="Rewind 10 seconds"
                onPress={handleSeekBackward}
                disabled={!canSkip}
                style={styles.controlIcon}
                testID="lecture-player-skip-back"
              >
                <AppIcon
                  name={ICONS.skipBack}
                  size={24}
                  color={canSkip ? colors.colorOnPrimary : colors.colorTextDisabled}
                />
              </Pressable>

              <View style={styles.timelineWrap}>
                <AppText variant="caption" tone="onPrimary" style={styles.timeLabel} numberOfLines={1}>
                  {formatTime(currentTime)}
                </AppText>
                <View style={styles.trackWrap}>
                  <View
                    style={styles.progressTrack}
                    onLayout={(e) => {
                      trackWidthRef.current = e.nativeEvent.layout.width;
                    }}
                  >
                    <View style={[styles.progressBuffer, { width: `${bufferedPercent}%` }]} />
                    <View style={[styles.progressPlay, { width: `${progressPercent}%` }]} />
                  </View>
                  <View style={styles.seekHit} {...scrubPan.panHandlers} />
                </View>
                <AppText variant="caption" tone="onPrimary" style={styles.timeLabel} numberOfLines={1}>
                  {formatTime(duration)}
                </AppText>
              </View>

              <Pressable accessibilityLabel="Skip forward 10 seconds" accessibilityHint="Advance 10 seconds" onPress={handleSeekForward} disabled={!canSkip} style={styles.controlIcon} testID="lecture-player-skip-forward">
                <AppIcon name={ICONS.skipForward} size={24} color={canSkip ? colors.colorOnPrimary : colors.colorTextDisabled} />
              </Pressable>
            </View>

            <View style={styles.settingsRow}>
              <Pressable accessibilityLabel="Playback speed" accessibilityHint="Select playback speed" onPress={() => setShowRateMenu(true)} style={styles.settingsItem} testID="lecture-player-rate">
                <AppIcon name={ICONS.speed} size={20} color={colors.colorOnPrimary} />
                <AppText variant="caption" tone="onPrimary" style={styles.settingsLabel}>{`${player.playbackRate.toFixed(1)}x`}</AppText>
              </Pressable>
              <Pressable accessibilityLabel={player.muted ? 'Unmute' : 'Mute'} accessibilityHint="Toggle audio" onPress={handleMuteToggle} style={styles.settingsItem} testID="lecture-player-mute">
                <AppIcon name={player.muted ? ICONS.volumeOff : ICONS.volume} size={20} color={colors.colorOnPrimary} />
              </Pressable>
            </View>

            {showRateMenu && (
              <View style={styles.rateMenu}>
                {playbackRates.map((rate) => (
                  <Pressable key={rate} accessibilityLabel={`${rate}x speed`} onPress={() => handleRate(rate)} style={[styles.rateItem, rate === player.playbackRate ? styles.rateItemSelected : null]} testID={`lecture-player-rate-${rate}`}>
                    <AppText variant="caption" tone="onPrimary">{rate.toFixed(1)}x</AppText>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * Renders a honest non-video surface for reading or external-video lectures.
 */
export function LectureNonVideoSurface({
  lecture,
  onOpenExternal,
}: {
  lecture: CourseLecture | null;
  onOpenExternal?: (url: string) => void;
}) {
  const externalUrl = lecture ? resolveExternalUrl(lecture.external_url) : null;
  const canOpen = !!externalUrl && !!onOpenExternal;

  return (
    <View style={styles.nonVideoSurface}>
      <View style={styles.nonVideoIconWrap}>
        <AppIcon
          name={lecture?.kind === 'external_video' ? ICONS.link : ICONS.book}
          size={48}
          color={colors.colorTextSecondary}
        />
      </View>
      <View style={styles.nonVideoBody}>
        <AppText variant="h3" tone="primary" weight="semibold">
          {lecture?.kind === 'external_video'
            ? 'External video'
            : 'Reading'}
        </AppText>
        <AppText variant="body" tone="secondary">
          {lecture?.kind === 'external_video'
            ? 'This lecture is hosted on an external site. Tap below to open it.'
            : 'This lecture is a reading. Open the course to view its materials.'}
        </AppText>
        {canOpen && externalUrl && (
          <Button
            label="Open in browser"
            variant="primary"
            fullWidth
            onPress={() => onOpenExternal!(externalUrl)}
            accessibilityHint="Opens the external video link"
            style={styles.openButton}
          />
        )}
        {!canOpen && (
          <AppText variant="caption" tone="tertiary">
            This lecture cannot be opened from the app.
          </AppText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  videoContainer: {
    flex: 1,
    backgroundColor: colors.colorBgMuted,
  },
  fullscreen: {
    flex: 1,
  },
  videoSurface: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenSurface: {
    position: 'relative',
  },
  videoView: {
    width: SCREEN_WIDTH,
    height: (SCREEN_WIDTH * 9) / 16,
  },
  bufferingOverlay: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.colorOverlay,
    borderRadius: radius.control,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  centerPlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: layout.touchTargetPrimary,
    height: layout.touchTargetPrimary,
    borderRadius: layout.touchTargetPrimary / 2,
    backgroundColor: colors.colorOverlay,
  },
  controlsContainer: {
    position: 'absolute',
    inset: 0,
    flexDirection: 'column',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.pagePadding,
    paddingBottom: spacing.xl,
  },
  controlsTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    marginBottom: 'auto',
  },
  controlsBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.xs,
  },
  controlIcon: {
    width: layout.touchTargetPrimary,
    height: layout.touchTargetPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlsSpacer: {
    flex: 1,
  },
  timelineWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
    maxWidth: 300,
  },
  timeLabel: {
    fontSize: typography.fontSizeCaption,
    color: colors.colorOnPrimary,
  },
  progressTrack: {
    height: 4,
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressBuffer: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  progressPlay: {
    height: 4,
    backgroundColor: colors.colorOnPrimary,
  },
  trackWrap: {
    flex: 1,
    height: 24,
    justifyContent: 'center',
  },
  seekHit: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.control,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  settingsLabel: {
    fontSize: typography.fontSizeCaption,
    color: colors.colorOnPrimary,
  },
  rateMenu: {
    position: 'absolute',
    top: 60,
    right: 0,
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingVertical: spacing.sm,
    elevation: 8,
    shadowColor: colors.colorOverlay,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    minWidth: 80,
  },
  rateItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rateItemSelected: {
    backgroundColor: colors.colorPrimarySubtle,
  },
  nonVideoSurface: {
    flex: 1,
    backgroundColor: colors.colorBgPage,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.pagePadding,
  },
  nonVideoIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.colorBgMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  nonVideoBody: {
    alignItems: 'center',
    textAlign: 'center',
    gap: spacing.sm,
    maxWidth: 280,
  },
  openButton: {
    marginTop: spacing.md,
    minHeight: layout.touchTargetPrimary,
  },
});
