"""Model timeUpdate subscription + lecture route retry fix. Count-checked."""
import io
import sys

MODEL = r"C:\mahaa\src\features\learn\lecturePlayerModel.ts"
SCREEN = r"C:\mahaa\src\app\(candidate)\lecture\[id].tsx"


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
    print("D applied", len(repls), "->", path)


apply(
    MODEL,
    [
        (
            """  useEvent(player, 'statusChange', null);
  useEvent(player, 'playingChange', null);
""",
            """  useEvent(player, 'statusChange', null);
  useEvent(player, 'playingChange', null);
  // The elapsed/total time readouts re-render at the cadence the component
  // configures through `timeUpdateEventInterval`; the payload is not read —
  // the dispatch itself forces the snapshot re-derivation.
  useEvent(player, 'timeUpdate', null);
""",
        ),
    ],
)

apply(
    SCREEN,
    [
        (
            """          onRetry={() => {
            setIsResolving(true);
            const servedAt = lecture.media_id ? `/api/v1/media/${lecture.media_id}` : null;
            if (!servedAt) return;
            resolveLectureVideoUri(servedAt)
              .then((uri) => setVideoUri(uri))
              .catch((err) => {
                setResolveError(err instanceof Error ? err : new Error(String(err)));
                setIsResolving(false);
              });
          }}
""",
            """          onRetry={() => {
            setResolveError(null);
            setIsResolving(true);
            const servedAt = lecture.media_id ? `/api/v1/media/${lecture.media_id}` : null;
            if (!servedAt) {
              setIsResolving(false);
              return;
            }
            resolveLectureVideoUri(servedAt)
              .then((uri) => {
                setVideoUri(uri);
                setIsResolving(false);
              })
              .catch((err) => {
                setVideoUri(null);
                setResolveError(err instanceof Error ? err : new Error(String(err)));
                setIsResolving(false);
              });
          }}
""",
        ),
    ],
)
