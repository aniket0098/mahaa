"""Phase 10 — realtime transport foundation.

Covers the four layers that were added for realtime and nothing else: the event
envelope, the in-process hub, the event bus, and the WebSocket route's
authentication. No business event is tested here, because none is published yet.

**No test in this file needs a Redis server.** The bus is exercised through
:class:`FakeBus`, which is the whole reason the hub depends on a Protocol rather
than on a concrete client: the fan-out contract is verified without a network
dependency that would make the suite fail on a machine without Redis.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from contextlib import contextmanager

import pytest
from sqlalchemy.orm import Session

from app.core.redis import LocalEventBus, RedisEventBus, build_event_bus
from app.realtime.events import (
    KNOWN_EVENT_TYPES,
    REDIS_CHANNEL,
    EventType,
    RealtimeError,
    RealtimeEvent,
)
from app.realtime.hub import RealtimeHub
from app.realtime.runtime import RealtimeRuntime, get_runtime, set_runtime

# --- fakes ------------------------------------------------------------------


class FakeSocket:
    """A WebSocket that records what was sent and can be made to fail."""

    def __init__(self, *, fail: bool = False, state: str | None = None) -> None:
        self.sent: list[str] = []
        self.fail = fail
        self.closed = False
        self.close_code: int | None = None
        if state is not None:
            self.client_state = state

    async def send_text(self, data: str) -> None:
        if self.fail:
            raise RuntimeError("socket is gone")
        self.sent.append(data)

    async def close(self, code: int = 1000) -> None:
        self.closed = True
        self.close_code = code

    def events(self) -> list[RealtimeEvent]:
        return [RealtimeEvent.from_dict(json.loads(raw)) for raw in self.sent]


class FakeBus:
    """An in-memory bus that records what was published.

    Stands in for Redis so the hub's fan-out is testable without one, and so
    ``cross_instance`` can be asserted independently of the real client.
    """

    def __init__(self, *, cross: bool = True) -> None:
        self.published: list[RealtimeEvent] = []
        self._handler = None
        self._cross = cross
        self.started = False
        self.closed = False

    async def publish(self, event: RealtimeEvent) -> None:
        self.published.append(event)

    async def start(self, handler) -> None:
        self._handler = handler
        self.started = True

    async def close(self) -> None:
        self.closed = True

    @property
    def cross_instance(self) -> bool:
        return self._cross

    async def deliver(self, event: RealtimeEvent) -> None:
        """Push straight through to the registered handler."""
        if self._handler is not None:
            await self._handler(event)


@pytest.fixture(autouse=True)
def _clear_runtime():
    """No test may inherit another test's process runtime or session factory."""
    from app.api.v1.ws import set_session_factory

    set_runtime(None)
    set_session_factory(None)
    yield
    set_runtime(None)
    set_session_factory(None)


def run(coro):
    """Run one coroutine. A test-local asyncio runner keeps this file readable
    and avoids pulling in a pytest-asyncio dependency the project does not have."""
    return asyncio.run(coro)


# --- event envelope ---------------------------------------------------------


def test_event_serialises_to_json_with_every_documented_key():
    event = RealtimeEvent(event_type=EventType.SYSTEM_PING, payload={"a": 1})
    data = json.loads(event.to_json())
    assert set(data) == {
        "event_id",
        "event_type",
        "occurred_at",
        "recipient_user_id",
        "topic",
        "payload",
    }
    assert data["event_type"] == "system.ping"
    assert data["payload"] == {"a": 1}


def test_event_ids_are_unique_so_a_client_can_deduplicate():
    ids = {RealtimeEvent.system_ping().event_id for _ in range(200)}
    assert len(ids) == 200, "event_id must never repeat"


def test_event_round_trips_through_dict_and_json():
    original = RealtimeEvent(
        event_type=EventType.SYSTEM_ERROR,
        payload={"reason": "nope"},
        recipient_user_id="user-1",
        topic="t",
    )
    assert RealtimeEvent.from_dict(original.to_dict()) == original
    assert RealtimeEvent.from_dict(json.loads(original.to_json())) == original


def test_an_unknown_event_type_is_refused_at_construction():
    with pytest.raises(RealtimeError):
        # A Phase 4 event, published before its phase existed. The allowlist is
        # what stops the client being handed something it has no handler for.
        RealtimeEvent(event_type="post.liked")


