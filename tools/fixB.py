"""LecturePlayer fix B — reactive snapshot + derived view state. Count-checked."""
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
    print("B applied", len(repls))


R = [
    (
        """  const [viewState, setViewState] = useState<PlayerViewState>(
    videoUri ? 'loading' : 'ready'
  );
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRateMenu, setShowRateMenu] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const trackWidthRef = useRef(0);

  const duration = player.duration ?? 0;
  const currentTime = player.currentTime ?? 0;
  const isPlaying = player.playing;
  const isBuffering = player.status === 'loading' && videoUri != null;
  const hasError = player.status === 'error';
""",
        """  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [showRateMenu, setShowRateMenu] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackWidthRef = useRef(0);
  // The `VideoView` owns the native fullscreen surface. It exposes no readable
  // fullscreen flag, so `isFullscreen` is mirrored from the view's
  // onFullscreenEnter/onFullscreenExit callbacks wired on the JSX element.
  const videoViewRef = useRef<VideoView>(null);
  // Whether the current player has ever reached 'ready'. A freshly (re)created
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
  const currentTime = playback.currentTime ?? 0;
  const isPlaying = player.playing;
  const isBuffering = playback.isLoading && videoUri != null;
""",
    ),
]

apply(P, R)
