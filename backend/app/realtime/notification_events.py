"""Publish notification realtime events.

**The integration point is deliberately *not* ``services.notifications.emit``.**

``emit`` stages a row and returns; the domain operation commits. It is called
*before* its caller's ``session.commit()`` — that placement is what makes the
notification and the connection/message row land together. Publishing from inside
``emit`` would therefore announce a row that a rollback could still erase, which
is the one failure a realtime layer causes that no client can reconcile.

So this module is the publisher, and the three call sites invoke it *after* their
commit returns:

* ``services.connections`` — connection request / acceptance
* ``services.messaging`` — the message notification

A fourth safe point exists for any future caller: a session-level hook is *not*
used, because SQLAlchemy's ``after_commit`` fires for nested savepoints too and
would publish more than once per logical operation.

Payload fields are the notification's own public shape — the same names
``NotificationRead`` uses — so the client renders one object from either source.
Nothing here touches the database, commits, or authorizes.
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.realtime.events import EventType, RealtimeEvent
from app.realtime.runtime import get_runtime

logger = get_logger("mahaa.realtime.notifications")


def _publish(event: RealtimeEvent) -> None:
    """Hand one event to the runtime bus, swallowing delivery failures.

    The row is already committed and REST has already answered. Losing realtime
    degrades the product; failing the request would also lose the notification,
    so this never raises. Logs carry the exception class name only.
    """
    runtime = get_runtime()
    if runtime is None:
        # Realtime did not boot. A supported state — the service is then
        # process-local and simply has nowhere to send.
        return
    try:
        runtime.publish_nowait(event)
    except Exception as exc:  # noqa: BLE001 - never fail a committed request
        logger.warning(
            "realtime notification publish failed",
            extra={"event_type": event.event_type, "reason": type(exc).__name__},
        )


def notification_created(
    *,
    recipient_user_id: str,
    notification_id: str,
    notification_type: str,
    actor_user_id: str | None,
    target_type: str | None,
    target_id: str | None,
    title: str,
    body: str | None,
    data: dict[str, Any] | None,
    created_at: str,
    is_read: bool,
) -> None:
    """Announce a stored notification to its recipient.

    Call this **after** ``session.commit()``.

    ``recipient_user_id`` is ``notification.user_id`` — the row's own recipient,
    derived before the commit by whichever domain created it. No route, body or
    query parameter can reach this function, so a client cannot invent or redirect
    a notification.

    The payload deliberately carries no email, no profile fields and no actor
    summary. ``actor_user_id`` is an id and nothing more: the client resolves
    what it needs through ``/users/lookup``, which is the route that already
    decides what is disclosable. A notification is the most widely-read object in
    the product, so this is the right place to be strict.
    """
    _publish(
        RealtimeEvent(
            event_type=EventType.NOTIFICATION_CREATED,
            recipient_user_id=recipient_user_id,
            payload={
                "id": notification_id,
                "type": notification_type,
                "actor_user_id": actor_user_id,
                "target_type": target_type,
                "target_id": target_id,
                "title": title,
                "body": body,
                "data": data or {},
                "is_read": is_read,
                "created_at": created_at,
            },
        )
    )


def publish_for(notification: Any) -> None:
    """Publish the realtime event for an already-committed ``Notification`` row.

    The convenience wrapper for the call sites: it reads the row's own fields, so
    the event cannot drift from what was stored, and there is nothing for a caller
    to get wrong. Passing the ORM object rather than a bag of parameters is what
    makes "recipient is server-derived" structural rather than a convention.
    """
    notification_created(
        recipient_user_id=str(notification.user_id),
        notification_id=str(notification.id),
        notification_type=(
            notification.type.value
            if hasattr(notification.type, "value")
            else str(notification.type)
        ),
        actor_user_id=str(notification.actor_id) if notification.actor_id else None,
        target_type=notification.target_type,
        target_id=str(notification.target_id) if notification.target_id else None,
        title=notification.title,
        body=notification.body,
        data=notification.data,
        created_at=notification.created_at.isoformat(),
        is_read=bool(notification.is_read),
    )
