/**
 * StoryMediaLayer — the media half of the story viewer: exactly one layer for
 * the one visible story.
 *
 * **One visible story = one active player.** The viewer renders this component
 * with `key={story.id}:{generation}`, so moving to the next story *unmounts*
 * the current layer before mounting the next: the download promise is
 * cancelled, the `expo-video` player is released with its host view, every
 * event subscription is removed, and any pending fallback timer dies with the
 * interval's cleanup. Nothing is shared between stories, so no two players can
 * ever fight over one surface — which is what keeps Android memory stable
 * through A1 → A2 → A3 → B1 → … .
 *
 * **Completion is the player's own event, not a timer.** A video story ends on
 * `playToEnd` — the actual end of the actual bytes — and reports progress from
 * `timeUpdate` against `player.duration`. Timers appear only in
 * {@link StoryStaticLayer}, where an image or text story has no completion
 * event to listen for, which is the "carefully controlled fallback" the spec
 * allows.
 *
 * **Failure is a state, never a crash.** A download failure, a decode error
 * (`player.status === 'error'`) and an image decode failure all land on the
 * same overlay — "Unable to play this story / Tap to retry" — and the retry
 * re-downloads rather than re-trying a source already proven unusable. The
 * viewer underneath stays alive; one corrupt story cannot block the rest.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';

import { absoluteMediaUri, authenticatedImageSource, loadPlayableVideoUri } from '@/api/media';
import { colors, spacing, typography } from '@/theme/tokens';
import type { StoryItem } from '@/types/story';
import { STORY_FALLBACK_DURATION_MS } from './storyGroups';

export interface StoryMediaLayerCallbacks {
  readonly paused: boolean;
  readonly onProgress: (fraction: number) => void;
  readonly onComplete: () => void;
  readonly onPlayError: () => void;
}

/**
 * What a story-media subscriber always needs, live and mounted-stable.
 *
 * A `playToEnd` or interval closure that captured stale props would advance
 * against an old position, and re-subscribing the native listeners on every
 * render churns the listener list. The bundle below is a stable object whose
 * members always forward the *newest* props, so subscriptions register once
 * and keep working.
 */
export function useStoryLayerCallbacks({
  paused,
  onProgress,
  onComplete,
  onPlayError,
  onErrorState,
  onRefresh,
}: StoryMediaLayerCallbacks & {
  readonly onErrorState?: (failed: boolean) => void;
  readonly onRefresh?: () => void;
}): {
  readonly current: {
    readonly paused: boolean;
    onProgress: (fraction: number) => void;
    onComplete: () => void;
    onPlayError: () => void;
    setErrored: (failed: boolean) => void;
    refresh: () => void;
  };
} {
  const onProgressRef = useRef(onProgress);
  const onCompleteRef = useRef(onComplete);
  const onPlayErrorRef = useRef(onPlayError);
  const onErrorStateRef = useRef(onErrorState);
  const onRefreshRef = useRef(onRefresh);
  const pausedRef = useRef(paused);
  // `useLayoutEffect` is atomic by wall-clock scheduling: it runs after DOM
  // mutations but *before* the browser paints, so refs updated here are
  // observable in effects (which run after paint) but never *during* render.
  useLayoutEffect(() => {
    onProgressRef.current = onProgress;
    onCompleteRef.current = onComplete;
    onPlayErrorRef.current = onPlayError;
    onErrorStateRef.current = onErrorState;
    onRefreshRef.current = onRefresh;
    pausedRef.current = paused;
  });
  // Memoized so the object identity never changes (no subscription churn) and
  // every method reads the newest value from the layout-updated refs.
  const bundle = useMemo(
    () => ({
      current: {
        get paused() {
          return pausedRef.current;
        },
        onProgress: (fraction: number) => onProgressRef.current(fraction),
        onComplete: () => onCompleteRef.current(),
        onPlayError: () => onPlayErrorRef.current(),
        setErrored: (failed: boolean) => onErrorStateRef.current?.(failed),
        refresh: () => onRefreshRef.current?.(),
      },
    }),
    [],
  );
  return bundle;
}

export interface StoryMediaLayerProps {
  readonly story: StoryItem;
  /** True while the app is backgrounded or the user is holding a tap zone. */
  readonly paused: boolean;
  /** Reports 0..1 progress within *this* story; the viewer draws segments. */
  readonly onProgress: (fraction: number) => void;
  /** Fired exactly once when this story's media finishes (guarded upstream). */
  readonly onComplete: () => void;
}

/** Chooses the layer by what the story actually carries. No hooks of its own. */
export function StoryMediaLayer(props: StoryMediaLayerProps) {
  const media = props.story.media;
  if (media?.kind === 'video') {
    return <StoryVideoLayer {...props} mediaUri={media.uri} />;
  }
  return <StoryStaticLayer {...props} />;
}

