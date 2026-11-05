"""LecturePlayer fix A — imports, header, fullscreen, dead code. Count-checked."""
import io
import sys

P = r"C:\mahaa\src\features\learn\LecturePlayer.tsx"


def apply(path, repls):
    raw = io.open(path, "rb").read()
    crlf = raw.count(b"\r\n") > 0
    s = raw.decode("utf-8")
    if crlf:
        s = s.replace("\r\n", "\n")
    for old, new in repls:
        n = s.count(old)
        if n != 1:
            sys.exit("MISMATCH count=%d\n%r" % (n, old[:300]))
        s = s.replace(old, new, 1)
    io.open(path, "wb").write((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
    print("A applied", len(repls))


R = [
    (
        """ * One `useVideoPlayer` instance for the life of the screen. No autoplay with
 * sound: playback begins on a deliberate play action. Controls fade during
 * playback, reappear on tap, and stay visible when paused. Every interactive
 * control has a real behavior — nothing decorative.
""",
        """ * `useVideoPlayer` is keyed on the source: when `videoUri` changes the hook
 * releases the old player and creates one for the new media, so curriculum
 * navigation swaps sources instead of replaying a stale stream. No autoplay
 * with sound: playback begins on a deliberate play action. Controls fade
 * during playback, reappear on tap, and stay visible when paused. Every
 * interactive control has a real behavior — nothing decorative.
""",
    ),
    (
        """  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
""",
        """  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
""",
    ),
    (
        """import {
  isPlayableVideo,
  requiresEnrollment,
  resolveExternalUrl,
  replaceSourceAsync,
  toggleFullscreen,
  useLecturePlaybackState,
} from '@/features/learn/lecturePlayerModel';
""",
        """import {
  resolveExternalUrl,
  toggleFullscreen,
  useLecturePlaybackState,
} from '@/features/learn/lecturePlayerModel';
""",
    ),
    (
        """  // This expo-video version has no native fullscreen API, so "fullscreen"
  // expands the video to fill the screen within the app instead.
  function handleFullscreen() {
    setIsFullscreen((prev) => !prev);
  }
""",
        """  // Native fullscreen through the `VideoView` ref. `isFullscreen` is mirrored
  // from the view's onFullscreenEnter/onFullscreenExit — there is no readable
  // fullscreen flag to consult on the view itself.
  function handleFullscreen() {
    toggleFullscreen(videoViewRef, isFullscreen);
  }
""",
    ),
    (
        """  const canPlay = videoUri != null && viewState !== 'error';
  const canSeek = duration > 0 && !isSeeking;
""",
        """  const canSeek = duration > 0 && !isSeeking;
""",
    ),
    (
        """  const isExternal = lecture?.kind === 'external_video';
  const externalUrl = lecture && !isPlayableVideo(lecture)
    ? resolveExternalUrl(lecture.external_url)
    : null;

  return (
""",
        """  return (
""",
    ),
    (
        """        <VideoView
          player={player}
          nativeControls={false}
          contentFit="contain"
          style={styles.videoView}
          testID="lecture-player-video"
        />
""",
        """        <VideoView
          ref={videoViewRef}
          player={player}
          nativeControls={false}
          contentFit="contain"
          style={styles.videoView}
          testID="lecture-player-video"
          onFullscreenEnter={() => setIsFullscreen(true)}
          onFullscreenExit={() => setIsFullscreen(false)}
        />
""",
    ),
    (
        """  onClose?: () => void;
  onLectureChange?: (lectureId: string) => void;
}
""",
        """  onClose?: () => void;
}
""",
    ),
    (
        """  onClose,
  onLectureChange,
}: LecturePlayerProps) {
""",
        """  onClose,
}: LecturePlayerProps) {
""",
    ),
]

apply(P, R)