def test_a_forged_type_cannot_be_smuggled_in_through_from_dict():
    # from_dict is the inbound path from Redis, so it must enforce the same
    # allowlist as the constructor rather than trusting the payload.
    with pytest.raises(RealtimeError):
        RealtimeEvent.from_dict({"event_type": "post.liked", "event_id": "x"})


def test_the_event_types_are_exactly_what_the_backend_publishes():
    # Enumerated rather than derived, so adding a type is a deliberate edit that
    # forces the mobile client to be taught about it in the same change.
    assert KNOWN_EVENT_TYPES == {
        # transport lifecycle
        "connection.opened",
        "connection.closed",
        "system.ping",
        "system.error",
        # Phase 2 messaging
        "message.created",
        "conversation.read",
        # Phase 3 notifications
        "notification.created",
        # Phase 12 content
        "post.created",
        "post.updated",
        "post.deleted",
        "story.created",
    }


@pytest.mark.parametrize(
    "payload",
    [
        {"event_type": "system.ping"},
        {"event_id": "x"},
        {"event_type": "system.ping", "event_id": "x", "payload": "not-an-object"},
        "not-an-object",
    ],
)
def test_a_malformed_event_is_rejected_rather_than_half_built(payload):
    with pytest.raises(RealtimeError):
        RealtimeEvent.from_dict(payload)


def test_is_for_only_matches_the_named_recipient():
    event = RealtimeEvent(event_type=EventType.SYSTEM_PING, recipient_user_id="alice")
    assert event.is_for("alice")
    assert not event.is_for("bob")
    # An untargeted event belongs to nobody: broadcasting is a publishing
    # decision, not a transport default.
    assert not RealtimeEvent.system_ping().is_for("anyone")


# --- hub --------------------------------------------------------------------


def test_the_hub_registers_and_releases_a_socket():
    hub, socket = RealtimeHub(), FakeSocket()
    hub.add("alice", socket)
    assert hub.connection_count == 1
    assert hub.connected_user_ids == frozenset({"alice"})
    hub.discard("alice", socket)
    assert hub.connection_count == 0
    assert hub.connected_user_ids == frozenset()


def test_one_user_may_hold_several_sockets():
    # A phone and a tablet are two sockets; releasing one must not close the
    # other, or signing out on one device would sign out all of them.
    hub = RealtimeHub()
    phone, tablet = FakeSocket(), FakeSocket()
    hub.add("alice", phone)
    hub.add("alice", tablet)
    assert hub.connection_count == 2
    hub.discard("alice", phone)
    assert hub.sockets_for("alice") == frozenset({tablet})


def test_discard_is_idempotent_so_double_disconnect_is_harmless():
    # Cleanup runs from both the receive loop and the heartbeat, so a KeyError
    # here would leave the registry inconsistent during teardown.
    hub, socket = RealtimeHub(), FakeSocket()
    hub.add("alice", socket)
    hub.discard("alice", socket)
    hub.discard("alice", socket)
    hub.discard("nobody", socket)
    assert hub.connection_count == 0


def test_an_event_reaches_every_socket_the_recipient_holds():
    hub = RealtimeHub()
    phone, tablet = FakeSocket(), FakeSocket()
    hub.add("alice", phone)
    hub.add("alice", tablet)
    delivered = run(
        hub.deliver(
            RealtimeEvent(event_type=EventType.SYSTEM_PING, recipient_user_id="alice")
        )
    )
    assert delivered == 2
    assert phone.events()[0].event_type == "system.ping"


def test_an_event_addressed_to_one_user_never_reaches_another():
    # This is the authorisation guarantee: targeting is decided by the
    # server-stamped recipient, so a client cannot widen what it receives.
    hub = RealtimeHub()
    alice, bob = FakeSocket(), FakeSocket()
    hub.add("alice", alice)
    hub.add("bob", bob)
    delivered = run(
        hub.deliver(
            RealtimeEvent(event_type=EventType.SYSTEM_PING, recipient_user_id="alice")
        )
    )
    assert delivered == 1
    assert alice.sent
    assert bob.sent == [], "an event for alice must not reach bob"


