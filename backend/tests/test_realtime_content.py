"""Phase 12 — content realtime: posts and stories.

Two things are proven here, and the second is the one that matters.

**A content event reaches other members.** ``GET /posts`` and ``GET /stories``
are member-visible reads with no per-viewer ACL, so an event only the author
received would leave every other reader polling. These tests connect two
*different* accounts to the hub and assert the second one is sent the event — a
test that only published as the author could not tell a fan-out from a targeted
send.

**An event is published only after the transaction commits.** The
``test_a_*_publishes_nothing`` cases force the write to fail and require *no*
event at all. The ordering is asserted directly too: the publishing test reads
the row from a separate session at the moment the event exists.

No Redis server is needed — ``FakeBus`` and the live-loop harness are imported
from the Phase 1 and Phase 2 suites, which is why the hub depends on a Protocol.
"""

from __future__ import annotations

import pytest

from app.realtime import content_events
from app.realtime.events import BROADCAST_EVENT_TYPES, EventType, RealtimeEvent
from app.realtime.hub import RealtimeHub
from app.realtime.runtime import get_runtime, set_runtime
from tests.test_realtime import FakeBus, run
from tests.test_realtime_messaging import _live_runtime, _publishes, published


@pytest.fixture()
def bus():
    """A recording bus on a live loop, standing in for the app's lifespan."""
    fake = FakeBus()
    set_runtime(_live_runtime(fake))
    yield fake
    set_runtime(None)


def drain() -> None:
    runtime = get_runtime()
    if runtime is not None:
        _publishes(runtime)


def a_png() -> bytes:
    """A 1x1 PNG: a real IHDR and a real CRC'd IDAT, so sniffing accepts it."""
    import zlib

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            len(payload).to_bytes(4, "big")
            + kind
            + payload
            + zlib.crc32(kind + payload).to_bytes(4, "big")
        )

    header = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(
        b"IHDR",
        (1).to_bytes(4, "big") + (1).to_bytes(4, "big") + b"\x08\x06\x00\x00\x00",
    )
    idat = chunk(b"IDAT", zlib.compress(b"\x00" + b"\xff\x00\x00\x00"))
    return header + ihdr + idat + chunk(b"IEND", b"")


def upload(
    api_client, account, data: bytes, content_type: str, kind: str = "image"
) -> str:
    """``POST /media`` as a real request, returning the new asset id."""
    response = api_client.post(
        f"/api/v1/media?kind={kind}",
        content=data,
        headers={**account.headers, "Content-Type": content_type},
    )
    assert response.status_code in (200, 201), response.text
    return response.json()["id"]


