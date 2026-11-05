"""LecturePlayer fix E4 — expo-video API disables + route deps warning."""
import io
import sys

P = r"C:\mahaa\src\features\learn\LecturePlayer.tsx"
S = r"C:\mahaa\src\app\(candidate)\lecture\[id].tsx"


def apply(path, repls):
    raw = io.open(path, "rb").read()
    crlf = raw.count(b"\r\n") > 0
    s = raw.decode("utf-8")
    if crlf:
        s = s.replace("\r\n", "\n")
    for old, new in repls:
        n = s.count(old)
        if n != 1:
            sys.exit("MISMATCH %s count=%d\n%r" % (path, n, old[:300]))
        s = s.replace(old, new, 1)
    io.open(path, "wb").write((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
    print("E4 applied", len(repls), "->", path)


apply(
    P,
    [
        (
            """  function handleRate(rate: number) {
    player.playbackRate = rate;
""",
            """  function handleRate(rate: number) {
    // eslint-disable-next-line react-hooks/immutability -- expo-video's public
    // API is property assignment on the shared native player; no setter method
    // exists. This is controller configuration, not React state.
    player.playbackRate = rate;
""",
        ),
        (
            """  function handleMuteToggle() {
    player.muted = !player.muted;
""",
            """  function handleMuteToggle() {
    // eslint-disable-next-line react-hooks/immutability -- same expo-video
    // property-assignment API as the rate control above.
    player.muted = !player.muted;
""",
        ),
    ],
)

apply(
    S,
    [
        (
            """      return resolveLecture({ courseId: course.id, lectureId, course });
    } catch {
      return null;
    }
  }, [course, lectureId, courseId]);
""",
            """      return resolveLecture({ courseId: course.id, lectureId, course });
    } catch {
      return null;
    }
  }, [course, lectureId]);
""",
        ),
    ],
)