/* ============================== video ============================== */

function StoryVideoLayer({
  story,
  mediaUri,
  paused,
  onProgress,
  onComplete,
}: StoryMediaLayerProps & { readonly mediaUri: string }) {
  // One lifecycle state, fed by the download promise below. `attempt` is
  // bumped by both retry paths so the effect re-runs: a failed download
  // retries the request, a failed decode drops the source first so the bytes
  // are fetched fresh instead of re-trying a URI known to be bad.
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [playable, setPlayable] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const completion = { finished: false };
    loadPlayableVideoUri(mediaUri)
      .then((local) => {
        if (completion.finished) return;
        setPlayable(local);
        // Not a second set of the same value: `playable` was null here, and
        // the download is an async lifecycle (mount → bytes → ready), so this
        // is the "bytes arrived" transition the surface mounts on.
        setPhase('ready');
      })
      .catch(() => {
        // Deliberately generic for the user (a 404 and a network drop mean the
        // same thing to a reader); the technical detail lives in the console
        // during development only.
        if (__DEV__) {
          console.warn('[story] media download failed', mediaUri);
        }
        if (completion.finished) return;
        setPhase('failed');
      });
    return () => {
      completion.finished = true;
    };
  }, [mediaUri, attempt]);

  const retry = useCallback(() => {
    // The download effect keys on `attempt`: bumping it retriggers the fetch
    // and the effect's own lifecycle (loading → ready/failed) redraws the
    // surface. No `setPlayable(null)` here — the old bytes stay mounted until
    // the new ones are in hand.
    setAttempt((current) => current + 1);
  }, []);

  if (phase === 'failed') {
    return (
      <ErrorOverlay
        onPress={retry}
        testID="story-video-download-error"
        message="Unable to play this story"
      />
    );
  }

  if (phase !== 'ready' || !playable) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.surface]} testID="story-video-loading">
        <ActivityIndicator color={colors.colorTextOnPrimary} size="large" />
        <Text style={styles.loadingText}>Loading story…</Text>
      </View>
    );
  }

  return (
    <StoryVideoSurface
      // Keyed on the resolved source: swapping it unmounts the old player
      // *before* the new one mounts, so exactly one player ever exists.
      key={playable}
      playable={playable}
      paused={paused}
      onProgress={onProgress}
      onComplete={onComplete}
      onPlayError={retry}
    />
  );
}

/**
 * The `expo-video` player itself, mounted only once real bytes exist (the
 * hook requires a source, and there is none until the download finishes).
 *
 * Callbacks arrive through refs updated on every render: `player.addListener`
 * is registered exactly once per player, while the viewer's `goToNextStory`
 * identity may change between renders — a listener closed over a stale prop
 * would advance against an old position.
 */
function StoryVideoSurface({
  playable,
  paused,
  onProgress,
  onComplete,
  onPlayError,
}: {
  readonly playable: string;
  readonly paused: boolean;
  readonly onProgress: (fraction: number) => void;
  readonly onComplete: () => void;
  readonly onPlayError: () => void;
}) {
  const player = useVideoPlayer({ uri: playable }, (created) => {
    created.loop = false;
    // Drives `timeUpdate`, which drives the segment progress bar.
    created.timeUpdateEventInterval = 250;
  });

  // `player.status` is a shared native object that does not re-render React on
  // its own, so readiness and failure are mirrored into component state below.
  // The `statusChange` event feeds that state continuously — necessary, because
  // by the time `useVideoPlayer` returns, status may already have moved past
  // `loading`, and a check that only reads the property once could strand the
  // surface on a spinner after the player has failed.
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');

  // Completion and progress are bound through the bundle — registered once,
  // always live.
  const callbacks = useStoryLayerCallbacks({
    paused,
    onProgress,
    onComplete,
    onPlayError,
    onErrorState: (failed) => setPhase(failed ? 'failed' : 'ready'),
    onRefresh: () => {
      if (player.status === 'error') {
        setPhase('failed');
      } else if (player.status === 'readyToPlay' || player.duration > 0) {
        setPhase('ready');
      }
    },
  });

  useEffect(() => {
    const ended = player.addListener('playToEnd', () => {
      callbacks.current.onComplete();
    });
    const tick = player.addListener('timeUpdate', (event) => {
      const duration = player.duration;
      if (duration > 0) {
        callbacks.current.onProgress(Math.min(1, event.currentTime / duration));
      }
    });
    const status = player.addListener('statusChange', (event) => {
      if (event.status === 'error') {
        callbacks.current.setErrored(true);
      } else if (event.status === 'readyToPlay') {
        callbacks.current.setErrored(false);
      }
    });
    return () => {
      ended.remove();
      tick.remove();
      status.remove();
    };
  }, [player, callbacks]);

  // One ready-to-play check: before the subscriptions above attached, `status`
  // may already have moved (or failed), and without this a failure with no
  // fresh event would freeze the layer on a spinner.
  useEffect(() => {
    callbacks.current.refresh();
  }, [player, callbacks]);

  const errored = phase === 'failed' || (phase === 'ready' && player.status === 'error');

  // Background/hold pause — the completion event cannot fire while paused, so
  // playback never advances while the user is looking at something else.
  useEffect(() => {
    try {
      if (paused) {
        player.pause();
      } else {
        player.play();
      }
    } catch {
      // A player released underneath us is not worth failing the viewer over.
    }
  }, [player, paused]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          // Cover, never stretch: a portrait clip on a portrait phone fills the
          // story surface with a centre crop, and a landscape one crops the sides.
          contentFit="cover"
          nativeControls={false}
          accessibilityLabel="Story video"
          testID="story-video-view"
        />
      </View>

      {errored ? (
        // A player can fail *after* mounting (a decode error, a bad container)
        // which no download error path would catch — the surface says so
        // instead of freezing on the first frame.
        <ErrorOverlay
          onPress={onPlayError}
          testID="story-video-play-error"
          message="Unable to play this story"
        />
      ) : null}
    </View>
  );
}