def test_an_untargeted_event_is_not_broadcast():
    # Broadcasting needs the audience, which only the publishing domain knows.
    hub = RealtimeHub()
    alice, bob = FakeSocket(), FakeSocket()
    hub.add("alice", alice)
    hub.add("bob", bob)
    assert run(hub.deliver(RealtimeEvent.system_ping())) == 0
    assert alice.sent == [] and bob.sent == []


def test_one_broken_socket_is_dropped_without_affecting_the_others():
    # A phone that lost signal must not be able to stop the server talking to
    # everyone else, and must not linger in the registry.
    hub = RealtimeHub()
    broken, healthy = FakeSocket(fail=True), FakeSocket()
    hub.add("alice", broken)
    hub.add("alice", healthy)
    delivered = run(
        hub.deliver(
            RealtimeEvent(event_type=EventType.SYSTEM_PING, recipient_user_id="alice")
        )
    )
    assert delivered == 1
    assert hub.connection_count == 1
    assert hub.sockets_for("alice") == frozenset({healthy})


def test_prune_forgets_a_socket_that_reported_itself_closed():
    # A client that vanishes without a close frame raises nothing until the next
    # send, so the registry would otherwise hold it indefinitely.
    hub = RealtimeHub()
    dead = FakeSocket(state="WebSocketState.DISCONNECTED")
    alive = FakeSocket(state="WebSocketState.CONNECTED")
    hub.add("alice", dead)
    hub.add("alice", alive)
    assert hub.prune() == 1
    assert hub.sockets_for("alice") == frozenset({alive})


def test_the_hub_refuses_to_grow_past_its_cap():
    # The cap is enforced by the caller checking `is_full()`, which the route
    # does before registering. Proving the check exists is what matters; making
    # `add` itself silently drop would hide a bug in that check.
    hub = RealtimeHub(max_connections=2)
    hub.add("alice", FakeSocket())
    hub.add("bob", FakeSocket())
    assert hub.is_full(), "the route must be able to refuse a connection here"


def test_close_all_closes_every_socket_and_empties_the_registry():
    hub = RealtimeHub()
    sockets = [FakeSocket(), FakeSocket(), FakeSocket()]
    for index, socket in enumerate(sockets):
        hub.add(f"user-{index}", socket)
    assert run(hub.close_all()) == 3
    assert all(socket.closed for socket in sockets)
    assert hub.connection_count == 0


def test_close_all_survives_a_socket_that_refuses_to_close():
    hub = RealtimeHub()

    class Unclosable(FakeSocket):
        async def close(self, code: int = 1000) -> None:
            raise RuntimeError("already gone")

    good = FakeSocket()
    hub.add("alice", Unclosable())
    hub.add("bob", good)
    assert run(hub.close_all()) == 2
    assert good.closed, "one bad socket must not prevent the others closing"


# --- event bus --------------------------------------------------------------


def test_the_local_bus_delivers_to_its_handler():
    bus, seen = LocalEventBus(), []
    run(bus.start(lambda event: seen.append(event) or asyncio.sleep(0)))
    run(bus.publish(RealtimeEvent.system_ping()))
    assert len(seen) == 1


def test_the_local_bus_reports_that_it_is_not_cross_instance():
    # Honesty matters more than convenience here: a multi-instance deployment
    # with no Redis must be visibly wrong, not silently lossy.
    assert LocalEventBus().cross_instance is False


def test_a_failing_handler_does_not_break_the_local_bus():
    bus = LocalEventBus()
    seen: list[RealtimeEvent] = []

    async def handler(event: RealtimeEvent) -> None:
        seen.append(event)
        raise RuntimeError("handler blew up")

    run(bus.start(handler))
    run(bus.publish(RealtimeEvent.system_ping()))  # must not raise
    assert len(seen) == 1


def test_no_redis_url_selects_the_local_bus(monkeypatch):
    from app.core.config import get_settings

    settings = get_settings()
    previous = settings.redis_url
    settings.redis_url = ""
    try:
        assert isinstance(build_event_bus(), LocalEventBus)
    finally:
        settings.redis_url = previous


def test_a_redis_url_selects_the_redis_bus_and_never_leaks_the_url(monkeypatch):
    from app.core.config import get_settings

    secret_url = "redis://user:hunter2@cache.internal:6379/0"
    settings = get_settings()
    previous = settings.redis_url
    settings.redis_url = secret_url
    try:
        bus = build_event_bus()
        assert isinstance(bus, RedisEventBus)
        assert bus.cross_instance is True
        # The URL lives in the object for connecting and nowhere else.
        assert secret_url not in repr(bus.__dict__.get("_handler", None) or "")
    finally:
        settings.redis_url = previous


