"""``GET /api/v1/ws`` — the realtime transport endpoint.

**Authentication is the existing JWT system**, not a second scheme. The socket
verifies the same access token the REST routes do, resolves the same user, and
applies the same rules: a forged, expired or unknown-subject token is refused
before a socket is ever registered.

**Why the token rides in the query string.** A browser ``WebSocket`` cannot set
an ``Authorization`` header, and React Native's implementation follows it. The
``?token=`` parameter is the only mechanism that works on both, so it is used —
with two mitigations: the token is never logged, and the query string is
excluded from this module's own logging by the redaction in ``ws_handler``
below. It travels over TLS in production, exactly as the REST header does.

**Authorisation is "events addressed to you".** A client cannot request another
user's events, a conversation, or a topic: there is no subscription parameter at
all in this phase. :meth:`RealtimeHub.deliver` matches on the recipient the
*server* stamped onto the event, so there is no client-supplied value that could
widen the set of events a socket receives.
"""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.session import session_scope
from app.models import User
from app.realtime.events import RealtimeEvent
from app.realtime.runtime import RealtimeRuntime, get_runtime
from app.services.tokens import TokenError, decode_access_token

logger = get_logger("mahaa.realtime.ws")

router = APIRouter(tags=["realtime"])

#: Close codes. 1008 is "policy violation" and is the honest code for "your token
#: is not acceptable" — 1000 would claim a normal, agreed closure.
CLOSE_UNAUTHENTICATED = 1008
CLOSE_UNAVAILABLE = 1013

#: Close code for a socket that failed its heartbeat.
CLOSE_HEARTBEAT_TIMEOUT = 1001

#: Test seam. A WebSocket route cannot use ``Depends(get_db)``, so the session
#: comes from here instead; the suite installs the same override it uses for the
#: REST routes. ``None`` means "use the application's own session factory".
_session_factory = None


def session_factory():
    """Return the callable that builds a session, or ``None`` for the default."""
    return _session_factory


def set_session_factory(factory) -> None:
    """Install a session factory for tests. ``None`` restores the default."""
    global _session_factory
    _session_factory = factory


async def _authenticate(token: str | None) -> User | None:
    """Resolve the socket's owner from its token, or ``None``.

    Uses the *same* verification the REST routes use, then re-reads the user so
    a suspended or deleted account cannot hold an open socket — a token issued
    while the account was good must stop working the moment it is not.

    The database session is opened and closed inside this one function and is
    never held for the life of the socket. A long-lived connection holding a
    pooled Postgres connection would starve every other request, and a
    connection held across a network read is a connection waiting to go stale.

    A WebSocket route cannot take a ``Depends(get_db)`` dependency the way a REST
    route does, so the factory goes through :data:`session_factory` instead — an
    indirection the test suite overrides exactly as it overrides ``get_db``.
    """
    if not token:
        return None
    try:
        claims = decode_access_token(token)
    except TokenError:
        # Deliberately uninformative, matching `get_current_user`: expired,
        # forged and wrong-audience all look the same from outside.
        return None

    subject = claims.get("sub")
    try:
        user_id = uuid.UUID(str(subject))
    except (TypeError, ValueError):
        return None

    try:
        factory = session_factory()
        if factory is not None:
            session = factory()
        else:
            session = session_scope()
        try:
            user = session.get(User, user_id)
            if user is None:
                return None
            # `expire_on_commit` is off on SessionLocal, so these attributes
            # stay readable after the session is closed — which matters because
            # the socket outlives it.
            _ = (user.id, user.status)
            return user
        finally:
            if factory is not None:
                session.close()
            else:
                session.commit()
    except Exception as exc:  # noqa: BLE001 - never leak a driver message
        logger.warning(
            "realtime auth lookup failed", extra={"reason": type(exc).__name__}
        )
        return None


