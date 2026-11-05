"""Publish call-signalling realtime events.

**This module never touches the database**, exactly like ``messaging_events``.
It takes values the call service already derived from a *committed* transition
and stamps them onto the Phase 1 envelope. Same two invariants hold here:

**Publish after commit, never before.** A ringing call that never persisted
would ring a phone that the database then forgets — the call-service equivalent
of the "message that a rollback erased". Every entry point is called after
``session.commit()`` returns.

**A delivery failure is never a request failure.** The call already committed and
REST already answered; realtime is the optimisation, not the mechanism. The
caller hangs up or the ring times out regardless, so every publish path swallows
and logs with a class name only.

**No event carries a token, a room URL, or any media value.** Signalling says
*that* a call exists and *what state* it is in; the client fetches a short-lived
LiveKit token on demand from the token endpoint. Keeping the token out of the
socket means a token is never written to the Redis channel, never logged, and
never replayed from a buffered frame after it has expired.

**Every call event is targeted at one participant.** A call is between two
people, so there is no broadcast here — ``call.incoming`` goes to the callee,
``call.accepted`` and ``call.ended`` go to the other member. This is the
deliberate opposite of ``post.created``.
"""

from __future__ import annotations

from app.core.logging import get_logger
from app.realtime.events import EventType, RealtimeEvent
from app.realtime.runtime import get_runtime

logger = get_logger("mahaa.realtime.calls")


def _publish(event: RealtimeEvent) -> None:
    """Hand one event to the runtime bus, swallowing delivery failures.

    ``publish_nowait`` rather than awaiting, because the call service is
    synchronous: the database work already succeeded and a slow Redis must not
    add latency to a request whose commit already returned.
    """

    runtime = get_runtime()
    if runtime is None:
        return
    try:
        runtime.publish_nowait(event)
    except Exception as exc:  # noqa: BLE001 - never fail a committed request
        logger.warning(
            "realtime call publish failed",
            extra={"event_type": event.event_type, "reason": type(exc).__name__},
        )


def call_incoming(
    *,
    recipient_user_id: str,
    call_id: str,
    conversation_id: str,
    caller_user_id: str,
    mode: str,
) -> None:
    """Announce a ringing call to the callee.

    Call this **after** ``session.commit()``.

    The payload is only what a client needs to show an incoming-call screen and
    nothing else: which call, which thread, who is calling, and audio or video.
    No caller profile is included — the callee already has a conversation with
    this person and can resolve the display name locally; a socket payload that
    echoes profile fields is a second source of truth for data the thread
    already owns.
    """

    _publish(
        RealtimeEvent(
            event_type=EventType.CALL_INCOMING,
            recipient_user_id=recipient_user_id,
            payload={
                "call_id": call_id,
                "conversation_id": conversation_id,
                "caller_user_id": caller_user_id,
                "mode": mode,
            },
        )
    )


def call_accepted(
    *,
    recipient_user_id: str,
    call_id: str,
    conversation_id: str,
    callee_user_id: str,
) -> None:
    """Tell the caller the callee answered and may now join the room.

    Call this **after** ``session.commit()``.

    This is the caller's cue to fetch a token and connect; the callee already
    navigated when it called accept, so it does not need this event back.
    """

    _publish(
        RealtimeEvent(
            event_type=EventType.CALL_ACCEPTED,
            recipient_user_id=recipient_user_id,
            payload={
                "call_id": call_id,
                "conversation_id": conversation_id,
                "callee_user_id": callee_user_id,
            },
        )
    )


def call_ended(
    *,
    recipient_user_id: str,
    call_id: str,
    conversation_id: str,
    status: str,
    ended_by_user_id: str | None,
) -> None:
    """Tell the other participant a call reached a terminal state.

    Call this **after** ``session.commit()``.

    One event for every outcome — ended, rejected, cancelled or expired — because
    the client has exactly one response to all four: dismiss the call screen.
    The specific reason is in ``status``, so a missed-call row and a declined
    call can render differently without a second event type. ``ended_by_user_id``
    is null when the reaper expired the call or the caller cancelled before
    answer; it is never fabricated, because "who hung up" is a fact the server
    either knows or does not.
    """

    _publish(
        RealtimeEvent(
            event_type=EventType.CALL_ENDED,
            recipient_user_id=recipient_user_id,
            payload={
                "call_id": call_id,
                "conversation_id": conversation_id,
                "status": status,
                "ended_by_user_id": ended_by_user_id,
            },
        )
    )
