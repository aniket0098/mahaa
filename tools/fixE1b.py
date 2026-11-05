"""LecturePlayer fix E1b — new viewState derivation. Count-checked."""
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
    print("E1b applied", len(repls))


R = [
    (
        """  const isBuffering = playback.isLoading && videoUri != null;
""",
        """  const isBuffering = playback.isLoading && videoUri != null;

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
""",
    ),
]

apply(P, R)
