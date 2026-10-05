"""Phase 12 live verification — two real accounts, one real socket.

**Not a unit test.** This drives the running API over HTTP and WebSocket exactly
as the app does, and it is what proves the two claims the unit suite can only
argue about:

1. a real WebSocket opened with a real JWT receives ``post.created`` /
   ``story.created`` published by **another** account, and
2. the media bytes that account uploaded are then readable by the recipient
   through the authenticated ``GET /media/{id}`` route — which answered 404
   before this phase.

Run it against a **running local** API. It creates no schema and deletes no user
data; it only reads and writes through the public API.

    python backend/tools/verify_content_sync.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
import zlib

BASE = os.environ.get("MAHAA_API", "http://localhost:8000/api/v1").rstrip("/")

#: What each check answered. A `PASS` here is an observation against the running
#: server, never an assertion about intent.
RESULTS: list[tuple[str, str, str]] = []

#: Unique per run, so a repeated run against the shared development database
#: cannot count an earlier run's rows as its own.
TAP_MARKER = f"tapped twice {uuid.uuid4().hex[:8]}"


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, "PASS" if ok else "FAIL", detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{(' - ' + detail) if detail else ''}")


def request(
    method: str,
    path: str,
    token: str | None = None,
    body: dict | None = None,
    content: bytes | None = None,
    content_type: str | None = None,
) -> tuple[int, bytes]:
    """One HTTP call. Returns the status and raw body; never raises."""
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode() if body is not None else content,
        method=method,
    )
    if content_type:
        req.add_header("Content-Type", content_type)
    elif body is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()
    except Exception as exc:  # noqa: BLE001 - a transport failure is a result
        return 0, str(exc).encode()


def png() -> bytes:
    """A real 1x1 PNG, so the server's magic-byte sniffing accepts it."""

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            len(payload).to_bytes(4, "big")
            + kind
            + payload
            + zlib.crc32(kind + payload).to_bytes(4, "big")
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(
            b"IHDR",
            (1).to_bytes(4, "big") + (1).to_bytes(4, "big") + b"\x08\x06\x00\x00\x00",
        )
        + chunk(b"IDAT", zlib.compress(b"\x00" + b"\xff\x00\x00\x00"))
        + chunk(b"IEND", b"")
    )


def mp4() -> bytes:
    """An ISO base-media header, which is what the server's sniffer recognises.

    Not a decodable movie — the backend has no decoder and publishes
    ``video_duration_enforced: false``. What matters here is that the *container*
    is real, so the bytes prove the sniff/ownership path rather than a shortcut.
    """
    return b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00" + b"\x00" * 16


def signup(label: str) -> tuple[str, str]:
    """A real account through the real route. Returns ``(token, email)``.

    **A real-looking domain, deliberately.** `SignupRequest.email` goes through
    `email-validator`, which rejects reserved TLDs such as `.invalid` and `.test`
    — so an address that is obviously synthetic is refused before the account
    exists. Every account this creates is a throwaway on a domain that accepts no
    mail.
    """
    stamp = uuid.uuid4().hex[:12]
    email = f"verify.{label}.{stamp}@example.com"
    status, raw = request(
        "POST",
        "/auth/signup",
        body={
            "name": f"Verify {label}",
            "email": email,
            "password": "Passw0rd!2026",
            "phone": None,
            "role": "candidate",
        },
    )
    if status != 201:
        raise SystemExit(f"signup for {label} failed: {status} {raw!r}")
    return json.loads(raw)["access_token"], email


async def collect(ws_url: str, token: str, wanted: list[str], timeout: float = 15.0):
    """Open a real socket and gather the first event in ``wanted`` that arrives."""
    import websockets

    seen: list[dict] = []
    try:
        async with websockets.connect(f"{ws_url}?token={token}") as socket:
            while True:
                try:
                    frame = await asyncio.wait_for(socket.recv(), timeout=timeout)
                except TimeoutError:
                    break
                event = json.loads(frame)
                seen.append(event)
                if event.get("event_type") in wanted:
                    # Drain briefly so a sibling event is not missed, then stop.
                    deadline = asyncio.get_running_loop().time() + 2.0
                    while asyncio.get_running_loop().time() < deadline:
                        try:
                            extra = await asyncio.wait_for(
                                socket.recv(),
                                timeout=deadline - asyncio.get_running_loop().time(),
                            )
                        except TimeoutError:
                            break
                        seen.append(json.loads(extra))
                    break
    except Exception as exc:  # noqa: BLE001 - a handshake failure is a result
        return seen, f"{type(exc).__name__}: {exc}"
    return seen, None


