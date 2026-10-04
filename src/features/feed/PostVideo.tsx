/**
 * PostVideo — a playable video inside a post card.
 *
 * **Nothing here downloads until the reader asks for it.** Mounting a player for
 * every video in a feed would pull every one of those files over the network
 * before anybody chose one, so the resting state is a plain frame with a play
 * button. The authenticated download only starts on that tap. That is also why
 * there is no poster image: the API has no thumbnail for a video, and a blurred
 * first frame would need the bytes we are refusing to fetch.
 *
 * **Why the bytes are fetched before playing.** `GET /media/{id}` serves the file
 * to its uploader only, and no video player can attach a bearer token. So
 * `loadPlayableVideoUri()` fetches the file through the authenticated client and
 * hands the player a local copy. Playback therefore starts only once the file has
 * fully arrived — a real limitation of authenticating media reads, documented on
 * that function rather than hidden here.
 *
 * **The controls are ours, not the platform's.** `nativeControls` would give a
 * nicer scrubber, but expo-video exposes no way to observe that the user pressed
 * play inside it, and "only one video plays at a time" depends on knowing when a
 * player starts. Owning the play, pause and mute calls is what makes that
 * guarantee real instead of aspirational.
 *
 * **Honest states only.** The frame says "Loading video", "This video could not
 * be loaded", or offers playback. It never claims the file was verified,
 * accepted, or duration-checked, because none of those happened on the client.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { loadPlayableVideoUri } from '@/api/media';
import { colors, radius, spacing } from '@/theme/tokens';

export interface PostVideoProps {
  /** The media's served path, as stored on the feed post. */
  uri: string;
  /** Describes the video for a screen reader. */
  alt: string;
  /** Height the band already reserved, so the card does not jump when it loads. */
  height: number;
}

/**
 * The one player allowed to be playing.
 *
 * A module-level singleton because the players live in separate component
 * instances that never see each other, and "two videos talking over each other"
 * is the default outcome otherwise.
 */
let activePlayer: VideoPlayer | null = null;

function claimPlayback(player: VideoPlayer): void {
  if (activePlayer && activePlayer !== player) {
    try {
      activePlayer.pause();
    } catch {
      // A player released underneath us is not worth failing a tap over.
    }
  }
  activePlayer = player;
}

function releasePlayback(player: VideoPlayer): void {
  if (activePlayer === player) activePlayer = null;
}

export function PostVideo({ uri, alt, height }: PostVideoProps) {
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
        <AppText variant="small" tone="secondary">
          This video could not be loaded.
        </AppText>
      </View>
    );
  }

  if (playable) {
    return <VideoSurface playable={playable} alt={alt} height={height} />;
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
 */
function VideoSurface({
  playable,
  alt,
  height,
}: {
  playable: string;
  alt: string;
  height: number;
}) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  const player = useVideoPlayer(
    { uri: playable },
    (created) => {
      // Starts muted so nothing can make noise before the reader has decided
      // they want to hear it.
      created.muted = true;
      created.loop = false;
    },
  );

  useEffect(() => () => releasePlayback(player), [player]);

  const toggle = useCallback(() => {
    if (playing) {
      player.pause();
      releasePlayback(player);
      setPlaying(false);
      return;
    }
    claimPlayback(player);
    player.play();
    setPlaying(true);
  }, [player, playing]);

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
