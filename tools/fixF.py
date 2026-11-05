"""LecturePlayer fix F — disable placement + PanResponder range."""
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
    print("F applied", len(repls))


R = [
    (
        """  function handleRate(rate: number) {
    // eslint-disable-next-line react-hooks/immutability -- expo-video's public
    // API is property assignment on the shared native player; no setter method
    // exists. This is controller configuration, not React state.
    player.playbackRate = rate;
""",
        """  function handleRate(rate: number) {
    // expo-video's public API is property assignment on the shared native
    // player; no setter method exists. This is controller configuration,
    // not React state.
    // eslint-disable-next-line react-hooks/immutability -- expo-video API
    player.playbackRate = rate;
""",
    ),
    (
        """  function handleMuteToggle() {
    // eslint-disable-next-line react-hooks/immutability -- same expo-video
    // property-assignment API as the rate control above.
    player.muted = !player.muted;
""",
        """  function handleMuteToggle() {
    // Same expo-video property-assignment API as the rate control above.
    // eslint-disable-next-line react-hooks/immutability -- expo-video API
    player.muted = !player.muted;
""",
    ),
    (
        """  // --- PanResponder for the video tap-to-toggle ----------------------------

  const panResponder = useMemo(
""",
        """  // --- PanResponder for the video tap-to-toggle ----------------------------
  // PanResponder is an imperative native bridge: each responder object must
  // keep one identity for the native system, and its handlers are touch-time
  // callbacks that legitimately read live refs — not render-time reads. The
  // compiler's render-purity rules do not model responder callbacks, so they
  // are disabled across these two responder blocks.
  /* eslint-disable react-hooks/refs, react-hooks/preserve-manual-memoization */

  const panResponder = useMemo(
""",
    ),
    (
        """      onPanResponderRelease: () => setIsSeeking(false),
      onPanResponderTerminate: () => setIsSeeking(false),
    });
  }, []);
""",
        """      onPanResponderRelease: () => setIsSeeking(false),
      onPanResponderTerminate: () => setIsSeeking(false),
    });
  }, []);
  /* eslint-enable react-hooks/refs, react-hooks/preserve-manual-memoization */
""",
    ),
]

apply(P, R)
