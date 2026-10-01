"""The ``/connections`` router — the six operations ``src/api/connections.ts`` calls.

Every route here has a caller in the mobile client. There is no
``GET /connections/requests`` and no ``GET /connections/sent``: the specification
marks both ``[F]`` (§6) and its own parity table counts them among the routes
"with no mobile caller today", because ``GET /connections?status=`` already returns
both directions separated by ``is_outgoing``. Building them would be two paths the
app never asks for.

**Open to every role, not candidate-only.** ``CurrentUser``, not ``CandidateUser``:
a recruiter connecting with a candidate is the central use of this domain, and
restricting it to candidates would break the other half of the product. The
Phase 3 profile routes are candidate-only for the opposite reason — an education
timeline is a candidate record.

**No ``PATCH``.** The status is a state machine, not a settable field. There is
no route that accepts a status in a body, so a client cannot jump a connection
from ``declined`` to ``accepted`` no matter what it sends.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.connections import ConnectionCreate, ConnectionRead
from app.schemas.connections import ConnectionStatusFilter as StatusFilter
from app.services import connections as svc

router = APIRouter(tags=["connections"])


@router.get(
    "/connections",
    response_model=list[ConnectionRead],
    summary="My connections and requests",
)
def list_connections(
    current_user: CurrentUser,
    session: DbSession,
    # The client sends `?status=`; the parameter is named for the argument it
    # binds to, so the wire name is set explicitly rather than renaming the
    # argument to something the client does not know.
    wanted: Annotated[StatusFilter | None, Query(alias="status")] = None,
) -> list[ConnectionRead]:
    """Every relationship the caller is part of, both directions, newest first.

    A bare array, not a page envelope: §17 lists ``/connections`` among the
    endpoints that use one, and ``listConnections`` is typed ``Promise<Connection[]>``
    with no place to put a total.

    ``?status=`` narrows to one state. Without it the caller gets everything, and
    the client separates the lists itself using ``is_outgoing`` — which is the
    server's statement of the direction, not something the app should infer.
    """

    return svc.list_for(session, current_user, wanted)


@router.post(
    "/connections",
    response_model=ConnectionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Send a connection request",
)
def send_connection(
    payload: ConnectionCreate,
    response: Response,
    current_user: CurrentUser,
    session: DbSession,
) -> ConnectionRead:
    """Send a request to the internal user id in ``user_id``.

    **201 only when a row was actually created.** Sending to somebody you have
    already sent to, or reviving a declined request, answers 200 with the same
    record: both are the same pair converging on the same state, and a 201 would
    claim a resource that already existed. The alternative — a 409 for every
    repeat — would make a double tap look like a failure and force the client to
    distinguish "sent" from "already sent" on its own.

    An already-accepted connection is the one repeat that is a genuine conflict,
    and it is a 409: the two people are connected, and a new request would
    silently downgrade a live relationship.
    """

    record, created = svc.send_request(session, current_user, payload.user_id)
    if not created:
        response.status_code = status.HTTP_200_OK
    return record


@router.post(
    "/connections/{connection_id}/accept",
    response_model=ConnectionRead,
    summary="Accept an incoming request",
)
def accept_connection(
    connection_id: str, current_user: CurrentUser, session: DbSession
) -> ConnectionRead:
    """Addressee only. Repeating it is a no-op that returns the same record."""

    return svc.accept(session, current_user, connection_id)


@router.post(
    "/connections/{connection_id}/decline",
    response_model=ConnectionRead,
    summary="Decline an incoming request",
)
def decline_connection(
    connection_id: str, current_user: CurrentUser, session: DbSession
) -> ConnectionRead:
    """Addressee only. Named ``decline`` because that is what the client calls."""

    return svc.decline(session, current_user, connection_id)


@router.post(
    "/connections/{connection_id}/cancel",
    response_model=ConnectionRead,
    summary="Withdraw a request I sent",
)
def cancel_connection(
    connection_id: str, current_user: CurrentUser, session: DbSession
) -> ConnectionRead:
    """Requester only — the addressee declines instead of cancelling."""

    return svc.cancel(session, current_user, connection_id)


@router.delete(
    "/connections/{connection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove an accepted connection",
)
def remove_connection(
    connection_id: str, current_user: CurrentUser, session: DbSession
) -> Response:
    """Either participant may remove an accepted connection.

    204, which is what ``removeConnection``'s ``Promise<void>`` expects. The row
    is deleted rather than marked, so ``removed`` never has to be stored or
    filtered on.
    """

    svc.remove(session, current_user, connection_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
