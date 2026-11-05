"""The calling domain: start, accept, reject, cancel, hang up, token, history.

**Every rule that decides *who may do what* lives here**, not in the route, so
the five state-changing endpoints cannot drift apart and each rule is testable
without HTTP.

**Authorization is inherited from the conversation.** A call may only exist
between the two members of an existing 1:1 conversation, and both participants
are resolved through the bound conversation's membership rows rather than trusted
from the request. ``CallCreate`` has no ``callee_id`` field precisely so a client
cannot name a ring target. A non-member gets the same 404 as "no such call" â€” the
anti-enumeration rule Phase 4 and Phase 5 both apply.

**A call is a durable row, so an unanswered ring is a missed call.** Every
transition stamps a server clock and publishes realtime **after** the commit. A
client that was offline when the call started still sees it in history and can
still fetch a token for it, because the row â€” not the socket â€” is the state.

**One live call per conversation, and no busy-ignoring.** The unique partial
index in ``models/calls.py`` makes a duplicate invitation impossible at the
database level, so a second ``start`` while one is ringing *returns that call*
rather than creating another. Separately, ``_assert_free`` refuses to ring a
person who is already in a live call elsewhere, and refuses to let somebody in an
active call start another. This is stated rather than silent because a "ring
anyway and let them choose" design would make a call joinable in two rooms at
once, which a 1:1 call cannot be.

**Tokens are minted, never stored.** ``token()`` verifies participation and that
the call is not terminal, then delegates to ``services.livekit_tokens``. Nothing
on the ``Call`` row holds a credential, and the room name in the token comes from
the row rather than being re-derived, so a token always opens the room the call
was created with.

**No call notification type is added here.** ``call.incoming`` on the realtime
socket is the ring, and it is delivered without a database round trip. The
``notifications.type`` registry stays exactly as Â§13.1's producible set defines
it; widening it is a migration, and a migration is the reviewable event a client
contract deserves.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError, ErrorCode
from app.models import Call, ConversationMember, User
from app.models.enums import CallStatus
from app.realtime import call_events
from app.schemas.calls import CallCreate, CallRead
from app.services import livekit_tokens
from app.services.ownership import parse_id

#: A call history page. Offset pagination, unlike messages: history is bounded by
#: a pair's real conversations and is read for a "recent calls" list, so a real
#: ``total`` is affordable and useful.
CALL_PAGE_MAX = 100
CALL_PAGE_DEFAULT = 25

#: Terminal states. Every call reaches exactly one of these, so "is this call
#: over?" is one membership test rather than four comparisons that could drift.
TERMINAL: frozenset[CallStatus] = frozenset(
    {
        CallStatus.ENDED,
        CallStatus.REJECTED,
        CallStatus.CANCELLED,
        CallStatus.EXPIRED,
    }
)

# --- errors -------------------------------------------------------------------
#
# One message per outcome, and nothing a caller could not already know. A 404
# never says "not yours" and a 403 never says why â€” the same discipline as
# messaging and connections, for the same reason: a distinguishable answer is an
# enumeration oracle.


def _call_not_found() -> ApiError:
    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message="That call was not found.",
    )


def _conversation_not_found() -> ApiError:
    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message="That conversation was not found.",
    )


def _not_joinable() -> ApiError:
    """409 â€” the call exists and is the caller's, but it is already over.

    A terminal call has no room left to join. This is a 409 and not a 404 because
    the caller is a participant: telling them "not found" about a call they can
    see in their own history would be the lie a 404 exists to tell.
    """

    return ApiError(
        status_code=409,
        code=ErrorCode.CONFLICT,
        message="That call has already ended.",
    )


def _wrong_state() -> ApiError:
    """409 â€” the transition is not legal from the call's current state.

    ``accept`` on an ``accepted`` call and ``reject`` on an ``ended`` one both
    land here. The message names neither the current state nor the attempted one,
    so it cannot be used to probe a call's status from outside.
    """

    return ApiError(
        status_code=409,
        code=ErrorCode.CONFLICT,
        message="That call is not in a state that allows this.",
    )


def _busy() -> ApiError:
    """409 â€” one of the two people is already in a live call.

    Deliberately does not say *which* of them: "you are busy" and "they are busy"
    are different facts, and a caller who can tell them apart can use this
    endpoint to check whether a specific person is on a call right now. One
    sentence covers both.
    """

    return ApiError(
        status_code=409,
        code=ErrorCode.CONFLICT,
        message="One of you is already in a call.",
    )


def _forbidden_transition() -> ApiError:
    """403 â€” the caller is a participant but not the one who may do this.

    Only ``reject`` and ``cancel`` are role-bound; ``accept`` is the callee's by
    construction and ``end`` is open to either side, so a non-callee ``reject``
    and a non-caller ``cancel`` are the only two paths here.
    """

    return ApiError(
        status_code=403,
        code=ErrorCode.FORBIDDEN,
        message="You cannot do that to this call.",
    )


# --- lookups ------------------------------------------------------------------


def _live_call_for(session: Session, conversation_id: uuid.UUID) -> Call | None:
    """The one RINGING or ACCEPTED call in this conversation, if any.

    Filtered by conversation *and* live status so the partial unique index and
    this query agree: the index guarantees at most one live row per conversation,
    so this returns it deterministically instead of racing.
    """

    return session.scalar(
        select(Call).where(
            Call.conversation_id == conversation_id,
            Call.status.in_([CallStatus.RINGING, CallStatus.ACCEPTED]),
        )
    )


def _load_participant(
    session: Session, viewer: User, raw_id: str
) -> tuple[Call, bool]:
    """Load a call and say whether the viewer is its caller.

    The participant filter is *part of the lookup*, not a check performed after
    it, so there is no window in which another account's call has been loaded. A
    non-participant, a non-member and an unknown id all reach the same 404.
    """

    call_id = parse_id(raw_id, "call")
    call = session.scalar(
        select(Call).where(
            Call.id == call_id,
            or_(Call.caller_id == viewer.id, Call.callee_id == viewer.id),
        )
    )
    if call is None:
        raise _call_not_found()
    return call, call.caller_id == viewer.id


def _assert_free(session: Session, viewer_id: uuid.UUID, other_id: uuid.UUID) -> None:
    """Neither participant may already be in a live call.

    Checked in both roles, because "is this person in a call?" is the question the
    ``ix_calls_callee_id_status`` index exists to answer cheaply. The other
    conversation is not excluded, because letting a busy person be rung by a
    second thread is the same double-room problem under a different name.
    """

    busy = session.scalar(
        select(Call.id).where(
            Call.status.in_([CallStatus.RINGING, CallStatus.ACCEPTED]),
            or_(
                or_(Call.caller_id == viewer_id, Call.callee_id == viewer_id),
                or_(Call.caller_id == other_id, Call.callee_id == other_id),
            ),
        )
    )
    if busy is not None:
        raise _busy()


def _display_name(user: User) -> str:
    """The name the other participant sees in LiveKit's own UI.

    The profile's display name when it exists, otherwise the handle. Never the
    email: the room is shared with exactly one other person who already knows who
    is calling, and an email is not a display name.
    """

    return user.name or user.handle or "Mahaa member"


def call_read(call: Call) -> CallRead:
    """The public shape of a call.

    Ids are rendered as strings because every other read model in the project
    does the same, and timestamps are ISO-8601 UTC from the server's own clock.
    There is no ``direction`` field: a client compares ``caller_id`` to its own
    id, so there is no second opinion that could disagree with the row.
    """

    return CallRead(
        id=str(call.id),
        conversation_id=str(call.conversation_id),
        caller_id=str(call.caller_id),
        callee_id=str(call.callee_id),
        mode=str(call.mode),
        status=str(call.status),
        created_at=call.created_at.isoformat(),
        answered_at=call.answered_at.isoformat() if call.answered_at else None,
        ended_at=call.ended_at.isoformat() if call.ended_at else None,
        ended_by=str(call.ended_by) if call.ended_by else None,
    )


def _other_of(call: Call, viewer_id: uuid.UUID) -> uuid.UUID:
    """The participant who is not ``viewer_id`` â€” the audience for an event."""

    return call.callee_id if call.caller_id == viewer_id else call.caller_id


def read(session: Session, viewer: User, raw_id: str) -> CallRead:
    """GET /calls/{id}"" — the row the active screen tracks.

    Members only, via _load_participant: a non-participant gets the
    same 404 as an unknown id, so the endpoint leaks nothing about which calls
    exist. No state change — polling it cannot ring, answer or end anything.
    """

    call, _is_caller = _load_participant(session, viewer, raw_id)
    return call_read(call)


# --- operations ---------------------------------------------------------------


def start(
    session: Session, viewer: User, raw_conversation_id: str, payload: CallCreate
) -> tuple[CallRead, bool]:
    """``POST /conversations/{id}/calls`` â€” ring the other member.

    Returns the call and whether it was newly created, so the route can answer
    201 or 200 honestly. A second ``start`` while one is ringing returns the
    existing call rather than creating a duplicate invitation â€” the partial unique
    index is what makes that safe, and reporting 201 for a call that already
    existed would be the same lie Phase 4 refused for a duplicate connection
    request.

    ``mode`` comes from the body and nothing else does. The callee is the other
    member of the conversation, the room name is generated here, and the status
    is ``RINGING`` by construction.
    """

    conversation_id = parse_id(raw_conversation_id, "conversation")

    member = session.scalar(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == viewer.id,
        )
    )
    if member is None:
        # Same 404 as "no such conversation". A caller who is not a member must
        # not learn the thread exists.
        raise _conversation_not_found()

    existing = _live_call_for(session, conversation_id)
    if existing is not None:
        return call_read(existing), False

    callee_id = session.scalar(
        select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id != viewer.id,
        )
    )
    if callee_id is None:
        raise _conversation_not_found()
    _assert_free(session, viewer.id, callee_id)

    call = Call(
        conversation_id=conversation_id,
        room_name=f"mahaa-call-{uuid.uuid4()}",
        caller_id=viewer.id,
        callee_id=callee_id,
        mode=payload.mode,
        status=CallStatus.RINGING,
    )
    session.add(call)
    try:
        session.commit()
    except IntegrityError as exc:
        # Lost the race against another start: the partial unique index decided,
        # and the loser re-reads the winner's row instead of returning a 500.
        session.rollback()
        winner = _live_call_for(session, conversation_id)
        if winner is None:
            raise _busy() from exc
        return call_read(winner), False

    session.refresh(call)

    # After the commit, to the callee only. The caller's own device already has
    # the call it just created and is navigating to it.
    call_events.call_incoming(
        recipient_user_id=str(callee_id),
        call_id=str(call.id),
        conversation_id=str(conversation_id),
        caller_user_id=str(viewer.id),
        mode=str(call.mode),
    )
    return call_read(call), True


def accept(session: Session, viewer: User, raw_id: str) -> CallRead:
    """``POST /calls/{id}/accept`` â€” the callee picks up.

    Only legal from ``RINGING``. ``answered_at`` is the server clock, and it is
    what makes duration and a missed-call record computable later.

    The event goes to the **caller**, which is the participant that now knows it
    may fetch a token and join. The callee answered through REST and already has
    the response, so echoing this back to it would be noise.
    """

    call, is_caller = _load_participant(session, viewer, raw_id)
    if is_caller:
        # The caller cannot accept their own ring. A 404 rather than a 403, so
        # this does not confirm the call's state to anybody probing it.
        raise _call_not_found()
    if call.status != CallStatus.RINGING:
        raise _wrong_state()

    call.status = CallStatus.ACCEPTED
    call.answered_at = _now()
    session.add(call)
    session.commit()

    call_events.call_accepted(
        recipient_user_id=str(call.caller_id),
        call_id=str(call.id),
        conversation_id=str(call.conversation_id),
        callee_user_id=str(call.callee_id),
    )
    return call_read(call)


def reject(session: Session, viewer: User, raw_id: str) -> CallRead:
    """``POST /calls/{id}/reject`` â€” the callee declines before answering.

    Terminal, so it is only legal from ``RINGING``; rejecting an answered call is
    a hang-up, which is ``end``. ``ended_by`` is the callee, which is what makes a
    declined call distinguishable from an expired one in history.
    """

    call, is_caller = _load_participant(session, viewer, raw_id)
    if is_caller:
        raise _call_not_found()
    if call.status != CallStatus.RINGING:
        raise _wrong_state()

    call.status = CallStatus.REJECTED
    call.ended_at = _now()
    call.ended_by = viewer.id
    session.add(call)
    session.commit()

    call_events.call_ended(
        recipient_user_id=str(call.caller_id),
        call_id=str(call.id),
        conversation_id=str(call.conversation_id),
        status=str(call.status),
        ended_by_user_id=str(viewer.id),
    )
    return call_read(call)


def cancel(session: Session, viewer: User, raw_id: str) -> CallRead:
    """``POST /calls/{id}/cancel`` â€” the caller gives up before an answer.

    Caller-only, because "cancel my ring" is the caller's own action and the
    callee's equivalent is ``reject``. Terminal from ``RINGING`` only.
    """

    call, is_caller = _load_participant(session, viewer, raw_id)
    if not is_caller:
        raise _forbidden_transition()
    if call.status != CallStatus.RINGING:
        raise _wrong_state()

    call.status = CallStatus.CANCELLED
    call.ended_at = _now()
    call.ended_by = viewer.id
    session.add(call)
    session.commit()

    call_events.call_ended(
        recipient_user_id=str(call.callee_id),
        call_id=str(call.id),
        conversation_id=str(call.conversation_id),
        status=str(call.status),
        ended_by_user_id=str(viewer.id),
    )
    return call_read(call)


def end(session: Session, viewer: User, raw_id: str) -> CallRead:
    """``POST /calls/{id}/end`` â€” hang up.

    **Either participant may end an answered call**, which is the one transition
    with no role restriction: a call is over when either side leaves it. Legal
    from ``ACCEPTED``; ending a still-ringing call is ``cancel`` for the caller
    and ``reject`` for the callee, so those keep their meaning instead of both
    collapsing into one verb.

    ``ended_by`` is the authenticated caller â€” never a field from the request â€”
    and the event goes to the *other* participant, derived from the row.
    """

    call, _is_caller = _load_participant(session, viewer, raw_id)
    if call.status != CallStatus.ACCEPTED:
        raise _wrong_state()

    call.status = CallStatus.ENDED
    call.ended_at = _now()
    call.ended_by = viewer.id
    session.add(call)
    session.commit()

    call_events.call_ended(
        recipient_user_id=str(_other_of(call, viewer.id)),
        call_id=str(call.id),
        conversation_id=str(call.conversation_id),
        status=str(call.status),
        ended_by_user_id=str(viewer.id),
    )
    return call_read(call)


def token(session: Session, viewer: User, raw_id: str) -> dict[str, str]:
    """``GET /calls/{id}/token`` â€” a short-lived LiveKit join token.

    Two conditions, both checked here rather than trusted: the viewer is a
    participant (enforced by :func:`_load_participant`), and the call has not
    reached a terminal state. A token for a finished call would be a credential
    to an empty room, so that is a 409 rather than a token that silently fails at
    LiveKit.

    The token is scoped to this call's room and the viewer's own identity, and it
    is minted fresh on every request rather than cached â€” see
    ``services/livekit_tokens``.
    """

    call, _is_caller = _load_participant(session, viewer, raw_id)
    if call.status in TERMINAL:
        raise _not_joinable()

    if not livekit_tokens.is_configured():
        # 503 rather than 500: the caller is allowed in, the deployment is not
        # wired. Distinguishable, and honest about which of the two is missing.
        raise livekit_tokens.not_configured()

    # The room name is read from the row, never re-derived, so a token always
    # opens the room this call was created with.
    return livekit_tokens.mint(
        room_name=call.room_name,
        user_id=viewer.id,
        display_name=_display_name(viewer),
        can_publish=True,
    )


def history(
    session: Session, viewer: User, raw_conversation_id: str, limit: int, offset: int
) -> tuple[list[CallRead], int]:
    """``GET /conversations/{id}/calls`` â€” this conversation's call history.

    Newest first, which is what a "recent calls" list renders. Both participants
    see the same rows: a call between two people is one record with two views, and
    hiding half of it would make a missed call invisible to whoever missed it.

    Membership is part of the query rather than a check, so a non-member gets the
    same 404 as an unknown conversation.
    """

    conversation_id = parse_id(raw_conversation_id, "conversation")

    member = session.scalar(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == viewer.id,
        )
    )
    if member is None:
        raise _conversation_not_found()

    base = select(Call).where(Call.conversation_id == conversation_id)
    total = session.scalar(select(func.count()).select_from(base.subquery())) or 0

    rows = list(
        session.scalars(
            base.order_by(Call.created_at.desc(), Call.id.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    return [call_read(row) for row in rows], total


def expire_stale(session: Session) -> list[uuid.UUID]:
    """The reaper: every ``RINGING`` call past the ring window becomes ``EXPIRED``.

    Called from the maintenance hook rather than per request, so a ring that
    nobody answers becomes a durable missed call instead of an invitation that
    hangs forever. The window is ``call_ring_timeout_seconds`` from configuration
    (default 45), and reaping is idempotent because the status filter means a
    second run finds nothing.

    Returns the ids it expired, and publishes ``call.ended`` for each: a missed
    call is still a call that ended, and the callee's device must stop ringing.
    """

    window = timedelta(seconds=get_settings().call_ring_timeout_seconds)
    cutoff = _now() - window

    stale = list(
        session.scalars(
            select(Call).where(
                Call.status == CallStatus.RINGING,
                Call.created_at <= cutoff,
            )
        )
    )
    if not stale:
        return []

    for call in stale:
        call.status = CallStatus.EXPIRED
        call.ended_at = _now()
        # No ended_by: nobody ended it. The reaper is not a participant, and
        # inventing an "ender" would misattribute a missed call.
        call.ended_by = None
        session.add(call)

    session.commit()

    for call in stale:
        # Both sides hear it: the callee stops ringing, and the caller learns the
        # attempt failed rather than waiting for an answer that will not come.
        for recipient_id in (call.caller_id, call.callee_id):
            call_events.call_ended(
                recipient_user_id=str(recipient_id),
                call_id=str(call.id),
                conversation_id=str(call.conversation_id),
                status=str(call.status),
                ended_by_user_id=None,
            )
    return [call.id for call in stale]


def _now() -> datetime:
    """The server clock, UTC.

    Every timestamp a call carries comes from here rather than from the database
    default, so ``answered_at`` and ``ended_at`` are stamped in the same process
    that decided the transition and are directly comparable to each other.
    """

    return datetime.now(UTC)
