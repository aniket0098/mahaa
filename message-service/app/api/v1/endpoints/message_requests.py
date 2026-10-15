"""The ``/message-requests`` router — list, count, create, accept, reject.

Every route is ``CurrentUser``: the acting identity always comes from the
token, and no body or path parameter is ever trusted as proof of who the
caller is. The five operations are the whole surface of this service in
Phase 1; there is deliberately no ``GET /message-requests/{id}`` (a recipient
sees their own list, and anybody else would only get a 404) and no ``PATCH``
(the status is a state machine, not a settable field — see
``app/services/message_requests.py``).

Status codes, and why each is what it is:

* **201/200 on create** — 201 only when a row was actually created. Re-sending
  while one is already pending answers 200 with the same record: the same pair
  converged on the same state, and a 409 would make a double tap look like a
  failure (the main backend's ``POST /connections`` rule, for the same reason).
* **404** — no such request, or not the caller's. One answer, never 403.
* **409** — accept or reject on an already-resolved request.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.models import MessageRequestStatus
from app.schemas.message_requests import (
    MessageRequestCreate,
    MessageRequestPage,
    MessageRequestRead,
    PendingCount,
    StatusFilter,
)
from app.services import message_requests as svc

router = APIRouter(tags=["message-requests"])

StatusQuery = Annotated[StatusFilter, Query(alias="status")]
Limit = Annotated[int, Query(ge=1, le=svc.PAGE_MAX)]


@router.get(
    "/message-requests",
    response_model=MessageRequestPage,
    summary="Requests I received, newest first",
)
def list_message_requests(
    current_user: CurrentUser,
    session: DbSession,
    status_filter: StatusQuery = MessageRequestStatus.PENDING.value,  # type: ignore[assignment]
    limit: Limit = svc.PAGE_DEFAULT,
) -> MessageRequestPage:
    """The caller's own received requests, scoped by the token's identity."""

    return svc.list_for(session, current_user, status_filter, limit)


@router.get(
    "/message-requests/count",
    response_model=PendingCount,
    summary="How many pending requests are waiting for me",
)
def count_message_requests(current_user: CurrentUser, session: DbSession) -> PendingCount:
    """Server-derived — the client must never add up pages to build a badge."""

    return PendingCount(pending=svc.pending_count(session, current_user))


@router.post(
    "/message-requests",
    response_model=MessageRequestRead,
    status_code=status.HTTP_201_CREATED,
    summary="Ask to message somebody",
)
def create_message_request(
    payload: MessageRequestCreate,
    response: Response,
    current_user: CurrentUser,
    session: DbSession,
) -> MessageRequestRead:
    """Send a request to the internal user id in ``recipient_id``.

    The authenticated caller is the sender; there is no field in the body that
    can say otherwise (``extra="forbid"`` makes one a 422).
    """

    record, created = svc.create(session, current_user, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    return record


@router.post(
    "/message-requests/{request_id}/accept",
    response_model=MessageRequestRead,
    summary="Accept an incoming request (recipient only)",
)
def accept_message_request(
    request_id: str, current_user: CurrentUser, session: DbSession
) -> MessageRequestRead:
    """Addressee only; anybody else — including the sender — gets 404."""

    return svc.respond(session, current_user, request_id, accept=True)


@router.post(
    "/message-requests/{request_id}/reject",
    response_model=MessageRequestRead,
    summary="Reject an incoming request (recipient only)",
)
def reject_message_request(
    request_id: str, current_user: CurrentUser, session: DbSession
) -> MessageRequestRead:
    """Addressee only; anybody else — including the sender — gets 404."""

    return svc.respond(session, current_user, request_id, accept=False)
