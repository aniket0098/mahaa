"""LecturePlayer fix E2 — controls: live scheduling + listener updates."""
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
    print("E2 applied", len(repls))


R = [
    (
        """  // Hides the controls a beat after playback starts, or after any control
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
        """  // Hides the controls a beat after playback starts, or after any control
  // action while playing. Never schedules while paused, so a paused surface
  // keeps its controls. `player.playing` is read live: a listener callback can
  // fire before React re-renders with the new `isPlaying`, so the render-scope
  // value would lag the event.
  const scheduleControlsHide = useCallback(() => {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    if (!player.playing) return;
    hideTimeout.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY_MS);
  }, [player]);

  // The tap-to-toggle responder keeps one identity across renders, so it reads
  // the latest schedule helper through this ref.
  const scheduleControlsHideRef = useRef(scheduleControlsHide);
  useEffect(() => {
    scheduleControlsHideRef.current = scheduleControlsHide;
  });

  // Every playback transition is a user-relevant moment: surface the controls
  // (and let them fade while playback runs). The state updates live in the
  // listener callbacks — updates arriving from an external system — not in the
  // effect body, which would cascade renders.
  useEffect(() => {
    const subStatus = player.addListener('statusChange', () => {
      setControlsVisible(true);
    });
    const subPlaying = player.addListener('playingChange', () => {
      setControlsVisible(true);
      if (player.playing) scheduleControlsHide();
    });
    return () => {
      subStatus.remove();
      subPlaying.remove();
    };
  }, [player, scheduleControlsHide]);
""",
    ),
    (
        """  // --- controls visibility -------------------------------------------------

  function toggleControls() {
    setControlsVisible((prev) => !prev);
    if (!controlsVisible && isPlaying) scheduleControlsHide();
  }

""",
        "",
    ),
]

apply(P, R)