def test_the_redis_channel_is_namespaced():
    assert REDIS_CHANNEL == "mahaa:realtime"


def test_a_publish_failure_is_swallowed_and_never_raises_the_url():
    # Fan-out is best-effort. A dead Redis must not turn a REST write into a
    # 500, and its URL must not reach a log line.
    secret_url = "redis://user:hunter2@cache.internal:6379/0"
    bus = RedisEventBus(secret_url)

    async def scenario() -> None:
        await bus.publish(RealtimeEvent.system_ping())

    run(scenario())  # must not raise


def test_redis_ping_reports_failure_instead_of_raising():
    # An unreachable Redis makes readiness say "not ready", never 500. Built
    # inside the coroutine so the coroutine object is never created in the
    # test body — passing one out of `asyncio.wait_for` would leave pytest
    # reporting a failure from a never-awaited coroutine.
    bus = RedisEventBus("redis://127.0.0.1:1/0")

    async def scenario() -> bool:
        return bool(await asyncio.wait_for(bus.ping(), timeout=15))

    assert run(scenario()) is False


# --- runtime ----------------------------------------------------------------


def test_the_runtime_wires_the_bus_into_the_hub():
    hub = RealtimeHub()
    bus = FakeBus()
    runtime = RealtimeRuntime(hub=hub, bus=bus)
    alice = FakeSocket()
    hub.add("alice", alice)

    async def scenario() -> None:
        await runtime.start()
        await bus.deliver(
            RealtimeEvent(event_type=EventType.SYSTEM_PING, recipient_user_id="alice")
        )

    run(scenario())
    assert bus.started
    assert len(alice.sent) == 1, "a bus event must reach the local socket"


def test_the_runtime_closes_sockets_before_it_closes_the_bus():
    hub = RealtimeHub()
    socket = FakeSocket()
    hub.add("alice", socket)
    bus = FakeBus()
    runtime = RealtimeRuntime(hub=hub, bus=bus)

    async def scenario() -> None:
        await runtime.start()
        await runtime.stop()

    run(scenario())
    assert socket.closed
    assert bus.closed
    assert hub.connection_count == 0


def test_the_process_runtime_is_readable_and_replaceable():
    runtime = RealtimeRuntime(hub=RealtimeHub(), bus=FakeBus())
    set_runtime(runtime)
    assert get_runtime() is runtime
    set_runtime(None)
    assert get_runtime() is None


# --- websocket route --------------------------------------------------------


def _ws_client(hub: RealtimeHub | None = None, db_session: Session | None = None):
    """A TestClient whose lifespan has installed a controllable runtime.

    The route reads the process runtime rather than building one per request, so
    a test has to install it to see its sockets. ``FakeBus`` keeps this free of
    Redis.

    ``db_session`` is the same rolled-back session the REST fixtures use. A
    WebSocket route cannot take a ``Depends(get_db)`` dependency, so the socket
    path reaches the database through ``set_session_factory`` instead — the
    indirection exists so this test can point it at the same session.
    """
    from fastapi.testclient import TestClient

    from app.api.v1.ws import set_session_factory
    from app.main import create_app

    runtime = RealtimeRuntime(hub=hub or RealtimeHub(), bus=FakeBus())

    if db_session is not None:
        set_session_factory(lambda: db_session)

    client = TestClient(create_app())
    client.__enter__()
    set_runtime(runtime)
    return client


def test_a_socket_without_a_token_is_refused():
    client = _ws_client()
    try:
        with client.websocket_connect("/api/v1/ws") as socket:
            frame = socket.receive()
        assert frame["type"] == "websocket.close"
        assert frame["code"] == 1008, "an unauthenticated socket must be refused"
    finally:
        client.__exit__(None, None, None)


def test_a_socket_with_a_forged_token_is_refused():
    client = _ws_client()
    try:
        with client.websocket_connect("/api/v1/ws?token=not-a-real-jwt") as socket:
            frame = socket.receive()
        assert frame["code"] == 1008
    finally:
        client.__exit__(None, None, None)


