"""The realtime runtime: one hub and one bus per process.

FastAPI's ``lifespan`` starts and stops these. Keeping the objects here rather
than in module globals means a test can build an isolated runtime, and it is why
``main.py`` does not import the hub directly.
"""

from __future__ import annotations

import asyncio

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.redis import EventBus, LocalEventBus, build_event_bus
from app.realtime.events import EventType, RealtimeEvent
from app.realtime.hub import RealtimeHub

logger = get_logger("mahaa.realtime.runtime")


class RealtimeRuntime:
    """Owns the hub and the bus, and wires one to the other."""

    def __init__(self, hub: RealtimeHub, bus: EventBus) -> None:
        self.hub = hub
        self.bus = bus
        #: Captured in :meth:`start` so a synchronous caller can schedule onto it.
        self._loop: asyncio.AbstractEventLoop | None = None

    async def start(self) -> None:
        """Begin fanning bus events into the local hub.

        The handler is :meth:`RealtimeHub.deliver`, which is where targeting is
        decided — so an instance never forwards an event to a socket that was
        not named.
        """
        await self.bus.start(self.hub.deliver)
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:  # pragma: no cover - start always runs in a loop
            self._loop = None
        logger.info(
            "realtime runtime started",
            extra={
                "cross_instance": self.bus.cross_instance,
                "max_connections": len(self.hub.sockets_for("")),
            },
        )

    async def stop(self) -> None:
        """Close sockets, then the bus, in that order.

        Sockets first: closing the bus first would let an event arrive for a
        socket that is mid-shutdown and write to a closing transport.
        """
        closed = await self.hub.close_all()
        await self.bus.close()
        logger.info("realtime runtime stopped", extra={"sockets_closed": closed})

    async def publish(self, event: RealtimeEvent) -> None:
        await self.bus.publish(event)

    def publish_nowait(self, event: RealtimeEvent) -> None:
        """Publish from **synchronous** code, without waiting.

        The messaging service is synchronous — it commits with a plain
        ``session.commit()`` — so it has no ``await`` to attach a publish to.
        Scheduling onto the loop captured at startup is what lets a committed
        message be announced without turning the service into an async function
        and without blocking the request on Redis.

        Failures are swallowed deliberately. The row is already committed and
        REST has already answered; losing realtime must not turn that into a
        failed request. The loop reference is dropped when it is not running, so
        a publish during shutdown is a no-op rather than an error.
        """
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(self.bus.publish(event), loop)
        except RuntimeError:
            # The loop stopped between the check and the call, which happens
            # during shutdown. Nothing to do and nothing to report.
            return


def build_runtime() -> RealtimeRuntime:
    """Build a runtime from settings.

    With no ``REDIS_URL`` this is a :class:`LocalEventBus`: single-process
    fan-out that works for local development and for a single-instance
    deployment, and which reports itself as not cross-instance rather than
    pretending otherwise.
    """
    settings = get_settings()
    hub = RealtimeHub(max_connections=settings.realtime_max_connections)
    return RealtimeRuntime(hub=hub, bus=build_event_bus())


#: The process-wide runtime. ``None`` until ``lifespan`` starts one, and back to
#: ``None`` after shutdown. Health and the WebSocket route both read it through
#: :func:`get_runtime` so neither imports the other.
_runtime_instance: RealtimeRuntime | None = None


def set_runtime(runtime: RealtimeRuntime | None) -> None:
    """Install or clear the process runtime."""
    global _runtime_instance
    _runtime_instance = runtime


def get_runtime() -> RealtimeRuntime | None:
    """The running runtime, or ``None`` when realtime is not running."""
    return _runtime_instance


__all__ = [
    "EventType",
    "LocalEventBus",
    "RealtimeEvent",
    "RealtimeHub",
    "RealtimeRuntime",
    "build_runtime",
    "get_runtime",
    "set_runtime",
]