async def main() -> int:
    # `/ws` is part of the route, exactly as the app's `socketUrlFor` builds it:
    # the API base already ends in `/api/v1`, and the socket route hangs off it.
    # Omitting it produced a 403 at the router, not an auth failure — which is a
    # useful reminder that a refused handshake says nothing about the token.
    ws_base = BASE.replace("https://", "wss://").replace("http://", "ws://") + "/ws"

    print("== two real accounts ==")
    author, _ = signup("author")
    reader, reader_email = signup("reader")
    check("two real accounts created", bool(author and reader))

    # --- User B opens a socket and stays connected while User A publishes ----
    print("\n== User B opens a socket ==")
    collector = asyncio.create_task(
        collect(ws_base, reader, ["post.created", "story.created"])
    )
    # Give the handshake time to land, so the publish below is not the very first
    # frame the socket sees and the check cannot distinguish "arrived" from
    # "connected too late".
    await asyncio.sleep(3.0)

    print("\n== User A publishes ==")
    status, raw = request(
        "POST", "/media?kind=image", author, content=png(), content_type="image/png"
    )
    media_id = json.loads(raw)["id"] if status == 201 else None
    check("User A uploaded an image", status == 201, f"media {media_id}")

    status, raw = request(
        "POST",
        "/posts",
        author,
        body={
            "kind": "image",
            "category": "community",
            "body": "A post for the realtime check",
            "media_ids": [media_id],
        },
    )
    post = json.loads(raw) if status == 201 else {}
    check("User A created an image post", status == 201, f"post {post.get('id')}")

    status, raw = request(
        "POST",
        "/stories",
        author,
        body={
            "content_type": "announcement",
            "caption": "A story for the realtime check",
            "media_id": media_id,
        },
    )
    story = json.loads(raw) if status == 201 else {}
    check("User A created a story", status == 201, f"story {story.get('id')}")

    events, error = await collector
    types = [e.get("event_type") for e in events]

    print("\n== realtime delivery to User B ==")
    check(
        "User B's socket opened",
        "connection.opened" in types,
        f"error: {error}" if error else f"types: {types}",
    )
    check("User B received post.created", "post.created" in types, f"types: {types}")
    check("User B received story.created", "story.created" in types, f"types: {types}")

    created = next((e for e in events if e.get("event_type") == "post.created"), None)
    if created is not None:
        payload = created.get("payload", {})
        check(
            "the post event names the row and carries no content",
            payload.get("post_id") == post.get("id") and "body" not in payload,
            f"payload keys: {sorted(payload)}",
        )
        check(
            "the post event has no recipient (it is a fan-out)",
            created.get("recipient_user_id") is None,
        )

    # --- cross-user reads: REST, then the media bytes ------------------------
    print("\n== User B reads User A's content over REST ==")
    status, raw = request("GET", "/posts?limit=50", reader)
    feed = json.loads(raw) if status == 200 else {"items": []}
    found = next(
        (p for p in feed.get("items", []) if p.get("id") == post.get("id")), None
    )
    check("User B sees the post in the feed", found is not None)
    check(
        "it is attributed to its author, and is_self is false for User B",
        bool(found) and found["author"].get("is_self") is False,
        f"author: {found['author'].get('username') if found else 'n/a'}",
    )

    status, raw = request("GET", "/stories", reader)
    stories = json.loads(raw) if status == 200 else {"items": []}
    check(
        "User B sees the story in the tray",
        any(s.get("id") == story.get("id") for s in stories.get("items", [])),
    )

    print("\n== the media bytes (the original 404) ==")
    status, raw = request("GET", f"/media/{media_id}", reader)
    check(
        "User B can read User A's media bytes",
        status == 200 and raw[:8] == b"\x89PNG\r\n\x1a\n",
        f"status {status}, {len(raw)} bytes",
    )
    status, _ = request("GET", f"/media/{media_id}")
    check("an anonymous caller still cannot", status == 401, f"status {status}")

    print("\n== video: the same path, end to end ==")
    video = mp4()
    status, raw = request(
        "POST", "/media?kind=video", author, content=video, content_type="video/mp4"
    )
    video_media = json.loads(raw)["id"] if status == 201 else None
    check("User A uploaded a video", status == 201, f"media {video_media}")
    status, raw = request(
        "POST",
        "/posts",
        author,
        body={
            "kind": "video",
            "category": "community",
            "body": "A video for the realtime check",
            "media_ids": [video_media],
        },
    )
    video_post = json.loads(raw) if status == 201 else {}
    check("User A created a video post", status == 201, f"post {video_post.get('id')}")
    check(
        "the server derived the video kind from the bytes",
        video_post.get("kind") == "video",
        f"kind: {video_post.get('kind')}",
    )
    status, raw = request("GET", f"/media/{video_media}", reader)
    check(
        "User B can read the video bytes",
        status == 200 and raw == video,
        f"status {status}, {len(raw)} bytes",
    )
    status, raw = request(
        "POST",
        "/media?kind=image",
        author,
        content=video,
        content_type="image/png",
    )
    check(
        "a video declared as an image is still refused (magic bytes)",
        status == 422,
        f"status {status}",
    )

    print("\n== text and project posts ==")
    status, raw = request(
        "POST",
        "/posts",
        author,
        body={"kind": "text", "category": "community", "body": "Just words."},
    )
    check("a text post is created", status == 201, f"post {json.loads(raw).get('id')}")
    status, raw = request(
        "POST",
        "/posts",
        author,
        body={
            "kind": "project",
            "category": "projects",
            "body": "A project",
            "project": {"title": "Mahaa"},
        },
    )
    check(
        "a project post is created",
        status == 201,
        f"post {json.loads(raw).get('id')}",
    )

    print("\n== duplicate prevention is the client's job, and it holds there ==")
    # The server has no idempotency key for this route, so two requests make two
    # rows. The guard is the client's — the composer's disabled Publish and the
    # story screen's `publishing` ref — which are asserted by unit tests. What is
    # verified here is that the API does **not** silently collapse two posts into
    # one: if it did, a duplicate in the UI would be invisible and the client
    # guard would be papering over a server-side merge.
    #
    # Scoped to *this run's* author, because the development database is shared and
    # an earlier run's identically-worded posts are in it too.
    me = json.loads(request("GET", "/auth/me", author)[1])
    for _ in range(2):
        request(
            "POST",
            "/posts",
            author,
            body={"kind": "text", "category": "community", "body": TAP_MARKER},
        )
    after_items = json.loads(request("GET", "/posts?limit=50", author)[1])["items"]
    mine = [
        p
        for p in after_items
        if p.get("body") == TAP_MARKER and p["author"].get("username") == me["username"]
    ]
    check(
        "two requests make two rows (so the client guard is what prevents duplicates)",
        len(mine) == 2,
        f"{len(mine)} rows authored by {me['username']}",
    )

    print("\n== reconnect recovery (the socket is only an optimisation) ==")
    # User B's socket was closed by the collector. A post published *after* that
    # cannot reach it, which is exactly the offline case: the content must still
    # be there on the next REST read, because there is no event log to replay.
    status, raw = request(
        "POST",
        "/posts",
        author,
        body={
            "kind": "text",
            "category": "community",
            "body": f"published while offline {TAP_MARKER}",
        },
    )
    missed = json.loads(raw).get("id") if status == 201 else None
    check("a post published while User B is offline is created", bool(missed))
    status, raw = request("GET", "/posts?limit=50", reader)
    recovered = [
        p
        for p in json.loads(raw).get("items", [])
        if p.get("id") == missed
    ]
    check(
        "User B recovers it over REST without any event",
        len(recovered) == 1,
        "this is what the client's reconnect catch-up invalidates",
    )

    print("\n== later login, no realtime involved ==")
    # over a socket, which is the "REST is the source of truth" claim.
    late, _ = signup("latecomer")
    status, raw = request("GET", "/posts?limit=50", late)
    late_feed = json.loads(raw) if status == 200 else {"items": []}
    check(
        "an account created after the post still sees it",
        any(p.get("id") == post.get("id") for p in late_feed.get("items", [])),
    )
    status, raw = request("GET", "/stories", late)
    check(
        "and still sees the story",
        status == 200
        and any(
            s.get("id") == story.get("id")
            for s in json.loads(raw).get("items", [])
        ),
    )
    status, raw = request("GET", "/auth/me", reader_email and reader)
    check("User B's own session is still valid", status == 200)

    print("\n" + "=" * 62)
    failed = [r for r in RESULTS if r[1] == "FAIL"]
    print(f"{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    for name, _, detail in failed:
        print(f"  FAILED: {name} - {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