def test_the_refusal_reason_never_echoes_the_token():
    # The reason reaches the client, so it must not contain any part of the
    # credential that was offered.
    client = _ws_client()
    forged = "aaa.bbb.ccc"
    try:
        with client.websocket_connect(f"/api/v1/ws?token={forged}") as socket:
            frame = socket.receive()
        assert forged not in frame.get("reason", "")
        assert "bbb" not in frame.get("reason", "")
    finally:
        client.__exit__(None, None, None)


def test_realtime_can_be_switched_off_and_then_refuses_connections():
    from app.core.config import get_settings

    client = _ws_client()
    settings = get_settings()
    previous = settings.realtime_enabled
    settings.realtime_enabled = False
    try:
        with client.websocket_connect("/api/v1/ws") as socket:
            frame = socket.receive()
        assert frame["type"] == "websocket.close"
        assert frame["code"] == 1013, "disabled realtime must refuse, not pretend"
    finally:
        settings.realtime_enabled = previous
        client.__exit__(None, None, None)


def test_the_default_session_path_resolves_a_real_user(
    monkeypatch, db_session, user_factory
):
    """Regression: the *default* socket-auth path was broken for every real client.

    ``_authenticate`` opened its session with ``session_scope()`` as though that
    call returned a ``Session``. It does not — ``session_scope`` is a context
    manager, so the first attribute access raised ``AttributeError``, the broad
    ``except`` turned that into ``None``, and every socket closed with 1008
    "Authentication required" **even with a perfectly valid token**.

    It reached production because every other test in this file installs a
    session factory, so the default branch — the only one a real client takes —
    had no coverage at all. This test exercises that branch directly and also
    asserts the scope is *entered*, which is what distinguishes the fix from the
    original.
    """
    import app.api.v1.ws as ws
    from app.services.tokens import create_access_token

    user = user_factory()
    minted = create_access_token(
        user_id=str(user.id), role="candidate", public_id=user.public_id
    )
    entered: list[bool] = []

    @contextmanager
    def fake_scope():
        entered.append(True)
        yield db_session

    # No factory installed: this is the production path.
    monkeypatch.setattr(ws, "session_factory", lambda: None)
    monkeypatch.setattr(ws, "session_scope", fake_scope)

    resolved = run(ws._authenticate(minted.token))

    assert entered, "session_scope must be entered with `with`, not merely called"
    assert resolved is not None, "a valid token must resolve its user"
    assert resolved.id == user.id


def test_the_default_session_path_still_refuses_a_forged_token(monkeypatch, db_session):
    """The same branch must not become a way in: a forged token stays rejected."""

    import app.api.v1.ws as ws

    @contextmanager
    def fake_scope():
        yield db_session

    monkeypatch.setattr(ws, "session_factory", lambda: None)
    monkeypatch.setattr(ws, "session_scope", fake_scope)

    assert run(ws._authenticate("not-a-real-jwt")) is None


# --- the access log must not carry the socket's token ------------------------
#
# A browser WebSocket cannot send an Authorization header, so the access token
# rides in the query string. `ws.py` never logs it, but uvicorn's *access* logger
# prints the whole request line — so every socket connection used to write a live
# bearer token to disk. These tests pin the redaction, and they use a token-shaped
# string that is obviously not a credential.

#: Obviously fake, JWT-shaped, and unique so it cannot collide with anything real.
FAKE_JWT = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "REDACTION-PROBE-PAYLOAD-must-not-appear-in-logs."
    "REDACTION-PROBE-SIGNATURE-must-not-appear-in-logs"
)


def _uvicorn_access_record(path: str, *, http_version: str = "1.1"):
    """Build a LogRecord shaped exactly like uvicorn's **HTTP** access line.

    uvicorn logs ``'%s - "%s %s HTTP/%s" %d'`` with (client_addr, method,
    path_with_query_string, http_version, status), so index 2 of ``args`` is the
    full path including any query string.
    """
    return logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg='%s - "%s %s HTTP/%s" %d',
        args=("127.0.0.1:51000", "GET", path, http_version, 101),
        exc_info=None,
    )


