"""Redis: the cross-instance event bus, and nothing else.

Render can run more than one instance and replaces them freely, so an in-process
registry cannot reach a socket held elsewhere. Redis Pub/Sub is the minimum that
makes that work, and it is deliberately the *only* thing Redis is used for here.
No counters, no locks, no caching — those would need a different data model and a
different failure story.

**Redis is optional.** With no ``REDIS_URL`` configured:

* every REST route behaves exactly as before,
* the WebSocket hub still accepts and serves connections for a single process,
* :attr:`EventBus.cross_instance` reports ``False``, so callers can tell the
  truth instead of assuming delivery.

That is why ``redis`` is imported lazily: a deployment that never configures a
URL never needs the package to be importable at all.

No connection error is ever rendered with the URL in it. ``redis_url`` is a
credential — it commonly carries a password — so failures report the exception
*type* only, the same rule ``db/session.py`` already follows for a DSN.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

from app.core.config import get_settings
from app.core.logging import get_logger
from app.realtime.events import REDIS_CHANNEL, RealtimeEvent

logger = get_logger("mahaa.realtime.redis")

#: An event handler is given a decoded event and may await. It is called from
#: the subscriber task, so an exception here must not be allowed to escape.
EventHandler = Callable[[RealtimeEvent], Awaitable[None]]


class EventBus(Protocol):
    """What the realtime hub needs from a bus.

    A Protocol rather than a concrete class so the hub depends on three methods,
    and the test suite can pass a hand-written fake without needing a running
    Redis server.
    """

    async def publish(self, event: RealtimeEvent) -> None: ...

    async def start(self, handler: EventHandler) -> None: ...

    async def close(self) -> None: ...

    @property
    def cross_instance(self) -> bool:
        """Whether a published event reaches other processes."""
        ...


class LocalEventBus:
    """The no-Redis bus: delivery within this process only.

    This is the honest default. It is not a stub that pretends to be the real
    thing — ``cross_instance`` is ``False`` and readiness says so, so a
    single-instance deployment works correctly and a multi-instance one is
    visibly misconfigured rather than silently lossy.
    """

    def __init__(self) -> None:
        self._handler: EventHandler | None = None

    async def publish(self, event: RealtimeEvent) -> None:
        if self._handler is None:
            return
        try:
            await self._handler(event)
        except Exception:  # noqa: BLE001 - one bad event must not stop the bus
            logger.warning(
                "local realtime dispatch failed", extra={"type": event.event_type}
            )

    async def start(self, handler: EventHandler) -> None:
        self._handler = handler

    async def close(self) -> None:
        self._handler = None

    @property
    def cross_instance(self) -> bool:
        return False


class RedisEventBus:
    """Pub/Sub fan-out over Redis.

    The subscriber is a supervised task rather than a bare ``await``: a dropped
    Redis connection must reconnect on its own, because a silently dead
    subscriber is precisely the failure this component exists to prevent — every
    instance would look healthy while receiving nothing.
    """

    #: How long to wait before reconnecting after the subscription drops.
    #: Long enough not to spin against a Redis that is down, short enough that
    #: a blip does not look like an outage.
    reconnect_delay_seconds = 1.0

    def __init__(self, url: str) -> None:
        self._url = url
        self._handler: EventHandler | None = None
        self._pubsub: Any = None
        self._task: asyncio.Task[None] | None = None
        self._closing = False

    async def start(self, handler: EventHandler) -> None:
        self._handler = handler
        self._closing = False
        self._task = asyncio.create_task(
            self._supervise(), name="mahaa-realtime-subscriber"
        )

    async def close(self) -> None:
        self._closing = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except BaseException:  # noqa: BLE001 - shutdown is best-effort
                pass
            self._task = None
        if self._pubsub is not None:
            try:
                await self._pubsub.unsubscribe()
                await self._pubsub.aclose()
            except Exception:  # noqa: BLE001 - shutdown is best-effort
                pass
            self._pubsub = None

    @property
    def cross_instance(self) -> bool:
        return True

    async def ping(self) -> bool:
        """Whether Redis answers. Used by readiness only, never raises."""
        client = None
        try:
            client = await self._client()
            return bool(await client.ping())
        except Exception:  # noqa: BLE001 - a health check reports, never raises
            return False
        finally:
            if client is not None:
                try:
                    await client.aclose()
                except Exception:  # noqa: BLE001
                    pass

    async def _client(self) -> Any:
        try:
            from redis.asyncio import Redis
        except ImportError as exc:  # pragma: no cover - depends on install
            raise RuntimeError("redis package is not installed") from exc
        # Never logged and never raised with the URL attached: it is a credential.
        return Redis.from_url(self._url, decode_responses=True)

    async def publish(self, event: RealtimeEvent) -> None:
        client = None
        try:
            client = await self._client()
            await client.publish(REDIS_CHANNEL, event.to_json())
        except Exception as exc:  # noqa: BLE001 - fan-out is best-effort
            # Class name only; the message can contain the URL.
            logger.warning(
                "realtime publish failed",
                extra={"reason": type(exc).__name__, "event_type": event.event_type},
            )
        finally:
            if client is not None:
                try:
                    await client.aclose()
                except Exception:  # noqa: BLE001
                    pass

    async def _supervise(self) -> None:
        """Subscribe, dispatch, and reconnect until closed.

        The loop is the whole point: any failure — a dropped connection, a
        malformed frame, a handler that raises — returns to the top and
        re-subscribes instead of ending the task.
        """
        while not self._closing:
            try:
                client = await self._client()
                self._pubsub = client.pubsub(ignore_subscribe_messages=True)
                await self._pubsub.subscribe(REDIS_CHANNEL)
                logger.info("realtime subscribed", extra={"channel": REDIS_CHANNEL})
                async for message in self._pubsub.listen():
                    if self._closing:
                        break
                    await self._dispatch(message)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - supervise must survive
                logger.warning(
                    "realtime subscriber error", extra={"reason": type(exc).__name__}
                )
            finally:
                if self._pubsub is not None:
                    try:
                        await self._pubsub.aclose()
                    except Exception:  # noqa: BLE001
                        pass
                    self._pubsub = None
            if self._closing:
                break
            await asyncio.sleep(self.reconnect_delay_seconds)

    async def _dispatch(self, message: Any) -> None:
        """Decode one Pub/Sub frame and hand it on.

        A malformed frame is dropped rather than raised: it would otherwise
        escape into :meth:`_supervise` and force a needless reconnect, turning
        one bad message into an outage.
        """
        data = message.get("data") if isinstance(message, dict) else None
        if not isinstance(data, (str, bytes)):
            return
        try:
            event = RealtimeEvent.from_dict(json.loads(data))
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "realtime event dropped", extra={"reason": type(exc).__name__}
            )
            return
        if self._handler is None:
            return
        try:
            await self._handler(event)
        except Exception:  # noqa: BLE001 - one handler must not kill the subscriber
            logger.warning("realtime handler failed", extra={"type": event.event_type})


def build_event_bus() -> EventBus:
    """Pick a bus from configuration.

    A URL is enough to choose Redis, and a failure to connect is *not* raised
    here: the hub starts either way and the subscriber retries. Booting the HTTP
    service is a bigger commitment than booting realtime, and one unreachable
    Redis must not take the REST API down with it.
    """
    settings = get_settings()
    if settings.redis_url.strip():
        return RedisEventBus(settings.redis_url.strip())
    logger.info("realtime fan-out is process-local (no REDIS_URL configured)")
    return LocalEventBus()
