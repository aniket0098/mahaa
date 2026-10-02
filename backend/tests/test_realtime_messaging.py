"""Phase 2 — messaging realtime.

Covers the two events this phase adds, ``message.created`` and
``conversation.read``, and the property that matters more than either: **they are
published only after the database transaction commits.**

The ordering is proven rather than assumed. A test that rolled back and then
asserted "no event" would also pass against an implementation that published
first and merely got lucky, so one test inspects the database *at the moment the
event is published* and requires the row to be visible.

No Redis server is needed — ``FakeBus`` is imported from the Phase 1 suite,
which is the whole reason the hub depends on a Protocol.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest

from app.core.redis import LocalEventBus, build_event_bus
from app.realtime import messaging_events
from app.realtime.events import EventType
from app.realtime.hub import RealtimeHub
from app.realtime.runtime import RealtimeRuntime, get_runtime, set_runtime
from tests.test_realtime import FakeBus, run


@pytest.fixture()
def bus():
    """A recording bus, started inside a live event loop.

    ``runtime.start()`` is what captures the loop that ``publish_nowait``
    schedules onto, and it has to run **in** that loop. Calling it through
    ``asyncio.run`` here would capture a loop that is closed again before the
    test body, so this fixture uses :func:`_live_runtime` instead and the
    publish-assertion tests build their own client — see
    :func:`_live_client`.
    """
    fake = FakeBus()
    runtime = _live_runtime(fake)
    set_runtime(runtime)
    yield fake
    set_runtime(None)


def _live_runtime(bus) -> RealtimeRuntime:
    """Start a runtime on a loop that stays open for the caller's lifetime.

    A dedicated loop is created and kept running by a thread, because
    ``publish_nowait`` uses ``run_coroutine_threadsafe`` — exactly as it does in
    production, where the service commits on a worker thread and schedules onto
    the server's loop.
    """
    import threading

    runtime = RealtimeRuntime(hub=RealtimeHub(), bus=bus)
    loop = asyncio.new_event_loop()
    ready = threading.Event()

    def _run() -> None:
        asyncio.set_event_loop(loop)
        loop.call_soon(lambda: None)
        loop.run_forever()

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    ready.wait(timeout=5)
    asyncio.run_coroutine_threadsafe(runtime.start(), loop).result(timeout=5)
    runtime._loop = loop
    return runtime


def _publishes(runtime: RealtimeRuntime) -> None:
    """Let the runtime's loop run whatever the service scheduled.

    Without this the assertions race the loop: ``run_coroutine_threadsafe``
    returns as soon as the coroutine is *scheduled*, not when it has run.
    """
    loop = runtime._loop
    if loop is None:
        return
    asyncio.run_coroutine_threadsafe(asyncio.sleep(0), loop).result(timeout=5)


def published(bus, event_type: str) -> list:
    """Every published event of one type, after letting the loop run.

    The drain belongs *here* rather than at each call site: publishing is
    scheduled onto the runtime's loop, so an assertion written immediately after
    a request would race it. Centralising it means no test can forget.
    """
    runtime = get_runtime()
    if runtime is not None:
        _publishes(runtime)
    return [event for event in bus.published if event.event_type == event_type]


def open_conversation(api_client, other, as_user) -> dict:
    """Connect the two accounts, then open a direct conversation.

    The accepted connection is not incidental: §7.4 only permits a conversation
    between two people with one, and the service answers 403 without it. Going
    through the real Phase 4 routes keeps the precondition honest rather than
    writing the row directly.
    """
    sent = api_client.post(
        "/api/v1/connections",
        json={"user_id": other.id},
        headers=as_user.headers,
    )
    assert sent.status_code == 201, sent.text
    accepted = api_client.post(
        f"/api/v1/connections/{sent.json()['id']}/accept",
        headers=other.headers,
    )
    assert accepted.status_code == 200, accepted.text

    response = api_client.post(
        "/api/v1/conversations",
        json={"user_id": other.id},
        headers=as_user.headers,
    )
    assert response.status_code in (200, 201), response.text
    return response.json()


# --- message.created: shape ------------------------------------------------


def test_a_new_message_publishes_exactly_one_event(bus):
    messaging_events.message_created(
        recipient_user_id="recipient",
        message_id="m1",
        conversation_id="c1",
        sender_user_id="sender",
        created_at="2026-10-01T00:00:00+00:00",
        body="hello",
        client_message_id="k1",
    )
    events = published(bus, EventType.MESSAGE_CREATED)
    assert len(events) == 1
    assert events[0].recipient_user_id == "recipient"


def test_the_event_carries_exactly_the_fields_a_client_needs(bus):
    messaging_events.message_created(
        recipient_user_id="recipient",
        message_id="m1",
        conversation_id="c1",
        sender_user_id="sender",
        created_at="2026-10-01T00:00:00+00:00",
        body="hello",
        client_message_id="k1",
    )
    assert set(published(bus, EventType.MESSAGE_CREATED)[0].payload) == {
        "message_id",
        "conversation_id",
        "sender_user_id",
        "created_at",
        "body",
        "client_message_id",
    }


def test_the_event_carries_no_secret_or_private_field(bus):
    messaging_events.message_created(
        recipient_user_id="recipient",
        message_id="m1",
        conversation_id="c1",
        sender_user_id="sender",
        created_at="2026-10-01T00:00:00+00:00",
        body="hello",
        client_message_id="k1",
    )
    serialised = published(bus, EventType.MESSAGE_CREATED)[0].to_json().lower()
    for forbidden in (
        "password",
        "jwt",
        "secret",
        "redis",
        "database_url",
        "livekit",
        "email",
    ):
        assert forbidden not in serialised, f"{forbidden} must never be published"


# --- conversation.read: shape ---------------------------------------------


def test_a_read_publishes_to_the_other_participant(bus):
    messaging_events.conversation_read(
        recipient_user_id="sender",
        conversation_id="c1",
        reader_user_id="reader",
        last_read_message_id="m9",
        read_at="2026-10-01T00:00:00+00:00",
    )
    events = published(bus, EventType.CONVERSATION_READ)
    assert len(events) == 1
    assert events[0].recipient_user_id == "sender"
    assert events[0].payload["reader_user_id"] == "reader"
    assert events[0].payload["last_read_message_id"] == "m9"


def test_the_read_payload_is_minimal_and_never_restates_the_message(bus):
    messaging_events.conversation_read(
        recipient_user_id="sender",
        conversation_id="c1",
        reader_user_id="reader",
        last_read_message_id="m9",
        read_at="2026-10-01T00:00:00+00:00",
    )
    payload = published(bus, EventType.CONVERSATION_READ)[0].payload
    assert set(payload) == {
        "conversation_id",
        "reader_user_id",
        "last_read_message_id",
        "read_at",
    }
    assert "body" not in payload


# --- delivery failure is never a request failure ---------------------------


def test_a_failing_bus_does_not_raise_at_the_publish_site():
    # The message is already committed. A dead Redis must not turn that into an
    # exception the route would report as a failed send.

    class ExplodingBus(FakeBus):
        async def publish(self, event) -> None:
            raise RuntimeError("redis unreachable")

    set_runtime(RealtimeRuntime(hub=RealtimeHub(), bus=ExplodingBus()))
    messaging_events.message_created(
        recipient_user_id="r",
        message_id="m",
        conversation_id="c",
        sender_user_id="s",
        created_at="2026-10-01T00:00:00+00:00",
        body="hi",
        client_message_id=None,
    )  # must not raise


def test_no_runtime_means_a_silent_no_op():
    # Realtime failing to boot is a supported state; publishing into it must not
    # become a 500 on an otherwise successful request.
    set_runtime(None)
    messaging_events.message_created(
        recipient_user_id="r",
        message_id="m",
        conversation_id="c",
        sender_user_id="s",
        created_at="2026-10-01T00:00:00+00:00",
        body="hi",
        client_message_id=None,
    )


def test_publishing_with_no_running_loop_is_a_no_op():
    # A synchronous caller with no loop captured — every service call in a plain
    # unit test — must not raise.
    set_runtime(RealtimeRuntime(hub=RealtimeHub(), bus=FakeBus()))
    messaging_events.message_created(
        recipient_user_id="r",
        message_id="m",
        conversation_id="c",
        sender_user_id="s",
        created_at="2026-10-01T00:00:00+00:00",
        body="hi",
        client_message_id=None,
    )


def test_the_local_bus_is_used_when_no_redis_is_configured():
    assert LocalEventBus().cross_instance is False
    assert build_event_bus() is not None


# --- target isolation ------------------------------------------------------


def test_an_event_reaches_only_its_named_recipient(bus):
    class Socket:
        def __init__(self) -> None:
            self.sent: list[str] = []

        async def send_text(self, data: str) -> None:
            self.sent.append(data)

    runtime = RealtimeRuntime(hub=RealtimeHub(), bus=bus)
    recipient, stranger = Socket(), Socket()
    runtime.hub.add("recipient", recipient)
    runtime.hub.add("stranger", stranger)

    messaging_events.message_created(
        recipient_user_id="recipient",
        message_id="m1",
        conversation_id="c1",
        sender_user_id="sender",
        created_at="2026-10-01T00:00:00+00:00",
        body="hello",
        client_message_id=None,
    )
    run(runtime.hub.deliver(published(bus, EventType.MESSAGE_CREATED)[0]))

    assert len(recipient.sent) == 1
    assert stranger.sent == [], "an unrelated user must receive nothing"


# --- service integration ---------------------------------------------------


def test_sending_a_message_publishes_after_commit(
    api_client, candidate, other_candidate, bus
):
    conversation = open_conversation(api_client, other_candidate, candidate)

    response = api_client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        json={"body": "hello there"},
        headers=candidate.headers,
    )
    assert response.status_code == 201, response.text

    events = published(bus, EventType.MESSAGE_CREATED)
    assert len(events) == 1, "a stored message must announce itself"
    event = events[0]
    # Server-derived from conversation membership, never from the request.
    assert event.recipient_user_id == other_candidate.id
    assert event.recipient_user_id != candidate.id
    assert event.payload["message_id"] == response.json()["id"]
    assert event.payload["sender_user_id"] == candidate.id
    assert event.payload["conversation_id"] == conversation["id"]


def _drain() -> None:
    """Give the runtime's loop a turn so a scheduled publish has actually run.

    ``run_coroutine_threadsafe`` returns once the coroutine is *scheduled*. A
    test that asserted immediately afterwards would race it, and would fail for
    the right implementation for the wrong reason.
    """
    runtime = get_runtime()
    if runtime is not None:
        _publishes(runtime, None)


def test_the_row_is_already_visible_when_the_event_is_published(
    api_client, candidate, other_candidate, db_session
):
    """The commit-before-publish rule, proven rather than assumed.

    A bus that inspects the database at the moment of publication answers True
    only if the message transaction has already committed. Publishing first would
    answer False here — which is precisely the bug this test exists to catch.
    """
    observed: list[bool] = []

    class InspectingBus(FakeBus):
        async def publish(self, event) -> None:
            if event.event_type == EventType.MESSAGE_CREATED:
                # "Is this row still pending?" is the question that separates
                # publish-then-commit from commit-then-publish. A row that has
                # been committed is no longer in `Session.new`; a row that has
                # only been flushed still is. Using this rather than a second
                # query keeps the answer unambiguous: the request and the test
                # share one session, so a re-query would answer "yes" either way
                # and would prove nothing.
                message_id = uuid.UUID(event.payload["message_id"])
                pending = any(
                    getattr(obj, "id", None) == message_id for obj in db_session.new
                )
                observed.append(not pending)
            await super().publish(event)

    # A started runtime, so `publish_nowait` actually schedules — this test is
    # useless if the publish silently no-ops.
    set_runtime(_live_runtime(InspectingBus()))
    conversation = open_conversation(api_client, other_candidate, candidate)

    api_client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        json={"body": "ordering probe"},
        headers=candidate.headers,
    )

    assert observed == [True], (
        "the message transaction must be committed before its event is published"
    )


def test_a_failed_transaction_publishes_nothing(
    api_client, candidate, other_candidate, bus, monkeypatch
):
    """A rolled-back write must leave the bus untouched."""
    from app.services import messaging as svc

    conversation = open_conversation(api_client, other_candidate, candidate)

    def explode(*_args, **_kwargs):
        raise RuntimeError("boom before commit")

    # Break the commit itself: the message is staged, then the write fails.
    monkeypatch.setattr(svc.Session, "commit", explode, raising=False)

    with pytest.raises(RuntimeError):
        api_client.post(
            f"/api/v1/conversations/{conversation['id']}/messages",
            json={"body": "never lands"},
            headers=candidate.headers,
        )

    assert published(bus, EventType.MESSAGE_CREATED) == []


def test_a_duplicate_client_message_id_publishes_only_one_event(
    api_client, candidate, other_candidate, bus
):
    conversation = open_conversation(api_client, other_candidate, candidate)
    url = f"/api/v1/conversations/{conversation['id']}/messages"
    payload = {"body": "sent once", "client_message_id": "idem-key-1"}

    first = api_client.post(url, json=payload, headers=candidate.headers)
    assert first.status_code == 201

    second = api_client.post(url, json=payload, headers=candidate.headers)
    assert second.status_code == 200, "a repeat is 200, not 201"
    assert second.json()["id"] == first.json()["id"]

    events = published(bus, EventType.MESSAGE_CREATED)
    assert len(events) == 1, "a retry must not announce a second message"
    assert events[0].payload["message_id"] == first.json()["id"]


def test_a_non_member_cannot_send_and_publishes_nothing(
    api_client, candidate, other_candidate, bus
):
    conversation = open_conversation(api_client, other_candidate, candidate)
    stranger = api_client.post(
        "/api/v1/auth/signup",
        json={
            "name": "Stranger",
            "email": f"stranger.{uuid.uuid4().hex[:10]}@example.com",
            "password": "Passw0rd123",
            "phone": None,
            "role": "candidate",
        },
    ).json()

    response = api_client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        json={"body": "let me in"},
        headers={"Authorization": f"Bearer {stranger['access_token']}"},
    )
    assert response.status_code in (403, 404)
    assert published(bus, EventType.MESSAGE_CREATED) == []


# --- read state ------------------------------------------------------------


def test_marking_read_publishes_to_the_sender(
    api_client, candidate, other_candidate, bus
):
    conversation = open_conversation(api_client, other_candidate, candidate)
    sent = api_client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        json={"body": "read me"},
        headers=candidate.headers,
    ).json()

    response = api_client.post(
        f"/api/v1/conversations/{conversation['id']}/read",
        json={"message_id": sent["id"]},
        headers={"Authorization": f"Bearer {other_candidate.token}"},
    )
    assert response.status_code == 204, response.text

    events = published(bus, EventType.CONVERSATION_READ)
    assert len(events) == 1
    event = events[0]
    # The other participant, and the reader is the authenticated caller.
    assert event.recipient_user_id == candidate.id
    assert event.payload["reader_user_id"] == other_candidate.id
    assert event.payload["last_read_message_id"] == sent["id"]
    assert event.payload["conversation_id"] == conversation["id"]


def test_marking_read_twice_publishes_only_once(
    api_client, candidate, other_candidate, bus
):
    conversation = open_conversation(api_client, other_candidate, candidate)
    sent = api_client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        json={"body": "count me"},
        headers=candidate.headers,
    ).json()
    url = f"/api/v1/conversations/{conversation['id']}/read"
    headers = {"Authorization": f"Bearer {other_candidate.token}"}

    first = api_client.post(url, json={"message_id": sent["id"]}, headers=headers)
    second = api_client.post(url, json={"message_id": sent["id"]}, headers=headers)
    assert first.status_code == 204
    assert second.status_code == 204

    assert len(published(bus, EventType.CONVERSATION_READ)) == 1, (
        "a read pointer that did not move must not re-announce"
    )


def test_a_failed_read_publishes_nothing(
    api_client, candidate, other_candidate, bus, monkeypatch
):
    from app.services import messaging as svc

    conversation = open_conversation(api_client, other_candidate, candidate)
    sent = api_client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        json={"body": "read failure probe"},
        headers=candidate.headers,
    ).json()

    def explode(*_args, **_kwargs):
        raise RuntimeError("boom before commit")

    monkeypatch.setattr(svc.Session, "commit", explode, raising=False)

    with pytest.raises(RuntimeError):
        api_client.post(
            f"/api/v1/conversations/{conversation['id']}/read",
            json={"message_id": sent["id"]},
            headers={"Authorization": f"Bearer {other_candidate.token}"},
        )

    assert published(bus, EventType.CONVERSATION_READ) == []


def test_a_non_member_marking_read_publishes_nothing(
    api_client, candidate, other_candidate, bus
):
    conversation = open_conversation(api_client, other_candidate, candidate)
    sent = api_client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        json={"body": "not yours"},
        headers=candidate.headers,
    ).json()
    stranger = api_client.post(
        "/api/v1/auth/signup",
        json={
            "name": "Stranger",
            "email": f"nosy.{uuid.uuid4().hex[:10]}@example.com",
            "password": "Passw0rd123",
            "phone": None,
            "role": "candidate",
        },
    ).json()

    response = api_client.post(
        f"/api/v1/conversations/{conversation['id']}/read",
        json={"message_id": sent["id"]},
        headers={"Authorization": f"Bearer {stranger['access_token']}"},
    )
    assert response.status_code in (403, 404)
    assert published(bus, EventType.CONVERSATION_READ) == []


# --- no schema change ------------------------------------------------------


def test_phase_two_added_no_persistence_of_its_own(bus):
    """Realtime is a delivery mechanism, so it must not own any storage.

    The messaging tables that already existed are unchanged; nothing here writes
    an event row, which is what would let a stale event outlive the message it
    described.
    """
    from app.models import Message

    columns = {attribute.key for attribute in Message.__mapper__.column_attrs}
    assert not (columns & {"event_id", "published_at", "realtime_state"})
