"""Phase 3 — notification realtime.

Covers ``notification.created`` and, above all, **where** it is published. The
existing ``services.notifications.emit`` deliberately does not publish, because it
runs *before* its caller's commit; these tests pin that decision by proving a
rollback produces no event at all.

The Phase 2 live-loop harness is imported rather than repeated: ``publish_nowait``
schedules onto a running loop in production, so a fixture that starts a runtime on
a loop that stays open is the only way to observe delivery honestly.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.core.redis import LocalEventBus, build_event_bus
from app.realtime import notification_events
from app.realtime.events import EventType
from app.realtime.runtime import get_runtime, set_runtime
from tests.test_realtime import FakeBus
from tests.test_realtime_messaging import (
    _live_runtime,
    _publishes,
    open_conversation,
    published,
)


@pytest.fixture()
def bus():
    """A recording bus on a live loop, standing in for the app's lifespan."""
    fake = FakeBus()
    set_runtime(_live_runtime(fake))
    yield fake
    set_runtime(None)


def connect(api_client, a, b) -> str:
    """Give two accounts an accepted connection, through the real routes."""
    sent = api_client.post(
        "/api/v1/connections", json={"user_id": b.id}, headers=a.headers
    )
    assert sent.status_code == 201, sent.text
    accepted = api_client.post(
        f"/api/v1/connections/{sent.json()['id']}/accept", headers=b.headers
    )
    assert accepted.status_code == 200, accepted.text
    return sent.json()["id"]


def drain() -> None:
    runtime = get_runtime()
    if runtime is not None:
        _publishes(runtime)


# --- event shape ------------------------------------------------------------


def _emit_sample(bus) -> object:
    notification_events.notification_created(
        recipient_user_id="recipient",
        notification_id="n-1",
        notification_type="connection_request",
        actor_user_id="actor",
        target_type="connection",
        target_id="c-1",
        title="New connection request",
        body=None,
        data={"connection_id": "c-1"},
        created_at="2026-10-01T00:00:00+00:00",
        is_read=False,
    )
    return published(bus, EventType.NOTIFICATION_CREATED)[0]


def test_a_notification_publishes_exactly_one_event(bus):
    event = _emit_sample(bus)
    assert event.recipient_user_id == "recipient"
    assert len(published(bus, EventType.NOTIFICATION_CREATED)) == 1


def test_the_payload_uses_the_notification_api_field_names(bus):
    # The same names `NotificationRead` publishes, so the client renders one object
    # from either source instead of translating between two shapes.
    assert set(_emit_sample(bus).payload) == {
        "id",
        "type",
        "actor_user_id",
        "target_type",
        "target_id",
        "title",
        "body",
        "data",
        "is_read",
        "created_at",
    }


def test_the_event_carries_no_secret_or_private_field(bus):
    serialised = _emit_sample(bus).to_json().lower()
    for forbidden in (
        "password",
        "jwt",
        "token",
        "secret",
        "redis",
        "database_url",
        "livekit",
        "email",
        "phone",
    ):
        assert forbidden not in serialised, f"{forbidden} must never be published"


def test_an_unknown_event_type_is_refused_by_the_envelope():
    # Phase 3 adds one type; anything else is still rejected by the shared
    # allowlist rather than being smuggled through `from_dict`.
    from app.realtime.events import RealtimeError, RealtimeEvent

    with pytest.raises(RealtimeError):
        RealtimeEvent.from_dict(
            {"event_type": "post.liked", "event_id": "x", "payload": {}}
        )


# --- delivery failure is never a request failure ---------------------------


def test_a_failing_bus_does_not_raise_at_the_publish_site():
    class ExplodingBus(FakeBus):
        async def publish(self, event) -> None:
            raise RuntimeError("redis unreachable")

    set_runtime(_live_runtime(ExplodingBus()))
    notification_events.publish_for(
        _FakeNotification(),
    )  # must not raise


def test_no_runtime_means_a_silent_no_op():
    set_runtime(None)
    notification_events.publish_for(_FakeNotification())


def test_the_local_bus_is_used_when_no_redis_is_configured():
    assert LocalEventBus().cross_instance is False
    assert build_event_bus() is not None