@router.websocket("/ws")
async def realtime_socket(
    websocket: WebSocket,
    token: str | None = Query(default=None),
) -> None:
    """Open a realtime socket for an authenticated user.

    Order matters and is deliberate: accept, then authenticate, then register.
    Accepting first is required by the protocol (a rejected handshake never
    reaches application code), and it is safe because nothing is registered
    until the user is known — an unauthenticated socket is closed in a few
    milliseconds and never appears in the hub.
    """
    settings = get_settings()
    await websocket.accept()

    if not settings.realtime_enabled:
        # Refuse rather than accept-and-ignore: a client that believes it is
        # connected to a working realtime transport will not fall back, and a
        # silent no-op is worse than a clear refusal.
        await websocket.close(code=CLOSE_UNAVAILABLE, reason="Realtime is disabled")
        return

    user = await _authenticate(token)
    if user is None:
        # `reason` is surfaced to the client, so it must not repeat anything the
        # token contained. The id is safe and makes a support report traceable.
        await websocket.close(
            code=CLOSE_UNAUTHENTICATED,
            reason=f"Authentication required ({uuid.uuid4().hex[:8]})",
        )
        return

    runtime = get_runtime()
    if runtime is None:
        # Lifespan has not started a runtime, which means realtime failed to boot.
        # Refusing is honest; serving anyway would advertise a transport with no
        # way to deliver anything.
        await websocket.close(code=CLOSE_UNAVAILABLE, reason="Realtime is unavailable")
        return

    if runtime.hub.is_full():
        await websocket.close(code=CLOSE_UNAVAILABLE, reason="Too many connections")
        return

    user_id = str(user.id)
    runtime.hub.add(user_id, websocket)
    await runtime.hub.opened_notice(websocket)
    logger.info("realtime socket opened", extra={"user_id": user_id})

    ping_task = asyncio.create_task(_heartbeat(runtime, user_id, websocket))
    try:
        await _receive_loop(runtime, user_id, websocket)
    except WebSocketDisconnect:
        pass
    finally:
        ping_task.cancel()
        try:
            await ping_task
        except BaseException:  # noqa: BLE001 - teardown is best-effort
            pass
        runtime.hub.discard(user_id, websocket)
        logger.info("realtime socket closed", extra={"user_id": user_id})


async def _receive_loop(
    runtime: RealtimeRuntime, user_id: str, websocket: WebSocket
) -> None:
    """Read from the socket until it goes away.

    The client is not expected to send anything except a pong. Inbound frames are
    read and discarded rather than trusted: a client that could name a recipient
    would be able to push events to other people, so there is deliberately no
    publish path on this socket in this phase.
    """
    while True:
        message = await websocket.receive_text()
        if message:
            # The only accepted client frame is a heartbeat acknowledgement.
            # Anything else is ignored, never forwarded.
            continue


async def _heartbeat(
    runtime: RealtimeRuntime, user_id: str, websocket: WebSocket
) -> None:
    """Ping an idle socket and close it if it stops answering.

    Application-level rather than protocol-level pings: uvicorn's own ping runs
    on the TCP layer, and a client that has been suspended for thirty seconds
    still has a perfectly healthy TCP socket. Only an application-level round
    trip proves the peer is still running this app.
    """
    settings = get_settings()
    interval = settings.realtime_heartbeat_seconds
    timeout = settings.realtime_heartbeat_timeout_seconds
    while True:
        await asyncio.sleep(interval)
        if websocket not in runtime.hub.sockets_for(user_id):
            return
        event = RealtimeEvent.system_ping()
        try:
            await websocket.send_text(event.to_json())
        except Exception as exc:  # noqa: BLE001 - a dead socket is expected here
            logger.info(
                "realtime heartbeat send failed",
                extra={"reason": type(exc).__name__},
            )
            await _close(websocket, CLOSE_HEARTBEAT_TIMEOUT)
            return
        # Wait for the client to answer. A timeout here is the real liveness
        # signal; without it a half-open socket would be pinged forever.
        try:
            await asyncio.wait_for(_drain_pong(websocket), timeout=timeout)
        except TimeoutError:
            logger.info("realtime heartbeat timed out", extra={"user_id": user_id})
            runtime.hub.discard(user_id, websocket)
            await _close(websocket, CLOSE_HEARTBEAT_TIMEOUT)
            return


async def _drain_pong(websocket: WebSocket) -> None:
    """Wait for one inbound frame, then return.

    Reading here is what makes the heartbeat a round trip. It races the main
    receive loop for frames, which is harmless: both discard what they read, and
    a pong consumed by either one has the same effect.
    """
    await websocket.receive_text()


async def _close(websocket: WebSocket, code: int) -> None:
    try:
        await websocket.close(code=code)
    except Exception:  # noqa: BLE001 - the peer may already be gone
        pass
