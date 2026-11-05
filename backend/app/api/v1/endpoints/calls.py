"""The ``/conversations/{id}/calls`` and ``/calls`` router — Phase 14's six routes.

**No role restriction, and none is invented.** ``CurrentUser``, not
``CandidateUser``. A call is between the two members of a conversation, and an
employer answering a candidate is as much the point as the reverse — the same
reason §7's messaging endpoints are role-free.

**Every write answers with the call, so the client never has to re-read.** A
transition returns the row it produced, which is what lets a callee navigate
straight from the ``accept`` response without a follow-up ``GET``.

**201 vs 200 is decided by the service and applied here.** ``start`` returns
``(call, created)`` and only a *new* invitation is a 201 — re-ringing a
conversation that is already ringing is the same resource and answers 200. The
mechanism is the injected ``Response`` that ``POST /conversations`` already uses:
a decorator status is a default, not a decision.

**The token endpoint is a 503 when LiveKit is not configured**, not a 404 and not
a 500. The route exists in every deployment; whether the credentials are present
is a configuration fact the client is entitled to be told.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.calls import CallCreate, CallPage, CallRead, CallTokenRead
from app.services import calls as svc
from app.services.calls import CALL_PAGE_DEFAULT, CALL_PAGE_MAX

router = APIRouter(tags=["calling"])

#: Bounds inside ``Query`` and defaults in the signatures — the arrangement
#: FastAPI requires, for the same reason the messaging router documents it.
CallLimit = Annotated[int, Query(ge=1, le=CALL_PAGE_MAX)]
CallOffset = Annotated[int, Query(ge=0)]


@router.post(
    "/conversations/{conversation_id}/calls",
    response_model=CallRead,
    status_code=status.HTTP_201_CREATED,
    summary="Start a call with the other member of a conversation",
)
def start_call(
    conversation_id: str,
    payload: CallCreate,
    response: Response,
    current_user: CurrentUser,
    session: DbSession,
) -> CallRead:
    """Ring the other member of this conversation.

    201 when the invitation was created; **200 when the conversation already had a
    live call** and that one is returned instead — the same honest-reuse rule
    ``POST /conversations`` applies, and the same mechanism: the service reports
    whether it inserted a row, and this downgrades the code when it did not.
    """

    call, created = svc.start(session, current_user, conversation_id, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    return call


@router.post(
    "/calls/{call_id}/accept",
    response_model=CallRead,
    summary="Answer an incoming call (callee only)",
)
def accept_call(
    current_user: CurrentUser, session: DbSession, call_id: str
) -> CallRead:
    """Move a ringing call to answered and stamp ``answered_at``."""

    return svc.accept(session, current_user, call_id)


@router.post(
    "/calls/{call_id}/reject",
    response_model=CallRead,
    summary="Decline an incoming call (callee only)",
)
def reject_call(
    current_user: CurrentUser, session: DbSession, call_id: str
) -> CallRead:
    """Decline before answering. Terminal; the caller is told to stop ringing."""

    return svc.reject(session, current_user, call_id)


@router.post(
    "/calls/{call_id}/cancel",
    response_model=CallRead,
    summary="Cancel a call you started before it was answered",
)
def cancel_call(
    current_user: CurrentUser, session: DbSession, call_id: str
) -> CallRead:
    """Give up while it is still ringing. Caller only."""

    return svc.cancel(session, current_user, call_id)


@router.post(
    "/calls/{call_id}/end",
    response_model=CallRead,
    summary="Hang up an answered call",
)
def end_call(current_user: CurrentUser, session: DbSession, call_id: str) -> CallRead:
    """End an answered call. Either participant may do this."""

    return svc.end(session, current_user, call_id)


@router.get(
    "/calls/{call_id}",
    response_model=CallRead,
    summary="Read one call you participate in",
)
def read_call(
    current_user: CurrentUser, session: DbSession, call_id: str
) -> CallRead:
    """Return the row the active screen tracks — members only, 404 otherwise."""

    return svc.read(session, current_user, call_id)


@router.get(
    "/calls/{call_id}/token",
    response_model=CallTokenRead,
    summary="A short-lived LiveKit join token for this call",
)
def call_token(
    current_user: CurrentUser, session: DbSession, call_id: str
) -> CallTokenRead:
    """Mint a join token scoped to this call's room and the caller's identity.

    503 when LiveKit is not configured on this deployment, 409 when the call has
    already ended — a token for a finished call would be a key to an empty room.
    """

    return CallTokenRead(**svc.token(session, current_user, call_id))


@router.get(
    "/conversations/{conversation_id}/calls",
    response_model=CallPage,
    summary="Call history for a conversation, newest first",
)
def list_calls(
    current_user: CurrentUser,
    session: DbSession,
    conversation_id: str,
    limit: CallLimit = CALL_PAGE_DEFAULT,
    offset: CallOffset = 0,
) -> CallPage:
    """Every call in this conversation, both participants seeing the same rows."""

    items, total = svc.history(session, current_user, conversation_id, limit, offset)
    return CallPage(items=items, total=total, limit=limit, offset=offset)
