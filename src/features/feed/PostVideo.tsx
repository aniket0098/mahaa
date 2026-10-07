/**
 * PostVideo — a playable video inside a post card.
 *
 * **Autoplay when the coordinator says this is the one video allowed to play.**
 * The slot registers as soon as the card lays out — *before* any bytes are
 * downloaded — so an unloaded video can still be chosen as active. When it
 * becomes active it downloads and starts (no tap required); when it stops being
 * active it pauses, keeping two posts from talking over each other mid-scroll.
 *
 * **Sound on native, muted on web.** Android/iOS players autoplay with audio in
 * the foreground, so the player starts unmuted there. The browser refuses
 * unmuted autoplay outright, so it starts muted in the browser only. Either way
 * only the active video is ever downloaded.
 *
 * **The bytes are fetched through the authenticated client.** `GET /media/{id}`
 * serves the file to its uploader only, so `loadPlayableVideoUri()` downloads
 * through the bearer token and the player gets the local copy. That is why there
 * is a loading state, and why the download begins the moment the slot is active.
 *
 * **The controls are ours, not the platform's.** Owning play/pause/mute is what
 * makes the "only one video plays at a time" guarantee real.
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
  /**
   * Whether this video's page is the one showing in the card's media pager.
   *
   * An off-screen page must neither register nor play: two pages of one post
   * carry the same post id, so a hidden page sharing the slot would clobber the
   * visible page's registration and play unheard — the "two videos at once"
   * outcome the coordinator exists to prevent.
   */
  current?: boolean;
}

/** The slice of a player the coordinator is allowed to drive. */
interface PlayerApi {
  play: () => void;
  pause: () => void;
}

