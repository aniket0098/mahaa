"""Creating, listing and marking notifications — §13.

**One writer, and it is the server.** :func:`emit` is the only thing in the
codebase that constructs a ``Notification``, and it takes the recipient, the actor
and the type as parameters that callers derive from an authenticated operation.
There is no route that creates a notification, so no client can invent one, choose
its own recipient, or nominate somebody else as the actor — there is nothing to
authenticate because there is no input. §16's "no client-supplied user id is ever
trusted" is satisfied here by the absence of a request body.

**``emit`` does not commit.** It adds to the caller's session and returns, and the
domain operation that caused the event commits. That is what makes the side effect
transactional in the sense §13 actually requires: the notification and the
connection row / message row are written by one commit, so if the originating
operation rolls back the notification rolls back with it and no notification can
exist for something that never happened.

**Emission happens only on the branches that changed state.** Connections and
messaging already carry their own idempotency guards — a pair that is already
pending returns early, an already-accepted accept is a no-op, a repeat send with
the same ``client_message_id`` returns the winner's row — so calling :func:`emit`
*after* one of those guards has passed is what prevents duplicates. This module
therefore adds no unique constraint of its own; §18 achieves idempotency in the
domain that owns the natural key, and duplicating that here would also be wrong
(§18 revives a declined connection, which must notify again, so a
``(user_id, type, target_id)`` unique index would forbid a correct notification).

**A notification is not the system of record.** §13.4. So ``target_id`` is a bare
uuid with no foreign key: the row it points at may be deleted and the notification
survives, and ``actor_id`` is SET NULL so the recipient still learns that something
happened even after the actor is gone.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Select, func, select, update
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ApiError, ErrorCode, error_detail
from app.models import Notification, User
from app.models.enums import NotificationType
from app.schemas.notifications import (
    NotificationActor,
    NotificationPage,
    NotificationRead,
    UnreadCount,
)
from app.services.ownership import parse_id

#: §13.3: "``limit`` ≤ 50". The default is half of that, because the screen that
#: reads this is a phone list that appends more as it scrolls, and a full default
#: page would double the work of the first render for rows nobody scrolls to.
NOTIFICATION_PAGE_MAX = 50
NOTIFICATION_PAGE_DEFAULT = 20

#: Ceiling on ``title``. Long enough for "Aditi Sharma accepted your connection
#: request", short enough that a row cannot be used as a message channel.
NOTIFICATION_TITLE_MAX = 200


# --- errors ------------------------------------------------------------------


def _not_found() -> ApiError:
    """404 for a missing id *and* for somebody else's, with one message.

    §16's rule: a distinct answer for "not yours" would confirm the row exists.
    §15.2's rule: nothing a caller could not already know belongs in the message.
    """

    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message="That notification was not found.",
    )


def _bad_cursor() -> ApiError:
    """A cursor the server did not mint is a bad request, not an empty page.

    Answering an empty page would let a client page forever believing it had
    reached the end when it had in fact sent nonsense — the same reasoning, and
    the same message, as ``services.messaging``.
    """

    return ApiError(
        status_code=422,
        code=ErrorCode.VALIDATION_ERROR,
        message="That page cursor is not valid.",
        details=[
            error_detail("query.cursor", "Use a cursor from the API.", "value_error")
        ],
    )


# --- writing -----------------------------------------------------------------


def emit(
    session: Session,
    *,
    recipient_id: uuid.UUID,
    notification_type: NotificationType,
    actor_id: uuid.UUID | None = None,
    target_type: str | None = None,
    target_id: uuid.UUID | None = None,
    title: str,
    body: str | None = None,
    data: dict[str, Any] | None = None,
) -> Notification:
    """Stage one notification in ``session``. **The caller commits.**

    Not a route and not a public API of the application: the four parameters that
    matter are all server-derived, and the one that could be abused if it were
    reachable — ``recipient_id`` — is a positional-style keyword that no request
    body can fill.

    ``actor_id`` is optional and defaults to ``None``, which is §13.2's "not
    shown" state and the only way a ``system`` notification is expressed. Nothing
    else in the module can produce that state, so the distinction stays honest.

    **It deliberately does not publish a realtime event.** A caller invokes this
    *before* its ``session.commit()`` — that ordering is what makes the
    notification and the connection/message row atomic — so an event raised here
    would describe a row a rollback could still erase. Publishing is the caller's
    job, immediately after its commit returns; see
    ``realtime/notification_events.py`` for why the integration point is here and
    not inside this function.
    """

    notification = Notification(
        user_id=recipient_id,
        type=notification_type,
        actor_id=actor_id,
        target_type=target_type,
        target_id=target_id,
        title=title,
        body=body,
        data=data or {},
    )
    session.add(notification)
    return notification

# --- reading -----------------------------------------------------------------


def _cursor_codec(sort_at: datetime, row_id: uuid.UUID) -> str:
    return (
        base64.urlsafe_b64encode(f"{sort_at.isoformat()}|{row_id}".encode())
        .decode()
        .rstrip("=")
    )


def _decode_cursor(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    """Opaque to the client by construction, so the encoding can change freely.

    An **empty** cursor counts as absent rather than invalid, for the reason
    ``services.messaging`` gives: a query string built by concatenation produces
    ``?cursor=`` when the value is empty, and failing a caller for sending exactly
    what "no cursor" means is a bug with no upside.
    """

    if not cursor or not cursor.strip():
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        stamp, row_id = base64.urlsafe_b64decode(padded).decode().split("|")
        return datetime.fromisoformat(stamp), uuid.UUID(row_id)
    except (ValueError, TypeError, binascii.Error, UnicodeDecodeError) as exc:
        raise _bad_cursor() from exc


def _actor_of(notification: Notification, session: Session) -> NotificationActor | None:
    """``None`` when ``actor_id`` is null — §13.2's "not shown".

    A deleted actor lands here too, because ``actor_id`` is SET NULL (§13.4): the
    notification survives its actor and renders as if it had never had one, which
    is the behaviour §13.4 asks for rather than an accident of the join.

    ``avatar_url`` is resolved through ``media.avatar_url_for`` — the same helper
    every other surface uses. It was a permanent ``None`` "until the media phase",
    which meant a notification from somebody with a saved photo showed initials.
    """

    if notification.actor is None:
        return None
    from app.services.media import avatar_url_for

    return NotificationActor(
        user_id=str(notification.actor.id),
        name=notification.actor.name,
        avatar_url=avatar_url_for(notification.actor, session),
    )


def _read(notification: Notification, session: Session) -> NotificationRead:
    return NotificationRead(
        id=str(notification.id),
        type=notification.type.value,
        actor=_actor_of(notification, session),
        target_type=notification.target_type,
        target_id=(
            str(notification.target_id) if notification.target_id is not None else None
        ),
        title=notification.title,
        body=notification.body,
        data=notification.data or {},
        is_read=notification.is_read,
        created_at=notification.created_at.isoformat(),
    )


def _scoped(viewer: User, unread_only: bool) -> Select:
    """A SELECT already restricted to the caller's own notifications.

    Recipient scoping lives in the **query**, not in a Python filter afterwards —
    ``ownership.get_owned``'s reasoning, and the reason a forgotten filter cannot
    leak another account's mail. ``?unread_only`` is applied here too, so
    ``total`` counts exactly the rows ``items`` would return.
    """

    conditions = [Notification.user_id == viewer.id]
    if unread_only:
        conditions.append(Notification.is_read.is_(False))
    return select(Notification).where(*conditions)

def list_for(
    session: Session,
    viewer: User,
    limit: int,
    cursor: str | None,
    unread_only: bool = False,
) -> NotificationPage:
    """One keyset page, newest first — §13.3.

    Keyset on ``(created_at, id) DESC`` rather than offset because §17 names
    notifications among the endpoints that "will grow without bound", and because
    marking a notification read must not shift rows out from under a cursor the
    client is already holding: with offset, a read between two pages silently
    duplicates or skips a row. Keyset pages on a value that only ever grows.

    ``total`` is a real ``COUNT`` over the same filter, because §13.3 says so and
    §17 forbids the ``len(items)`` shortcut. It is one extra query, not one per
    row.
    """

    statement = _scoped(viewer, unread_only)

    after = _decode_cursor(cursor)
    if after is not None:
        sort_at, row_id = after
        statement = statement.where(
            # Strictly older than the cursor's boundary, in the (created_at, id)
            # ordering. The `id` arm is what makes rows that share a timestamp
            # comparable — timestamps alone are not unique (§7.4).
            (Notification.created_at < sort_at)
            | ((Notification.created_at == sort_at) & (Notification.id < row_id))
        )

    total = session.scalar(
        select(func.count()).select_from(_scoped(viewer, unread_only).subquery())
    )

    # One row over the limit, because `has_more` is a fact about the database and
    # not an inference from the page's own length. `len(rows) == limit` cannot tell
    # "there is another page" from "this page happened to be exactly full and is
    # the last one", and it guesses the second case wrong: on an exact final page
    # it reports `has_more: true` and hands back a cursor whose next fetch is an
    # empty list — a client that trusts the flag loops forever (§17). Fetching
    # `limit + 1` and discarding the extra row turns the question into "did there
    # exist one more?", which the database answers.
    rows = list(
        session.scalars(
            statement.options(selectinload(Notification.actor))
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .limit(limit + 1)
        )
    )
    has_more = len(rows) > limit
    page_rows = rows[:limit]

    # The cursor must point at the last row the client actually received. It is
    # only meaningful when another page exists: on a short page there is nothing
    # older to resume from, and emitting a cursor here would invite the client to
    # ask for a page that is empty by definition.
    boundary = page_rows[-1] if (has_more and page_rows) else None

    return NotificationPage(
        items=[_read(row, session) for row in page_rows],
        total=total or 0,
        limit=limit,
        next_cursor=(
            _cursor_codec(boundary.created_at, boundary.id) if boundary else None
        ),
        has_more=has_more,
    )


def unread_count(session: Session, viewer: User) -> UnreadCount:
    """How many the caller has not read — §13's count endpoint.

    Served by the partial index ``WHERE is_read = false``, so the cost tracks the
    number of *unread* rows rather than the size of the inbox. §13 insists this is
    built before any badge is drawn: a badge is a number the server cannot supply
    until this route exists.
    """

    count = session.scalar(
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.user_id == viewer.id,
            Notification.is_read.is_(False),
        )
    )
    return UnreadCount(count=count or 0)

# --- marking read ------------------------------------------------------------


def mark_read(session: Session, viewer: User, raw_id: str) -> None:
    """``POST /notifications/{id}/read`` — 204, and idempotent.

    **Scoped in the query.** The ``user_id == viewer.id`` predicate is part of the
    lookup, so there is no window in which another account's row has been loaded,
    and a row that is not the caller's is indistinguishable from one that does not
    exist (§16).

    **Already-read is a no-op, not an error.** This route has no way to move a row
    *back* to unread — there is no "mark unread" verb and no request body — so read
    state is monotonic and a client retrying a tap it never saw the answer to
    cannot un-read itself.
    """

    notification_id = parse_id(raw_id, "notification")
    notification = session.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == viewer.id,
        )
    )
    if notification is None:
        raise _not_found()

    if notification.is_read:
        return

    notification.is_read = True
    session.add(notification)
    session.commit()


def mark_all_read(session: Session, viewer: User) -> None:
    """``POST /notifications/read-all`` — 204, and scoped the same way.

    One UPDATE rather than a read-then-write loop: a thousand unread
    notifications are one statement, and the ``user_id`` predicate means there is
    no read phase in which another account's rows could be seen. Repeating it
    matches no rows and is a no-op.
    """

    session.execute(
        update(Notification)
        .where(
            Notification.user_id == viewer.id,
            Notification.is_read.is_(False),
        )
        .values(is_read=True)
    )
    session.commit()
