/**
 * PostVideo — a playable video inside a post card.
 *
 * **Autoplay, but only when the feed coordinator says this is the one video
 * allowed to play.** Visibility is measured by `feedPlayback.ts` rather than
 * guessed here: a video begins when roughly half of it is on screen and stops
 * when it is not, which keeps two posts from talking over each other mid-scroll.
 *
 * **Muted by default, and that is a platform requirement, not a preference.**
 * Every mobile browser and both native platforms refuse to autoplay a video with
 * sound. So `muted` starts `true`, the player is configured muted before its first
 * frame, and the reader unmutes deliberately. `loop` is on so a short clip does
 * not end mid-scroll.
 *
 * **The bytes are still fetched through the authenticated client.** `GET /media/{id}`
 * serves the file to its uploader only and there is no unsigned variant, so no
 * player can be handed a URL it can open directly. `loadPlayableVideoUri()`
 * downloads through the bearer token and the player gets the local copy. That is
 * why there is a loading state at all, and why the download only starts once the
 * card is visible.
 *
 * **A failure says what failed.** The retry frame reads "Couldn't play this
 * video / Tap to retry" — never anything about an image, because the two are
 * different failures and a wrong message sends the reader looking in the wrong
 * place.
 *
 * **The controls are ours, not the platform's.** `nativeControls` would give a
 * nicer scrubber, but expo-video exposes no way to observe that the user pressed
 * play inside it, and "only one video plays at a time" depends on knowing when a
 * player starts. Owning play/pause/mute is what makes that guarantee real.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { loadPlayableVideoUri } from '@/api/media';
import {
  getActiveVideoId,
  registerVideo,
  subscribePlayback,
} from '@/features/feed/feedPlayback';
import { colors, radius, spacing } from '@/theme/tokens';

export interface PostVideoProps {
  /** The media's served path, as stored on the feed post. */
  uri: string;
  /** Describes the video for a screen reader. */
  alt: string;
  /** Height the band already reserved, so the card does not jump when it loads. */
  height: number;
  /**
   * Stable id the feed playback coordinator keys on — the post id, so one video
   * per post is unambiguous. Anything else would let two cards claim one slot.
   */
  postId: string;
  /** Top of this frame within the scroll content, measured by the card. */
  top: number;
}

