"""LecturePlayer fix C — reactive transition effect replaces listeners. Count-checked."""
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
    print("C applied", len(repls))


R = [
    (
        """  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      player.pause();
    };
  }, [player]);

  // --- event subscriptions -------------------------------------------------

  useEffect(() => {
    const subStatus = player.addListener('statusChange', (event) => {
      if (!mounted.current) return;
      if (event.status === 'error') {
        setViewState('error');
        setControlsVisible(true);
      } else if (event.status === 'readyToPlay') {
        setViewState('ready');
      }
    });

    const subPlaying = player.addListener('playingChange', () => {
      if (!mounted.current) return;
      setControlsVisible(true);
      if (isPlaying) scheduleControlsHide();
    });

    return () => {
      subStatus.remove();
      subPlaying.remove();
    };
  }, [player, isPlaying]);
""",
        """  useEffect(() => {
    return () => {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      player.pause();
    };
  }, [player]);

  // --- playback transitions ------------------------------------------------

  // Hides the controls a beat after playback starts, or after any control
  // action while playing. Never schedules while paused, so a paused surface
  // keeps its controls.
  const scheduleControlsHide = useCallback(() => {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    if (!isPlaying) return;
    hideTimeout.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY_MS);
  }, [isPlaying]);

  useEffect(() => {
    if (playback.state === 'ready' || playback.state === 'playing') {
      hasLoadedRef.current = true;
    }
    // Every playback transition is a user-relevant moment: surface the
    // controls, and let them fade again once playback is actually running.
    setControlsVisible(true);
    if (playback.state === 'playing') scheduleControlsHide();
  }, [playback.state, scheduleControlsHide]);
""",
    ),
    (
        """  // --- controls visibility -------------------------------------------------

  function scheduleControlsHide() {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    if (!isPlaying) return;
    hideTimeout.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY_MS);
  }

  function toggleControls() {
""",
        """  // --- controls visibility -------------------------------------------------

  function toggleControls() {
""",
    ),
]

apply(P, R)