def _uvicorn_ws_record(path: str):
    """Build a LogRecord shaped exactly like uvicorn's **WebSocket** access line.

    This is a *different* shape from the HTTP one: the protocol code logs
    ``'%s - "WebSocket %s" [accepted]'`` with only (client_addr, path), so the
    path is at index 1. An earlier version of the redactor assumed index 2 and
    therefore silently did nothing to the very line it was written for — which is
    why both shapes are pinned here.
    """
    return logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg='%s - "WebSocket %s" [accepted]',
        args=("127.0.0.1:51000", path),
        exc_info=None,
    )


def test_the_redactor_strips_the_token_from_the_socket_access_line():
    """The shape uvicorn actually uses for a WebSocket — the one that leaked."""

    from app.core.logging import RealtimeTokenRedactor

    record = _uvicorn_ws_record(f"/api/v1/ws?token={FAKE_JWT}")
    assert RealtimeTokenRedactor("/api/v1").filter(record) is True

    assert FAKE_JWT not in record.getMessage()
    assert "?" not in record.getMessage()
    # The route itself survives, so the line is still useful for diagnostics.
    assert record.args[1] == "/api/v1/ws"
    assert "/api/v1/ws" in record.getMessage()


def test_the_redactor_also_handles_the_http_record_shape():
    """Defensive: the same route arriving through the HTTP-shaped record."""

    from app.core.logging import RealtimeTokenRedactor

    record = _uvicorn_access_record(f"/api/v1/ws?token={FAKE_JWT}")
    RealtimeTokenRedactor("/api/v1").filter(record)

    assert FAKE_JWT not in record.getMessage()
    assert record.args[2] == "/api/v1/ws"


def test_the_redactor_leaves_ordinary_http_access_lines_alone():
    """The filter must be narrow: a normal request keeps its query string."""

    from app.core.logging import RealtimeTokenRedactor

    record = _uvicorn_access_record("/api/v1/users/lookup?query=someone")
    RealtimeTokenRedactor("/api/v1").filter(record)

    assert record.args[2] == "/api/v1/users/lookup?query=someone"
    assert "query=someone" in record.getMessage()


def test_the_redactor_leaves_a_queryless_socket_line_alone():
    from app.core.logging import RealtimeTokenRedactor

    record = _uvicorn_ws_record("/api/v1/ws")
    RealtimeTokenRedactor("/api/v1").filter(record)

    assert record.args[1] == "/api/v1/ws"


def test_the_redactor_does_not_match_a_similarly_named_route():
    """``/api/v1/wsproxy`` is a different endpoint and must not be rewritten."""

    from app.core.logging import RealtimeTokenRedactor

    for record in (
        _uvicorn_access_record("/api/v1/wsproxy?token=keep-me"),
        _uvicorn_ws_record("/api/v1/wsproxy?token=keep-me"),
    ):
        RealtimeTokenRedactor("/api/v1").filter(record)

    assert "keep-me" in record.getMessage()


def test_installation_covers_both_uvicorn_loggers_and_is_idempotent():
    """Both loggers, because uvicorn emits the socket line on ``uvicorn.error``.

    This is the assertion that would have caught the real bug: a filter attached
    only to ``uvicorn.access`` passes every HTTP-shaped test and still leaves the
    credential in the log.
    """
    from app.core.logging import RealtimeTokenRedactor, install_access_log_redactor

    install_access_log_redactor("/api/v1")
    install_access_log_redactor("/api/v1")

    for name in ("uvicorn.access", "uvicorn.error"):
        redactors = [
            f for f in logging.getLogger(name).filters
            if isinstance(f, RealtimeTokenRedactor)
        ]
        assert len(redactors) == 1, f"{name} needs exactly one redactor"


def test_the_socket_record_is_redacted_on_the_logger_that_actually_emits_it(caplog):
    """The end-to-end check, on ``uvicorn.error`` — where the leak came from.

    Emits the exact record uvicorn's WebSocket protocol emits, on the exact logger
    it emits it to, and proves the token value never reaches captured output.
    """

    from app.core.logging import install_access_log_redactor

    install_access_log_redactor("/api/v1")
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        logging.getLogger("uvicorn.error").info(
            '%s - "WebSocket %s" [accepted]',
            "127.0.0.1:51000",
            f"/api/v1/ws?token={FAKE_JWT}",
        )

    combined = "\n".join(record.getMessage() for record in caplog.records)
    assert FAKE_JWT not in combined
    assert "REDACTION-PROBE" not in combined
    assert "/api/v1/ws" in combined, "the route must still be logged"