/* ======================= image & text (fallback timing) ======================= */

/**
 * An image or text story: rendered directly, advancing on a monotonic
 * interval — the *only* timer in the story system, because these media kinds
 * have no completion event to wait for. The interval accumulates wall-clock
 * time only while unpaused (backgrounding or a held tap freezes it), reports
 * progress, fires `onComplete` once, and is cleared on unmount: leaving this
 * layer mid-story cancels any pending advance by construction.
 */
function StoryStaticLayer({ story, paused, onProgress, onComplete }: StoryMediaLayerProps) {
  const media = story.media;
  const [imageFailed, setImageFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Same live-bundle contract as the video surface: the interval registers
  // once, but forwards the newest callbacks.
  const callbacks = useStoryLayerCallbacks({
    paused,
    onProgress,
    onComplete,
    onPlayError: () => {},
  });

  // A render branch, not an effect: the *stories* timer owns a genuine
  // lifecycle (interval on mount, cleared on unmount), so it must still be an
  // effect — but image failure is derived when the flag flips, without
  // clearing and restarting the interval a retry depends on.
  useEffect(() => {
    let elapsedMs = 0;
    let last = Date.now();
    let finished = false;

    const interval = setInterval(() => {
      const now = Date.now();
      if (!callbacks.current.paused) elapsedMs += now - last;
      last = now;
      if (finished) return;
      const fraction = elapsedMs / STORY_FALLBACK_DURATION_MS;
      if (fraction >= 1) {
        finished = true;
        callbacks.current.onComplete();
      } else {
        callbacks.current.onProgress(fraction);
      }
    }, 120);

    return () => clearInterval(interval);
  }, [story.id, attempt, callbacks]);

  if (media?.kind === 'image') {
    if (imageFailed) {
      return (
        <ErrorOverlay
          onPress={() => setAttempt((current) => current + 1)}
          testID="story-image-error"
          message="Unable to play this story"
        />
      );
    }
    return (
      <View style={StyleSheet.absoluteFill}>
        <Image
          key={`${media.uri}:${attempt}`}
          source={authenticatedImageSource(absoluteMediaUri(media.uri))}
          style={StyleSheet.absoluteFill}
          // Cover, never stretch — same rule as the video surface.
          contentFit="cover"
          transition={150}
          onError={() => {
            if (__DEV__) console.warn('[story] image failed', media.uri);
            setImageFailed(true);
          }}
          accessibilityLabel={story.caption || 'Story image'}
          testID="story-image-view"
        />
      </View>
    );
  }

  // Text-only story: a quiet brand surface behind the caption. No placeholder
  // image, no invented artwork — just the dark viewer background.
  return <View style={[StyleSheet.absoluteFill, styles.surface]} testID="story-text-surface" />;
}

/* ============================== shared states ============================== */

/** The one failure surface: honest words, a real retry, never a crash. */
function ErrorOverlay({
  message,
  onPress,
  testID,
}: {
  readonly message: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${message}. Tap to retry`}
      onPress={onPress}
      style={[StyleSheet.absoluteFill, styles.errorOverlay]}
      testID={testID}>
      <Text style={styles.errorTitle}>{message}</Text>
      <Text style={styles.errorRetry}>Tap to retry</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: colors.colorTextPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeCaption,
    opacity: 0.85,
  },
  errorOverlay: {
    alignItems: 'center',
    backgroundColor: colors.colorOverlay,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  errorTitle: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeBody,
    fontWeight: typography.fontWeightSemibold,
    textAlign: 'center',
  },
  errorRetry: {
    color: colors.colorTextOnPrimary,
    fontSize: typography.fontSizeCaption,
    opacity: 0.85,
  },
});