export function PostVideo({ uri, alt, height, postId, top, current = true }: PostVideoProps) {
  const [playable, setPlayable] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  // An object url is owned by the browser and has to be released, or the blob
  // stays in memory for the whole session.
  const owned = useRef<string | null>(null);
  // The mounted player's play/pause, handed up by `VideoSurface` once it exists.
  const playerApi = useRef<PlayerApi | null>(null);
  // A tap-to-pause is sticky: the coordinator must not undo it on the next frame.
  const pausedByHand = useRef(false);
  // Whether the coordinator wants this slot playing — it can outlive a player
  // that has not been created yet (the download is still in flight).
  const wanted = useRef(false);
  // Re-entry state kept in refs so `activate`/`deactivate` stay referentially
  // stable and the coordinator is never forced to re-register on a state change.
  const loadingRef = useRef(false);
  const loadedRef = useRef(false);
  const failedRef = useRef(false);

  useEffect(
    () => () => {
      if (Platform.OS === 'web' && owned.current) {
        URL.revokeObjectURL(owned.current);
      }
    },
    [],
  );

  const load = useCallback(async () => {
    // One download at a time, and never re-fetch a source already in hand.
    if (loadingRef.current || loadedRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setFailed(false);
    failedRef.current = false;
    try {
      const local = await loadPlayableVideoUri(uri);
      if (Platform.OS === 'web') {
        if (owned.current) URL.revokeObjectURL(owned.current);
        owned.current = local;
      }
      loadedRef.current = true;
      setPlayable(local);
    } catch {
      // Deliberately generic: a 404 and a network drop mean the same thing to a
      // reader, and the server message would add nothing here.
      failedRef.current = true;
      setFailed(true);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [uri]);

  // The coordinator named this the active slot: play it, downloading first if the
  // bytes are not here yet. A sticky manual pause always wins over autoplay.
  const activate = useCallback(() => {
    if (pausedByHand.current) return;
    wanted.current = true;
    if (playerApi.current) {
      playerApi.current.play();
      setPlaying(true);
      return;
    }
    if (!loadedRef.current && !loadingRef.current && !failedRef.current) {
      void load();
    }
  }, [load]);

  const deactivate = useCallback(() => {
    wanted.current = false;
    playerApi.current?.pause();
    setPlaying(false);
  }, []);

  // Register for the whole life of the *visible* page; unregistering on unmount
  // (or when the pager pages past this video) is what frees the feed's single
  // playback slot for the next video. An off-screen page must not register: two
  // pages of one post carry the same post id, and the later registration would
  // clobber the earlier one — leaving the coordinator holding a target whose
  // owner believes it is still registered.
  useEffect(() => {
    if (!current) return undefined;

    return registerVideo({ id: postId, top, height }, { play: activate, pause: deactivate });
  }, [postId, top, height, activate, deactivate, current]);

  // Paging past this video must stop its sound even though nothing unmounted:
  // without this, the page left behind would keep talking while the newly
  // visible page starts — two videos of one post playing at once. This is
  // `deactivate()` minus its `setPlaying`, which would be a setState synchronously
  // inside an effect; the subscription above corrects `playing` instead, and it
  // re-subscribes on this same `current` flip.
  useEffect(() => {
    if (current) return;
    wanted.current = false;
    playerApi.current?.pause();
  }, [current]);

  // The coordinator only notifies when the *winner* changes, so this re-renders
  // one card rather than the whole feed. `current` is part of the answer because
  // a hidden page of a post whose visible page just won must not claim to play.
  useEffect(
    () =>
      subscribePlayback(() =>
        setPlaying(getActiveVideoId() === postId && current && !pausedByHand.current),
      ),
    [postId, current],
  );

  // Leaving the screen must stop the sound, whatever the coordinator thinks.
  useEffect(
    () => () => {
      playerApi.current?.pause();
    },
    [],
  );

  const attachPlayer = useCallback((api: PlayerApi | null) => {
    playerApi.current = api;
    // The player arrived after `activate` asked for playback: honour it now.
    if (api && wanted.current && !pausedByHand.current) {
      api.play();
      setPlaying(true);
    }
  }, []);

  const toggle = useCallback(() => {
    if (playing) {
      pausedByHand.current = true;
      playerApi.current?.pause();
      setPlaying(false);
      return;
    }
    pausedByHand.current = false;
    wanted.current = true;
    if (playerApi.current) {
      try {
        playerApi.current.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    } else {
      // A poster that never auto-loaded (it may have failed earlier): load it now.
      void load();
    }
  }, [playing, load]);

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
        playing={playing}
        onToggle={toggle}
        onAttach={attachPlayer}
        onRetry={() => {
          // Drop the source the player rejected so the next attempt re-downloads
          // rather than re-trying a URI already known to be unusable.
          setPlayable(null);
          loadedRef.current = false;
          setFailed(false);
          failedRef.current = false;
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
 * The player itself, in its own component so `useVideoPlayer` is only ever called
 * once a real source exists — the hook requires a source, and there is none until
 * the download finishes.
 *
 * It deliberately does **not** register with the coordinator: the outer `PostVideo`
 * owns that registration for the card's whole life, so an unloaded video can still
 * be chosen as active and told to download. This surface only renders the bytes,
 * hands its play/pause back through `onAttach`, and owns the mute toggle (which
 * needs the player instance).
 */
function VideoSurface({
  playable,
  alt,
  height,
  playing,
  onToggle,
  onAttach,
  onRetry,
}: {
  playable: string;
  alt: string;
  height: number;
  playing: boolean;
  onToggle: () => void;
  onAttach: (api: PlayerApi | null) => void;
  onRetry: () => void;
}) {
  const player = useVideoPlayer({ uri: playable }, (created) => {
    // Muted on web, where the browser refuses unmuted autoplay. On native the
    // platform allows a foreground video to start with audio, so it is left on —
    // applied here, before the first frame, which is the only free moment.
    created.muted = Platform.OS === 'web';
    // A short clip that stops mid-scroll looks broken rather than finished.
    created.loop = true;
  });

  const [muted, setMuted] = useState(Platform.OS === 'web');

  // Hand the coordinator a way to drive this player, and take it back on unmount.
  useEffect(() => {
    onAttach({
      play: () => {
        try {
          player.play();
        } catch {
          // Autoplay being refused by the platform is not a crash.
        }
      },
      pause: () => {
        try {
          player.pause();
        } catch {
          // A player released underneath us is not worth failing a scroll over.
        }
      },
    });
    return () => onAttach(null);
  }, [onAttach, player]);

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
          onPress={onToggle}
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
        // A player can fail *after* mounting — a decode error, a revoked source —
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
  frame: {
    alignItems: 'center',
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