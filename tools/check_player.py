import io

p = r"C:\mahaa\src\features\learn\LecturePlayer.tsx"
s = io.open(p, encoding="utf-8").read()
lines = s.splitlines()
print("TOTAL", len(lines))
apos = chr(39)
checks = [
    ("useLecturePlaybackState(player)", True),
    ("toggleFullscreen(videoViewRef, isFullscreen)", True),
    ("ref={videoViewRef}", True),
    ("onFullscreenEnter", True),
    ("onFullscreenExit", True),
    ("error != null || playback.hasError", True),
    ("scheduleControlsHide = useCallback", True),
    # The react-compiler round replaced ref-based view state with a pure
    # state-derived surface, and kept exactly one live player handle for the
    # stable PanResponder closures.
    ("const viewState: PlayerViewState =", True),
    ("const playerRef = useRef(player)", True),
    ("useEvent", False),
    ("setViewState", False),
    # Controls surface on transitions through these two imperative listeners;
    # playback rendering subscribes through the model's useEvent, not here.
    ("player.addListener(" + apos + "statusChange" + apos, True),
    ("player.addListener(" + apos + "playingChange" + apos, True),
    ("mounted.", False),
    ("type StyleProp", False),
    ("from " + apos + "expo" + apos + ";", False),
    ("isPlayableVideo", False),
    ("requiresEnrollment", False),
    ("replaceSourceAsync", False),
    ("onLectureChange", False),
    ("const canPlay", False),
    ("const isExternal", False),
    ("no native fullscreen API", False),
    ("showSettings", False),
]
bad = 0
for name, want in checks:
    hits = [i + 1 for i, l in enumerate(lines) if name in l]
    ok = (len(hits) > 0) == want
    if not ok:
        bad += 1
    print("OK " if ok else "FAIL", ("present " if want else "absent "), repr(name), "->", hits or "NONE")
print("FAILURES:", bad)