class _FakeNotification:
    """The minimum `publish_for` reads, so the wrapper is tested in isolation."""

    id = "00000000-0000-4000-8000-000000000001"
    user_id = "00000000-0000-4000-8000-000000000002"
    type = "system"
    actor_id = None
    target_type = None
    target_id = None
    title = "System notice"
    body = None
    data: dict = {}
    is_read = False
    created_at = datetime(2026, 10, 1, tzinfo=UTC)


# --- connection notifications -----------------------------------------------


def test_a_connection_request_notifies_the_addressee(
    api_client, candidate, other_candidate, bus
):
    # Direction matters: the requester is the actor, the addressee is the
    # recipient. Both come from the connection state machine, never the request.
    api_client.post(
        "/api/v1/connections",
        json={"user_id": other_candidate.id},
        headers=candidate.headers,
    )
    drain()

    events = published(bus, EventType.NOTIFICATION_CREATED)
    assert len(events) == 1
    event = events[0]
    assert event.recipient_user_id == other_candidate.id
    assert event.recipient_user_id != candidate.id
    assert event.payload["type"] == "connection_request"
    assert event.payload["actor_user_id"] == candidate.id


def test_an_accepted_connection_notifies_the_requester(
    api_client, candidate, other_candidate, bus
):
    sent = api_client.post(
        "/api/v1/connections",
        json={"user_id": other_candidate.id},
        headers=candidate.headers,
    ).json()
    drain()
    # The request itself notified the addressee; this test is about what the
    # *acceptance* adds, so the count is measured from here rather than from zero.
    baseline = len(published(bus, EventType.NOTIFICATION_CREATED))

    api_client.post(
        f"/api/v1/connections/{sent['id']}/accept",
        headers=other_candidate.headers,
    )
    drain()

    events = published(bus, EventType.NOTIFICATION_CREATED)
    assert len(events) == baseline + 1
    # Roles are exactly reversed: the requester is told.
    event = events[-1]
    assert event.recipient_user_id == candidate.id
    assert event.payload["type"] == "connection_accepted"
    assert event.payload["actor_user_id"] == other_candidate.id


def test_a_duplicate_connection_request_publishes_once(
    api_client, candidate, other_candidate, bus
):
    body = {"user_id": other_candidate.id}
    first = api_client.post("/api/v1/connections", json=body, headers=candidate.headers)
    assert first.status_code == 201
    # Repeating a pending request is idempotent — §18's target-state rule — and
    # returns 200 without re-entering `_persist`, so nothing new is notified.
    second = api_client.post(
        "/api/v1/connections", json=body, headers=candidate.headers
    )
    assert second.status_code == 200
    drain()

    assert len(published(bus, EventType.NOTIFICATION_CREATED)) == 1


def test_a_reverse_request_publishes_nothing(
    api_client, candidate, other_candidate, bus
):
    # The addressee asking instead is a 409, and the notification is staged inside
    # the transaction that rolls back — so no event announces a row that is gone.
    sent = api_client.post(
        "/api/v1/connections",
        json={"user_id": other_candidate.id},
        headers=candidate.headers,
    )
    assert sent.status_code == 201
    drain()
    baseline = len(published(bus, EventType.NOTIFICATION_CREATED))

    reverse = api_client.post(
        "/api/v1/connections",
        json={"user_id": candidate.id},
        headers=other_candidate.headers,
    )
    assert reverse.status_code == 409
    drain()

    assert len(published(bus, EventType.NOTIFICATION_CREATED)) == baseline


def test_a_failed_connection_transaction_publishes_nothing(
    api_client, candidate, other_candidate, bus, monkeypatch
):
    from app.services import connections as svc

    def explode(*_args, **_kwargs):
        raise RuntimeError("boom before commit")

    monkeypatch.setattr(svc.Session, "commit", explode, raising=False)

    with pytest.raises(RuntimeError):
        api_client.post(
            "/api/v1/connections",
            json={"user_id": other_candidate.id},
            headers=candidate.headers,
        )
    drain()

    assert published(bus, EventType.NOTIFICATION_CREATED) == []


# --- message notifications -------------------------------------------------