export function PostVideo({ uri, alt, height, postId, top }: PostVideoProps) {
  const [playable, setPlayable] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // An object url is owned by the browser and has to be released, or the blob
  // stays in memory for the whole session.
  const owned = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (Platform.OS === 'web' && owned.current) {
        URL.revokeObjectURL(owned.current);
      }
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const local = await loadPlayableVideoUri(uri);
      if (Platform.OS === 'web') {
        if (owned.current) URL.revokeObjectURL(owned.current);
        owned.current = local;
      }
      setPlayable(local);
    } catch {
      // Deliberately generic: a 404 and a network drop mean the same thing to a
      // reader, and the server message would add nothing here.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [uri]);
  if (failed) {
    return (
      <View style={[styles.frame, { height }]} testID="feed-post-video-error">
        <AppIcon
          name={{ ios: 'exclamationmark.triangle', android: 'warning' }}
          size={20}
          color={colors.colorTextTertiary}
        />
        <AppText variant="small" tone="secondary" style={styles.errorText}>
          Couldn&apos;t play this video
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry video"
          onPress={load}
          hitSlop={8}
          style={styles.retryButton}
          testID="feed-post-video-retry">
          <AppText variant="small" weight="semibold" tone="accent">
            Tap to retry
          </AppText>
        </Pressable>
      </View>
    );
  }

  if (playable) {
    return (
      <VideoSurface
        playable={playable}
        alt={alt}
        height={height}
        postId={postId}
        top={top}
        onRetry={() => {
          // Drop the source the player rejected so the next attempt re-downloads
          // rather than re-trying a URI already known to be unusable.
          setPlayable(null);
          setFailed(false);
          void load();
        }}
      />
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play video. ${alt}`}
      accessibilityHint="Downloads and plays this video"
      accessibilityState={{ busy: loading }}
      disabled={loading}
      onPress={load}
      style={[styles.frame, { height }]}
      testID="feed-post-video-poster">
      <View style={styles.playCircle}>
        {loading ? (
          <View style={styles.spinner} />
        ) : (
          <AppIcon
            name={{ ios: 'play.fill', android: 'play_arrow' }}
            size={26}
            color={colors.colorTextOnPrimary}
          />
        )}
      </View>
      <AppText variant="small" tone="secondary">
        {loading ? 'Loading video' : 'Tap to play'}
      </AppText>
    </Pressable>
  );
}

/**
 * The player itself, in its own component so `useVideoPlayer` is only ever
 * called once a real source exists — the hook requires a source, and there is
 * none until the download finishes.
 *
 * **Two things drive playback here, and they are deliberately different.**
 * Visibility is not this component's business: it registers with the feed
 * coordinator and plays or pauses when asked. A tap, by contrast, is *this*
 * component's business, because the reader asked for something no amount of
 * scrolling should override — so a manual pause is sticky until the reader
 * presses play again, rather than being undone by the next scroll frame.
 *
 * That sticky flag is what stops the worst autoplay annoyance there is: scrolling
 * past a video you deliberately paused and having it start again when you scroll
 * back.
 */
function VideoSurface({
  playable,
  alt,
  height,
  postId,
  top,
  onRetry,
}: {
  playable: string;
  alt: string;
  height: number;
  postId: string;
  top: number;
  onRetry: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  // Set when the reader pauses by hand. While true, visibility changes do not
  // resume playback. Cleared only by pressing play again.
  const pausedByHand = useRef(false);

  const player = useVideoPlayer(
    { uri: playable },
    (created) => {
      // Muted before the first frame: every platform refuses unmuted autoplay,
      // and this is the only moment the setting can be applied for free.
      created.muted = true;
      // A short clip that stops mid-scroll looks broken rather than finished.
      created.loop = true;
    },
  );

  const play = useCallback(() => {
    if (pausedByHand.current) return;
    try {
      player.play();
      setPlaying(true);
    } catch {
      // Autoplay being refused by the platform is not a crash; the frame stays
      // paused and the reader can still press play.
    }
  }, [player]);

  const pause = useCallback(() => {
    try {
      player.pause();
    } catch {
      // A player released underneath us is not worth failing a scroll over.
    }
    setPlaying(false);
  }, [player]);

  // Register with the coordinator, and re-register when the measured position
  // moves. The returned unsubscribe runs on unmount, which is what stops a
  // vanished card from holding the feed's single playback slot.
  useEffect(() => {
    const unregister = registerVideo({ id: postId, top, height }, { play, pause });
    return unregister;
  }, [postId, top, height, play, pause]);

  // The coordinator only notifies when the *winner* changes, so this re-renders
  // one card rather than the whole feed.
  useEffect(
    () => subscribePlayback(() => setPlaying(getActiveVideoId() === postId)),
    [postId],
  );

  // Leaving the screen must stop the sound, whatever the coordinator thinks.
  useEffect(() => () => pause(), [pause]);

  const toggle = useCallback(() => {
    if (player.playing) {
      pausedByHand.current = true;
      pause();
      return;
    }
    // A manual press overrides a previous manual pause, and also re-claims the
    // slot: the coordinator may believe another video owns playback right now.
    pausedByHand.current = false;
    try {
      player.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }, [pause, player]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      player.muted = !current;
      return !current;
    });
  }, [player]);

  return (
    <View style={[styles.frame, { height }]} testID="feed-post-video">
      {/* Pointer events are off so the controls below stay reachable. */}
      <View style={styles.player} pointerEvents="none">
        <VideoView
          player={player}
          style={styles.playerInner}
          contentFit="contain"
          nativeControls={false}
          accessibilityLabel={alt}
          testID="feed-post-video-view"
        />
      </View>

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause video' : 'Play video'}
          accessibilityState={{ selected: playing }}
          onPress={toggle}
          hitSlop={8}
          style={styles.controlButton}
          testID="feed-post-video-toggle">
          <AppIcon
            name={
              playing
                ? { ios: 'pause.fill', android: 'pause' }
                : { ios: 'play.fill', android: 'play_arrow' }
            }
            size={20}
            color={colors.colorTextOnPrimary}
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
          accessibilityState={{ selected: muted }}
          onPress={toggleMute}
          hitSlop={8}
          style={styles.controlButton}
          testID="feed-post-video-mute">
          <AppIcon
            name={
              muted
                ? { ios: 'speaker.slash.fill', android: 'volume_off' }
                : { ios: 'speaker.wave.2.fill', android: 'volume_up' }
            }
            size={18}
            color={colors.colorTextOnPrimary}
          />
        </Pressable>
      </View>

      {player.status === 'error' ? (
        // A player can fail *after* mounting - a decode error, a revoked source -
        // which no error boundary around the download would catch. The frame says
        // so instead of leaving a frozen first frame on screen.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry video"
          onPress={onRetry}
          style={styles.playErrorOverlay}
          testID="feed-post-video-play-error">
          <AppText variant="small" style={styles.playErrorText}>
            Couldn&apos;t play this video
          </AppText>
          <AppText variant="caption" style={styles.playErrorRetry}>
            Tap to retry
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  player: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  playerInner: { height: '100%', width: '100%' },
  /** The download-failure frame: an icon, a sentence, and a real retry target. */
  errorText: { textAlign: 'center' },
  retryButton: {
    alignItems: 'center',
    borderColor: colors.colorBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  /**
   * The same message as `errorText`, but for a player that mounted and *then*
   * failed. It covers the surface rather than sitting in the middle, because the
   * frozen frame underneath it is what the reader needs to stop seeing.
   */
  playErrorOverlay: {
    alignItems: 'center',
    backgroundColor: colors.colorOverlay,
    bottom: 0,
    gap: spacing.xs,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  playErrorText: { color: colors.colorTextOnPrimary },
  playErrorRetry: { color: colors.colorTextOnPrimary, opacity: 0.85 },
  playCircle: {
    alignItems: 'center',
    backgroundColor: colors.colorPrimary,
    borderRadius: radius.full,
    height: 56,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    width: 56,
  },
  spinner: {
    backgroundColor: colors.colorTextOnPrimary,
    borderRadius: radius.full,
    height: 20,
    opacity: 0.8,
    width: 20,
  },
  controls: {
    bottom: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
    position: 'absolute',
    right: spacing.sm,
  },
  controlButton: {
    alignItems: 'center',
    backgroundColor: colors.colorOverlay,
    borderRadius: radius.full,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
});