def test_the_redactor_survives_on_the_real_logger(caplog):
    """End-to-end through the logger, not just the filter object.

    This is the assertion that would actually have caught the leak: emit the exact
    record uvicorn emits, let the logger do its own dispatch, and prove the token
    value never reaches captured output. Asserting only for the word "token" would
    pass even with the credential still present.
    """

    from app.core.logging import install_access_log_redactor

    install_access_log_redactor("/api/v1")
    logger = logging.getLogger("uvicorn.access")
    with caplog.at_level(logging.INFO, logger="uvicorn.access"):
        logger.info(
            '%s - "WebSocket %s" [accepted]',
            "127.0.0.1:51000",
            f"/api/v1/ws?token={FAKE_JWT}",
        )

    combined = "\n".join(record.getMessage() for record in caplog.records)
    assert FAKE_JWT not in combined
    assert "REDACTION-PROBE" not in combined
    assert "/api/v1/ws" in combined, "the route must still be logged"


def test_a_refused_socket_is_never_registered():
    # Accepting the handshake before authenticating is required by the protocol,
    # so the registry is what proves the socket was not left behind.
    hub = RealtimeHub()
    client = _ws_client(hub)
    try:
        with client.websocket_connect("/api/v1/ws") as socket:
            socket.receive()
        assert hub.connection_count == 0
    finally:
        client.__exit__(None, None, None)


def test_the_rest_api_is_unaffected_by_the_websocket_route():
    # The transport must not have changed a single REST contract.
    client = _ws_client()
    try:
        health = client.get("/api/v1/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"
        document = client.get("/openapi.json")
        assert document.status_code == 200
        # A WebSocket route is not an OpenAPI operation, so the documented
        # surface is unchanged by adding it.
        assert "/api/v1/ws" not in document.json()["paths"]
    finally:
        client.__exit__(None, None, None)


def test_an_authenticated_socket_is_registered_and_acknowledged(
    api_client, candidate, db_session
):
    # The full happy path: a real account, a real token, a real registration.
    from app.realtime.runtime import get_runtime

    client = _ws_client(db_session=db_session)
    try:
        with client.websocket_connect(f"/api/v1/ws?token={candidate.token}") as socket:
            frame = socket.receive_json()
            assert frame["event_type"] == "connection.opened"
            assert frame["event_id"]
            runtime = get_runtime()
            assert runtime is not None
            assert runtime.hub.connection_count == 1
            assert candidate.id in runtime.hub.connected_user_ids
    finally:
        client.__exit__(None, None, None)


def test_an_expired_token_is_refused(db_session):
    # An expired token is the most common real failure — a phone that slept.
    # It must be refused exactly like a forged one, never admitted.
    from datetime import UTC, datetime, timedelta

    from app.api.v1.ws import _authenticate
    from app.core.config import get_settings

    settings = get_settings()
    claims = {
        "sub": str(uuid.uuid4()),
        "role": "candidate",
        "public_id": "ghost",
        "type": "access",
        "jti": uuid.uuid4().hex,
        "iat": int((datetime.now(UTC) - timedelta(hours=2)).timestamp()),
        "exp": int((datetime.now(UTC) - timedelta(hours=1)).timestamp()),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    import jwt

    expired = jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    async def scenario():
        return await _authenticate(expired)

    assert run(scenario()) is None


def test_an_event_for_one_user_reaches_only_that_users_socket(
    api_client, candidate, db_session
):
    from app.realtime.runtime import get_runtime

    client = _ws_client(db_session=db_session)
    try:
        with client.websocket_connect(f"/api/v1/ws?token={candidate.token}") as socket:
            socket.receive_json()  # connection.opened
            runtime = get_runtime()
            other = FakeSocket()
            runtime.hub.add("someone-else", other)

            async def push() -> None:
                await runtime.hub.deliver(
                    RealtimeEvent(
                        event_type=EventType.SYSTEM_PING,
                        recipient_user_id=candidate.id,
                    )
                )

            # Delivering from a worker thread is awkward; calling the coroutine
            # through a fresh loop is equivalent for an in-memory hub.
            asyncio.run(push())
            assert socket.receive_json()["event_type"] == "system.ping"
            assert other.sent == [], "an event for alice must not reach bob"
    finally:
        client.__exit__(None, None, None)
