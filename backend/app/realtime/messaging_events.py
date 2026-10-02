"""Publish messaging realtime events.

**This module never touches the database.** It takes values the messaging
service already derived from a *committed* transaction and stamps them onto the
Phase 1 envelope. That separation is the whole point: the service decides who may
hear about what, and this only encodes the decision.

Two invariants are enforced here rather than trusted:

**Publish after commit, never before.** Every entry point is called from the
service *after* ``session.commit()`` has returned, and the docstrings say so. An
event published before the commit would tell a recipient about a message that a
rollback then erased — the one failure a realtime layer can cause that no amount
of client-side reconciliation repairs.

**A delivery failure is never a request failure.** The message is already
committed and REST already answered. Losing realtime degrades the product; failing
the request would also lose the message from the sender's point of view, so every
publish path is wrapped and logged with a class name only.
"""

from __future__ import annotations

from app.core.logging import get_logger
from app.realtime.events import EventType, RealtimeEvent
from app.realtime.runtime import get_runtime

logger = get_logger("mahaa.realtime.messaging")


def _publish(event: RealtimeEvent) -> None:
    """Hand one event to the runtime bus, swallowing delivery failures.

    There is no runtime when realtime failed to boot, which is a supported state
    — the service is then process-local and simply has nowhere to send. Returning
    quietly is correct: the caller already committed.

    ``publish_nowait`` is used rather than awaiting because the messaging
    service is synchronous. It hands the publish to the event loop and returns,
    so a slow or unreachable Redis cannot add its latency to a request whose
    database work already succeeded.
    """
    runtime = get_runtime()
    if runtime is None:
        return
    try:
        runtime.publish_nowait(event)
    except Exception as exc:  # noqa: BLE001 - never fail a committed request
        # Class name only. Nothing about the message, the conversation or the
        # infrastructure belongs in a log line.
        logger.warning(
            "realtime messaging publish failed",
            extra={"event_type": event.event_type, "reason": type(exc).__name__},
        )


def message_created(
    *,
    recipient_user_id: str,
    message_id: str,
    conversation_id: str,
    sender_user_id: str,
    created_at: str,
    body: str | None,
    client_message_id: str | None,
) -> None:
    """Announce a stored message to its recipient.

    Call this **after** ``session.commit()``.

    The payload deliberately carries no email, no profile fields and no
    notification id. It carries exactly what a client needs to place the message
    in the thread it already has: the server ids and the body it will render.
    ``recipient_user_id`` was derived from the conversation's membership by the
    service, never from the request.
    """
    _publish(
        RealtimeEvent(
            event_type=EventType.MESSAGE_CREATED,
            recipient_user_id=recipient_user_id,
            payload={
                "message_id": message_id,
                "conversation_id": conversation_id,
                "sender_user_id": sender_user_id,
                "created_at": created_at,
                "body": body,
                "client_message_id": client_message_id,
            },
        )
    )


def conversation_read(
    *,
    recipient_user_id: str,
    conversation_id: str,
    reader_user_id: str,
    last_read_message_id: str | None,
    read_at: str,
) -> None:
    """Announce that one participant has advanced their read pointer.

    Call this **after** ``session.commit()``.

    ``reader_user_id`` is the authenticated caller, not anything the client sent.
    It is safe to publish: the sender is already a member of this conversation,
    which is exactly the audience a read receipt is for.
    """
    _publish(
        RealtimeEvent(
            event_type=EventType.CONVERSATION_READ,
            recipient_user_id=recipient_user_id,
            payload={
                "conversation_id": conversation_id,
                "reader_user_id": reader_user_id,
                "last_read_message_id": last_read_message_id,
                "read_at": read_at,
            },
        )
    )
