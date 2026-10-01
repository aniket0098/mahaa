"""The ``/notifications`` router — §13's four endpoints.

**No mobile module exists, and the specification is explicit that none should be
written yet.** §23's parity table records notifications as having no client
module and both screens as `StageScreen`. More pointedly, §13 records that the app
"shows **no unread badge, dot, or count anywhere**", with the reason spelled out
in ``DashboardHeader.tsx``: a badge "would be a number the server cannot supply".
So these routes are the *supply*, and drawing the badge is Phase 10's decision
once the number exists — not something this phase decides for it.

**The count endpoint is not optional.** §22 says "Build the **count endpoint
before** any client badge is drawn", and §13 says a count endpoint "must be built
**before** any badge is drawn". It is the fourth route here for that reason, not
because the client asked for it.

**There is no route that creates a notification.** Every notification is a side
effect of a connection or messaging operation, and the actor and recipient are
both derived server-side from the token and the state machine. A client cannot
address a notification to somebody, because there is no endpoint and no body in
which to say so.

**``/unread-count`` and ``/{id}`` cannot collide.** Different HTTP methods and
different path depths, and FastAPI matches in registration order — but the
literal path is registered first anyway so that a future ``{id}`` route can never
shadow it. Read state is monotonic: there is no mark-unread verb, so a stale
client re-posting ``/read`` cannot put anything back in the unread state.

**No role restriction.** ``CurrentUser``, not ``CandidateUser``: a college
official receiving a connection request, and an employer messaging a candidate,
are the same events.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.notifications import NotificationPage, UnreadCount
from app.services import notifications as svc
from app.services.notifications import (
    NOTIFICATION_PAGE_DEFAULT,
    NOTIFICATION_PAGE_MAX,
)

router = APIRouter(tags=["notifications"])

#: §13.3's "``limit`` ≤ 50". The bounds live inside ``Query`` and the **default
#: lives in the signature**, which is the only arrangement FastAPI accepts — the
#: same split `endpoints/messaging.py` uses, and for the same reason.
Limit = Annotated[int, Query(ge=1, le=NOTIFICATION_PAGE_MAX)]
Cursor = Annotated[str | None, Query(description="Opaque cursor from a previous page.")]
UnreadOnly = Annotated[
    bool, Query(description="Return only notifications that have not been read.")
]


@router.get(
    "/notifications",
    response_model=NotificationPage,
    summary="My notifications, newest first",
)
def list_notifications(
    current_user: CurrentUser,
    session: DbSession,
    limit: Limit = NOTIFICATION_PAGE_DEFAULT,
    cursor: Cursor = None,
    unread_only: UnreadOnly = False,
) -> NotificationPage:
    """A keyset page of the caller's own notifications.

    Recipient scoping is in the query, so there is no way to ask for somebody
    else's list — the page cannot contain another account's mail even if a filter
    were forgotten.

    ``?unread_only=true`` narrows the page **and** the ``total`` together, so the
    two always describe the same set (§13.3).
    """

    return svc.list_for(session, current_user, limit, cursor, unread_only)


@router.get(
    "/notifications/unread-count",
    response_model=UnreadCount,
    summary="How many notifications I have not read",
)
def unread_count(current_user: CurrentUser, session: DbSession) -> UnreadCount:
    """The number a badge would draw — §13, built before any badge exists.

    Registered as a literal path, ahead of any ``{id}`` route, so that the count
    can never be shadowed by an id parameter.
    """

    return svc.unread_count(session, current_user)


@router.post(
    "/notifications/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Mark one notification read",
)
def mark_notification_read(
    notification_id: str, current_user: CurrentUser, session: DbSession
) -> Response:
    """The caller's own notification, or 404.

    Repeating it is a no-op rather than an error (§18's target-state pattern), and
    a notification belonging to somebody else answers the **same** 404 as one that
    does not exist (§16) — a distinct answer would confirm it exists.
    """

    svc.mark_read(session, current_user, notification_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/notifications/read-all",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Mark every notification read",
)
def mark_all_notifications_read(
    current_user: CurrentUser, session: DbSession
) -> Response:
    """Every unread notification of the caller's, and nobody else's.

    204 with no body: the count endpoint is how a client learns the result, and a
    second body here would be one more shape the client has to parse for no gain.
    """

    svc.mark_all_read(session, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