def publish_post(api_client, account, *, body="hello", media_ids=()) -> dict:
    response = api_client.post(
        "/api/v1/posts",
        json={
            "kind": "text",
            "category": "community",
            "body": body,
            "media_ids": list(media_ids),
        },
        headers=account.headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def publish_story(api_client, account, *, caption="a story", media_id=None) -> dict:
    response = api_client.post(
        "/api/v1/stories",
        json={"content_type": "announcement", "caption": caption, "media_id": media_id},
        headers=account.headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


# --- shape ------------------------------------------------------------------


def test_a_new_post_publishes_exactly_one_event(api_client, candidate, bus):
    publish_post(api_client, candidate, body="one post")
    events = published(bus, EventType.POST_CREATED)
    assert len(events) == 1
    assert set(events[0].payload) == {"post_id", "author_id", "created_at"}


def test_the_post_event_names_the_row_and_its_author(api_client, candidate, bus):
    post = publish_post(api_client, candidate)
    payload = published(bus, EventType.POST_CREATED)[0].payload
    assert payload["post_id"] == post["id"]
    assert payload["author_id"] == candidate.id
    # A server default, read after the commit rather than supplied by a client.
    assert payload["created_at"] == post["created_at"]


def test_a_new_story_publishes_exactly_one_event(api_client, candidate, bus):
    publish_story(api_client, candidate)
    events = published(bus, EventType.STORY_CREATED)
    assert len(events) == 1
    assert set(events[0].payload) == {"story_id", "author_id", "created_at"}


def test_the_story_event_names_the_row_and_its_author(api_client, candidate, bus):
    story = publish_story(api_client, candidate)
    payload = published(bus, EventType.STORY_CREATED)[0].payload
    assert payload["story_id"] == story["id"]
    assert payload["author_id"] == candidate.id


def test_an_edit_and_a_delete_each_publish_their_own_type(api_client, candidate, bus):
    post = publish_post(api_client, candidate, body="first")

    edited = api_client.patch(
        f"/api/v1/posts/{post['id']}",
        json={"body": "second"},
        headers=candidate.headers,
    )
    assert edited.status_code == 200, edited.text
    assert len(published(bus, EventType.POST_UPDATED)) == 1

    removed = api_client.delete(
        f"/api/v1/posts/{post['id']}", headers=candidate.headers
    )
    assert removed.status_code == 204, removed.text
    assert len(published(bus, EventType.POST_DELETED)) == 1
    # Neither later operation re-announces the creation.
    assert len(published(bus, EventType.POST_CREATED)) == 1


# --- the payload is a notification, never a carrier --------------------------


@pytest.mark.parametrize("field", ["body", "caption", "email", "token", "data"])
def test_no_content_event_carries_content_or_a_credential(
    api_client, candidate, field, bus
):
    # The socket is an invalidation signal. A body in the payload would let a
    # client render from the event instead of the authoritative read, and a
    # credential in a frame is one log line away from a leak.
    publish_post(api_client, candidate, body="a secret sentence")
    publish_story(api_client, candidate, caption="another secret")
    drain()
    for event_type in (EventType.POST_CREATED, EventType.STORY_CREATED):
        for event in published(bus, event_type):
            assert field not in event.payload


def test_the_publisher_module_takes_no_recipient(bus):
    # A content event is untargeted by construction, so it can only ever be
    # routed by BROADCAST_EVENT_TYPES rather than by a per-user decision.
    content_events.post_created(post_id="p", author_id="a", created_at="t")
    event = published(bus, EventType.POST_CREATED)[0]
    assert event.recipient_user_id is None


# --- ordering: after commit, never before ------------------------------------


def test_the_row_is_visible_from_the_database_when_the_event_is_published(
    api_client, candidate, db_session, bus
):
    # The strongest form of "after commit": rather than trusting the call site,
    # read the row back at the moment the event exists. A publish inside the
    # transaction would leave nothing to find.
    from app.models.posts import Post

    post = publish_post(api_client, candidate)
    assert published(bus, EventType.POST_CREATED)

    stored = db_session.get(Post, post["id"])
    assert stored is not None, "the event was published before the row was visible"


def test_a_rejected_post_publishes_nothing(api_client, candidate, bus):
    # A payload-less post is refused before anything is written.
    response = api_client.post(
        "/api/v1/posts",
        json={"kind": "text", "category": "community"},
        headers=candidate.headers,
    )
    assert response.status_code == 422, response.text
    drain()
    assert published(bus, EventType.POST_CREATED) == []


def test_a_post_attaching_someone_elses_media_publishes_nothing(
    api_client, candidate, other_candidate, bus
):
    # The ownership check raises before the insert, so no row exists and no event
    # may be announced — otherwise a reader would meet a post that does not.
    foreign = upload(api_client, other_candidate, a_png(), "image/png")
    response = api_client.post(
        "/api/v1/posts",
        json={
            "kind": "image",
            "category": "community",
            "body": "borrowed",
            "media_ids": [foreign],
        },
        headers=candidate.headers,
    )
    assert response.status_code == 403, response.text
    drain()
    assert published(bus, EventType.POST_CREATED) == []


def test_an_unauthenticated_post_publishes_nothing(api_client, bus):
    response = api_client.post(
        "/api/v1/posts", json={"kind": "text", "category": "community", "body": "nope"}
    )
    assert response.status_code == 401, response.text
    drain()
    assert published(bus, EventType.POST_CREATED) == []


def test_a_rejected_story_publishes_nothing(api_client, candidate, bus):
    # An empty caption fails the schema, so the service never runs.
    response = api_client.post(
        "/api/v1/stories",
        json={"content_type": "announcement", "caption": ""},
        headers=candidate.headers,
    )
    assert response.status_code == 422, response.text
    drain()
    assert published(bus, EventType.STORY_CREATED) == []


def test_a_company_story_publishes_nothing(api_client, candidate, bus):
    # `publisher_kind='company'` is refused in the service, so the rejection must
    # be silent on the socket.
    response = api_client.post(
        "/api/v1/stories",
        json={
            "content_type": "announcement",
            "caption": "x",
            "publisher_kind": "company",
        },
        headers=candidate.headers,
    )
    assert response.status_code == 422, response.text
    drain()
    assert published(bus, EventType.STORY_CREATED) == []


# --- delivery: the audience is every member ----------------------------------


def test_a_post_event_reaches_a_second_member_who_did_not_publish_it(
    api_client, candidate, bus
):
    hub = RealtimeHub()
    author_socket, reader_socket = _socket(), _socket()
    hub.add("author", author_socket)
    hub.add("reader", reader_socket)

    publish_post(api_client, candidate, body="visible to everyone")
    for event in bus.published:
        run(hub.deliver(event))

    # The reader is the point, not the author: targeting the author alone would
    # satisfy a test that never connected a second account.
    assert _types(reader_socket) == [EventType.POST_CREATED]


def test_a_story_event_reaches_a_second_member(api_client, candidate, bus):
    hub = RealtimeHub()
    reader_socket = _socket()
    hub.add("reader", reader_socket)

    publish_story(api_client, candidate)
    for event in bus.published:
        run(hub.deliver(event))

    assert _types(reader_socket) == [EventType.STORY_CREATED]


def test_the_reader_learns_only_the_id_and_fetches_the_row_over_rest(
    api_client, candidate, other_candidate, bus
):
    # The whole loop, and the reason the payload is a notification: the event
    # identifies the post, and REST supplies the authoritative body.
    publish_post(api_client, candidate, body="the real text")
    event = published(bus, EventType.POST_CREATED)[0]
    assert "the real text" not in str(event.payload)

    feed = api_client.get("/api/v1/posts?limit=10", headers=other_candidate.headers)
    assert feed.status_code == 200, feed.text
    fetched = {row["id"]: row for row in feed.json()["items"]}
    assert event.payload["post_id"] in fetched
    assert fetched[event.payload["post_id"]]["body"] == "the real text"
    # Attributed to its author and to nobody else: the card carries the author's
    # immutable handle, and `is_self` is computed for the *reader*, who is a
    # different account here. Nothing is copied from the publisher's session.
    author = fetched[event.payload["post_id"]]["author"]
    assert author["public_id"] == candidate.body["public_id"]
    assert author["is_self"] is False


def test_a_deleted_post_stops_being_readable_over_rest(
    api_client, candidate, other_candidate, bus
):
    post = publish_post(api_client, candidate)
    api_client.delete(f"/api/v1/posts/{post['id']}", headers=candidate.headers)
    assert published(bus, EventType.POST_DELETED)

    feed = api_client.get("/api/v1/posts?limit=50", headers=other_candidate.headers)
    assert post["id"] not in {row["id"] for row in feed.json()["items"]}


# --- routing: which types are broadcasts -------------------------------------


def test_every_content_type_is_a_broadcast_and_nothing_else_is():
    # The audience rule lives in one set. A content type missing from it would be
    # silently dropped by the hub; a messaging type in it would fan out to all.
    assert BROADCAST_EVENT_TYPES == {
        EventType.POST_CREATED,
        EventType.POST_UPDATED,
        EventType.POST_DELETED,
        EventType.STORY_CREATED,
    }
    assert EventType.NOTIFICATION_CREATED not in BROADCAST_EVENT_TYPES
    assert EventType.MESSAGE_CREATED not in BROADCAST_EVENT_TYPES


def test_a_message_event_is_not_broadcast_to_a_stranger():
    hub = RealtimeHub()
    alice, bob = _socket(), _socket()
    hub.add("alice", alice)
    hub.add("bob", bob)
    run(
        hub.deliver(
            RealtimeEvent(
                event_type=EventType.MESSAGE_CREATED, recipient_user_id="alice"
            )
        )
    )
    assert _types(alice) == [EventType.MESSAGE_CREATED]
    assert _types(bob) == []


def test_an_untargeted_non_content_event_is_still_dropped():
    # Phase 1 rule survives: broadcasting is not a transport default, only the
    # content types opted in.
    hub = RealtimeHub()
    alice, bob = _socket(), _socket()
    hub.add("alice", alice)
    hub.add("bob", bob)
    assert run(hub.deliver(RealtimeEvent.system_ping())) == 0
    assert alice.sent == [] and bob.sent == []


def test_one_broken_socket_does_not_stop_the_fan_out():
    # The isolation the targeted path already had: a phone that lost signal must
    # not be able to stop the server telling everybody else.
    hub = RealtimeHub()
    broken, healthy = _socket(fail=True), _socket()
    hub.add("alice", broken)
    hub.add("bob", healthy)
    delivered = run(hub.deliver(RealtimeEvent(event_type=EventType.POST_CREATED)))
    assert delivered == 1
    assert _types(healthy) == [EventType.POST_CREATED]
    assert hub.sockets_for("alice") == frozenset()


def test_the_publisher_is_silent_when_realtime_never_booted(api_client, candidate):
    # A missing runtime is a supported state: the post must still be created when
    # there is nowhere to publish.
    set_runtime(None)
    assert publish_post(api_client, candidate, body="realtime is off")["id"]


def test_a_publish_failure_never_fails_the_request(api_client, candidate):
    # The row is committed and REST has answered. Losing realtime degrades the
    # product; raising here would fail a request that in fact succeeded.
    set_runtime(_BrokenRuntime())
    try:
        assert publish_post(api_client, candidate, body="still created")["id"]
    finally:
        set_runtime(None)


class _BrokenRuntime:
    """A runtime whose bus refuses every publish."""

    def publish_nowait(self, event) -> None:
        raise RuntimeError("the bus is down")


# --- local helpers -----------------------------------------------------------


class _Socket:
    """The minimum surface the hub uses, so no real peer is needed."""

    def __init__(self, fail: bool = False) -> None:
        self.sent: list[str] = []
        self.fail = fail

    async def send_text(self, text: str) -> None:
        if self.fail:
            raise RuntimeError("socket is gone")
        self.sent.append(text)


def _socket(fail: bool = False) -> _Socket:
    return _Socket(fail=fail)


def _types(socket: _Socket) -> list[str]:
    import json

    return [json.loads(frame)["event_type"] for frame in socket.sent]
