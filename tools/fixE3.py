"""LecturePlayer fix E3 — stable responders + commit-synced refs."""
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
    print("E3 applied", len(repls))


R = [
    (
        """  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => false,
        onPanResponderGrant: () => {
          toggleControls();
        },
      }),
    [toggleControls]
  );
""",
        """  const panResponder = useMemo(
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
""",
    ),
    (
        """  // --- scrubbing: tap-to-seek and drag along the timeline -----------------
  const canSeekRef = useRef(false);
  const durationRef = useRef(duration);
  durationRef.current = duration;

  const scrubPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => canSeekRef.current,
      onMoveShouldSetPanResponder: () => canSeekRef.current,
      onPanResponderGrant: (event) => {
        setIsSeeking(true);
        seekTrackToTouch(event);
      },
      onPanResponderMove: (event) => {
        seekTrackToTouch(event);
      },
      onPanResponderRelease: () => setIsSeeking(false),
      onPanResponderTerminate: () => setIsSeeking(false),
    })
  ).current;

  function seekTrackToTouch(event: GestureResponderEvent) {
    const width = trackWidthRef.current;
    const total = durationRef.current;
    if (width <= 0 || total <= 0) return;
    const x = event.nativeEvent.locationX ?? 0;
    const ratio = Math.max(0, Math.min(1, x / width));
    player.currentTime = ratio * total;
  }
""",
        """  // --- scrubbing: tap-to-seek and drag along the timeline -----------------
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
""",
    ),
    (
        """  const canSeek = duration > 0 && !isSeeking;
  canSeekRef.current = canSeek;
  const canSkip = duration > 0;
""",
        """  const canSeek = duration > 0 && !isSeeking;
  const canSkip = duration > 0;

  // Commit-sync: the stable responder closures read these at event time, so
  // they are kept current after every commit rather than during render.
  useEffect(() => {
    canSeekRef.current = canSeek;
    durationRef.current = duration;
    playerRef.current = player;
  });
""",
    ),
]

apply(P, R)