def test_a_message_produces_both_realtime_events(
    api_client, candidate, other_candidate, bus
):
    """`message.created` and `notification.created` are both correct and distinct.

    The thread needs the body; the badge needs the notification. Publishing one
    without the other leaves the recipient with a stale count or an empty thread.
    """
    conversation = open_conversation(api_client, other_candidate, candidate)
    drain()
    # Opening the conversation notified each side about the connection. This test
    # is about what *sending* adds, so it measures from that baseline.
    baseline = len(published(bus, EventType.NOTIFICATION_CREATED))

    api_client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        json={"body": "hello"},
        headers=candidate.headers,
    )
    drain()

    messages = published(bus, EventType.MESSAGE_CREATED)
    notifications = published(bus, EventType.NOTIFICATION_CREATED)
    assert len(messages) == 1
    assert len(notifications) == baseline + 1

    # Same recipient, different payloads.
    event = notifications[-1]
    assert messages[0].recipient_user_id == other_candidate.id
    assert event.recipient_user_id == other_candidate.id
    assert messages[0].payload["body"] == "hello"
    # The notification carries no message text — §13.2 keeps private content out
    # of the second table, and the event must not put it back.
    assert event.payload["type"] == "message"
    assert event.payload["body"] is None
    assert "hello" not in event.to_json()


def test_a_duplicate_message_publishes_exactly_one_of_each(
    api_client, candidate, other_candidate, bus
):
    conversation = open_conversation(api_client, other_candidate, candidate)
    url = f"/api/v1/conversations/{conversation['id']}/messages"
    payload = {"body": "once", "client_message_id": "k-1"}
    drain()
    baseline = len(published(bus, EventType.NOTIFICATION_CREATED))

    api_client.post(url, json=payload, headers=candidate.headers)
    repeat = api_client.post(url, json=payload, headers=candidate.headers)
    assert repeat.status_code == 200
    drain()

    assert len(published(bus, EventType.MESSAGE_CREATED)) == 1
    assert len(published(bus, EventType.NOTIFICATION_CREATED)) == baseline + 1


def test_a_failed_message_publishes_neither_event(
    api_client, candidate, other_candidate, bus, monkeypatch
):
    from app.services import messaging as svc

    conversation = open_conversation(api_client, other_candidate, candidate)
    drain()
    baseline = len(published(bus, EventType.NOTIFICATION_CREATED))

    def explode(*_args, **_kwargs):
        raise RuntimeError("boom before commit")

    monkeypatch.setattr(svc.Session, "commit", explode, raising=False)

    with pytest.raises(RuntimeError):
        api_client.post(
            f"/api/v1/conversations/{conversation['id']}/messages",
            json={"body": "never lands"},
            headers=candidate.headers,
        )
    drain()

    # Measured against the pre-attempt count: opening the conversation already
    # notified both sides, so an absolute "zero" would be the wrong assertion.
    assert len(published(bus, EventType.NOTIFICATION_CREATED)) == baseline
    assert published(bus, EventType.MESSAGE_CREATED) == []


# --- read endpoints are out of scope ---------------------------------------


def test_marking_a_notification_read_publishes_nothing(
    api_client, candidate, other_candidate, bus
):
    """Phase 3 is `notification.created` only.

    The read routes stay REST-authoritative. A client that marks something read
    already knows it did, so a realtime event would tell it nothing it does not
    have, and the specification does not ask for one.
    """
    api_client.post(
        "/api/v1/connections",
        json={"user_id": other_candidate.id},
        headers=candidate.headers,
    )
    inbox = api_client.get(
        "/api/v1/notifications", headers=other_candidate.headers
    ).json()
    response = api_client.post(
        f"/api/v1/notifications/{inbox['items'][0]['id']}/read",
        headers=other_candidate.headers,
    )
    assert response.status_code == 204
    drain()

    assert len(published(bus, EventType.NOTIFICATION_CREATED)) == 1, (
        "only the creation event exists in this phase"
    )


# --- no schema change ------------------------------------------------------


def test_phase_three_added_no_persistence_of_its_own(bus):
    from app.models import Notification

    columns = {attribute.key for attribute in Notification.__mapper__.column_attrs}
    assert not (columns & {"event_id", "published_at", "delivered_at"})
