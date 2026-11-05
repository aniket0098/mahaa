"""LecturePlayer fix E1a — state/derived block. Count-checked."""
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
    print("E1a applied", len(repls))


R = [
    (
        """  // Whether the current player has ever reached 'ready'. A freshly (re)created
  // player holds the loading surface until it is ready; mid-play buffering
  // never resets it, so the video surface stays mounted and the buffering
  // overlay handles those moments instead.
  const hasLoadedRef = useRef(false);

  // Reactive playback: each status/playing/time event forces a render, and the
  // snapshot below is re-derived from the player's live fields at that moment.
  const playback = useLecturePlaybackState(player);

  // A player (re)created for a new `videoUri` has not shown a frame yet.
  // Adjusted during render so the very first render with the new player is
  // already 'loading' — no black-frame flash while the new media prepares.
  const lastPlayerRef = useRef(player);
  if (lastPlayerRef.current !== player) {
    lastPlayerRef.current = player;
    hasLoadedRef.current = false;
  }

  // Resolve failures (the authenticated media API — auth, not-enrolled, 404)
  // arrive as the `error` prop; decode and network failures arrive from the
  // player itself. Both are one persistent error surface carrying the server's
  // message with Retry — never a toast.
  const viewState: PlayerViewState =
    error != null || playback.hasError
      ? 'error'
      : !hasLoadedRef.current &&
        (playback.isLoading || playback.state === 'idle')
      ? 'loading'
      : 'ready';

  const duration = playback.duration ?? 0;
""",
        """  // Live handles for the stable PanResponder closures below: the responder
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
""",
    ),
]

apply(P, R)
