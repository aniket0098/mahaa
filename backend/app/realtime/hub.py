"""The in-process WebSocket registry.

This maps a user to the sockets currently attached to *this* process, and it is
the only thing that can push a frame to an open socket. It is deliberately **not**
the cross-instance transport: on Render a user's second device can land on a
different instance, and nothing here can reach it. That is what Redis Pub/Sub is
for, and the two are layered rather than merged so each stays small.

Three properties the rest of the design depends on:

**A user may hold many sockets.** One person on a phone and a tablet is two
sockets and two entries; removing one must not disconnect the other.

**A failing socket is removed, not fatal.** A send raises, or a socket is
already closed, and the only consequence is that this socket stops receiving.
The registry and the other sockets are untouched — a phone that lost signal
must not be able to stop the server talking to everyone else.

**Nothing here blocks.** Every send is awaited inside its own ``try``, so a slow
or wedged peer cannot stall the event loop or delay an unrelated user's event.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

from app.core.logging import get_logger
from app.realtime.events import EventType, RealtimeEvent

logger = get_logger("mahaa.realtime.hub")


class RealtimeHub:
    """Registry of live sockets, keyed by user id.

    All mutation happens on the event loop, and no method awaits between a read
    and a write of the registry, so no lock is needed. That is a real constraint,
    not an oversight: adding one would mean either holding it across an ``await``
    (which is how deadlocks happen) or making the API async for no benefit.
    """

    def __init__(self, max_connections: int = 1000) -> None:
        self._sockets: dict[str, set[Any]] = defaultdict(set)
        self._max_connections = max_connections

    # --- registry --------------------------------------------------------

    @property
    def connection_count(self) -> int:
        return sum(len(sockets) for sockets in self._sockets.values())

    @property
    def connected_user_ids(self) -> frozenset[str]:
        """Who is attached to this process, for tests and diagnostics."""
        return frozenset(self._sockets)

    def is_full(self) -> bool:
        return self.connection_count >= self._max_connections

    def sockets_for(self, user_id: str) -> frozenset[Any]:
        return frozenset(self._sockets.get(user_id, ()))

    def add(self, user_id: str, websocket: Any) -> None:
        self._sockets[user_id].add(websocket)

    def discard(self, user_id: str, websocket: Any) -> None:
        """Remove one socket, dropping the user key once their last one goes.

        ``discard`` rather than ``remove`` so a double disconnect — client gone
        *and* heartbeat timeout — is a no-op instead of a ``KeyError`` in the
        cleanup path, which is exactly where a raised exception would leave the
        registry inconsistent.
        """
        sockets = self._sockets.get(user_id)
        if sockets is None:
            return
        sockets.discard(websocket)
        if not sockets:
            self._sockets.pop(user_id, None)

    # --- delivery -------------------------------------------------------

    async def send_to_socket(self, websocket: Any, event: RealtimeEvent) -> bool:
        """Push one event to one socket.

        Returns whether the socket is still usable. ``False`` means the caller
        should unregister it — the exception or the dead socket is the evidence,
        and reporting it is what lets the caller clean up instead of retrying a
        peer that will never receive anything again.
        """
        try:
            await websocket.send_text(event.to_json())
        except Exception as exc:  # noqa: BLE001 - any send failure means "gone"
            logger.info(
                "realtime send failed; dropping socket",
                extra={"reason": type(exc).__name__, "event_type": event.event_type},
            )
            return False
        return True

    async def send_to_user(self, user_id: str, event: RealtimeEvent) -> int:
        """Deliver to every socket held by one user.

        Returns the number of sockets that accepted it. The caller's socket is
        included: a client that triggered an event usually wants the resulting
        state back too, and excluding it would need a second code path for no
        gain.
        """
        delivered = 0
        for websocket in list(self._sockets.get(user_id, ())):
            if await self.send_to_socket(websocket, event):
                delivered += 1
            else:
                self.discard(user_id, websocket)
        return delivered

    async def deliver(self, event: RealtimeEvent) -> int:
        """Route one event from the bus to whichever local sockets it targets.

        The authorisation decision is "does this event name me?" — nothing more.
        A client cannot ask for another user's events, and nothing is broadcast
        on the strength of a client-supplied topic.
        """
        recipient = event.recipient_user_id
        if recipient is None:
            # Untargeted events are dropped rather than broadcast: who should see
            # them is a decision that needs the audience, and that belongs to the
            # publishing domain, not to the transport.
            return 0
        return await self.send_to_user(recipient, event)

    async def broadcast_system(self, event: RealtimeEvent) -> int:
        """Send to every connected socket, used only for this instance's own
        lifecycle notices.

        Not used for application data: it bypasses per-user targeting by design,
        and it is the reason those lifecycle events carry no recipient.
        """
        delivered = 0
        for user_id, sockets in list(self._sockets.items()):
            for websocket in list(sockets):
                if await self.send_to_socket(websocket, event):
                    delivered += 1
                else:
                    self.discard(user_id, websocket)
        return delivered

    def prune(self) -> int:
        """Forget sockets that report themselves closed.

        A socket can be half-closed — the client vanished without a clean
        ``close`` frame, and no exception is raised until the next send. The
        registry would otherwise keep it until then, inflating the count and the
        memory. Returns how many were dropped.
        """
        removed = 0
        for user_id, sockets in list(self._sockets.items()):
            for websocket in list(sockets):
                state = getattr(websocket, "client_state", None)
                if state is not None and str(state).endswith(
                    ("DISCONNECTED", "CLOSED")
                ):
                    self.discard(user_id, websocket)
                    removed += 1
        return removed

    async def close_all(self) -> int:
        """Close every socket, for application shutdown.

        Uses ``gather(..., return_exceptions=True)`` so one socket that refuses
        to close cannot prevent the rest from being told to shut down.
        """
        sockets = [
            websocket
            for user_sockets in self._sockets.values()
            for websocket in user_sockets
        ]
        if not sockets:
            return 0
        await asyncio.gather(
            *(self._close_socket(websocket) for websocket in sockets),
            return_exceptions=True,
        )
        count = len(sockets)
        self._sockets.clear()
        return count

    async def _close_socket(self, websocket: Any) -> None:
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001 - shutdown is best-effort
            pass

    async def opened_notice(self, websocket: Any) -> RealtimeEvent:
        """Build and send the acknowledgement a fresh connection receives.

        Sent directly rather than through the bus: it is addressed to the socket
        that just arrived, not published, so another instance has nothing to do
        with it.
        """
        event = RealtimeEvent(
            event_type=EventType.CONNECTION_OPENED,
            payload={"protocol": "mahaa.realtime.v1"},
        )
        await self.send_to_socket(websocket, event)
        return event
