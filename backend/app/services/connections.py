"""The connection state machine.

Every rule that decides *who may do what* lives here rather than in the route, so
the six endpoints cannot drift apart, and so each rule is testable without HTTP.

**404 for "not yours", never 403.** Specification §6.2 and §16 both require it, and
``app/services/ownership.py`` gives the same reasoning for the profile domain: a
403 on somebody else's record confirms the record exists, which turns the endpoint
into an oracle. The mobile client documents the same intent — a stale row should be
shown as removed rather than retried. So a wrong participant, a third party and a
connection id that does not exist all produce one indistinguishable answer.

**The direction of a request is the authorization.** ``is_outgoing`` is not a
cosmetic field the client uses to draw buttons; it is the server's statement of
which side the caller is on, and it is the same predicate the write operations
authorise against. The client cannot offer Accept on a request it sent, because
the server would answer 404 if it tried.

**Idempotency is a target state, not a side effect.** §18 requires a repeated
accept/decline/cancel to "return the same record", so each one is expressed as
"set this state": already there is a no-op, impossible from here is a 409.

**Reviving rather than re-inserting.** A pair has exactly one row for its whole
life (§6.2). Re-requesting after a decline resets that row instead of inserting a
second one, so the history of a relationship is not fragmented across rows that all
claim to be "the connection between A and B".
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ApiError, ErrorCode, error_detail
from app.models import Connection, Notification, User
from app.models.enums import ConnectionStatus, NotificationType
from app.realtime import notification_events
from app.schemas.connections import ConnectionRead, ConnectionStatusFilter
from app.schemas.users import UserSummary
from app.services import notifications, push
from app.services.ownership import parse_id

#: The one status the client's enum has that the database does not. ``canceled`` is
#: spelled with one "l" because the mobile ``Connection['status']`` union does,
#: while the route verb is ``cancel`` (spec §6.1).
_REMOVED = "removed"

#: Wording for §6.3's connection notifications. Server-rendered on purpose (§13.2):
#: the client renders from ``type`` + ``data``, so changing these strings is a
#: deployment and not a client release.
_CONNECTION_REQUEST_TITLE = "New connection request"
_CONNECTION_ACCEPTED_TITLE = "Connection request accepted"


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _summary(user: User) -> UserSummary:
    """The minimum that identifies a person.

    Built from the same fields as ``GET /users/lookup`` returns, and for the same
    reason: the client renders a row, not a profile. ``avatar_url`` is null for the
    same reason it is null on ``MeResponse`` — there is no media row to resolve
    ``avatar_media_id`` against until the media phase exists.
    """

    return UserSummary(
        user_id=str(user.id),
        public_id=user.public_id,
        username=user.username,
        name=user.name,
        role=user.role.value,
        avatar_url=None,  # media phase
    )


def counterpart(row: Connection, viewer: User) -> User:
    """The *other* participant.

    Safe only for a row the viewer participates in, which is the precondition every
    caller below establishes first.
    """

    return row.addressee if row.requester_id == viewer.id else row.requester


def connection_read(row: Connection, viewer: User) -> ConnectionRead:
    return ConnectionRead(
        id=str(row.id),
        status=row.status.value,
        is_outgoing=row.requester_id == viewer.id,
        user=_summary(counterpart(row, viewer)),
        created_at=_iso(row.created_at) or "",
        responded_at=_iso(row.responded_at),
    )


def _with_people(statement):
    """Eager-load both sides so building a read model is not two queries a row."""

    return statement.options(
        selectinload(Connection.requester), selectinload(Connection.addressee)
    )


# --- read --------------------------------------------------------------------


def list_for(
    session: Session, viewer: User, status: ConnectionStatusFilter | None
) -> list[ConnectionRead]:
    """``GET /connections`` — a bare array, newest first.

    Both directions in one list, separated by ``is_outgoing``, which is what the
    specification means by "``GET /connections?status=`` already covers both via
    ``is_outgoing``" and is why ``/connections/requests`` and ``/connections/sent``
    are not built: the mobile client calls neither.

    Newest first with an id tiebreaker, the ordering every other list in this
    project uses, so two identical requests cannot reshuffle between themselves.

    ``removed`` is accepted and always empty. It is a client-side projection of a
    deleted row (§6.1), so "rows that are removed" is the empty set by
    construction — and returning ``[]`` is a truer answer than a 422 for a value
    the client's own type allows it to send.
    """

    statement = select(Connection).where(
        or_(Connection.requester_id == viewer.id, Connection.addressee_id == viewer.id)
    )
    if status is not None:
        if status == _REMOVED:
            # No row is ever in the `removed` state, and a removed row is not in
            # the table at all — so this filter is empty by construction. Returning
            # early is what makes that true; simply leaving the filter off would
            # hand back the caller's entire list under a filter that says "removed".
            return []
        statement = statement.where(Connection.status == ConnectionStatus(status))

    rows = session.scalars(
        _with_people(statement).order_by(Connection.created_at.desc(), Connection.id)
    )
    return [connection_read(row, viewer) for row in rows]


def find_participant(session: Session, viewer: User, raw_id: str) -> Connection:
    """The caller's own connection with this id, or 404.

    ``parse_id`` answers 404 for a malformed id so the endpoint is not a
    UUID-format oracle, and the participant filter is part of the lookup rather
    than a check afterwards — there is no window in which another account's row
    has been loaded.
    """

    connection_id = parse_id(raw_id, "connection")
    row = session.scalar(
        _with_people(select(Connection)).where(
            Connection.id == connection_id,
            or_(
                Connection.requester_id == viewer.id,
                Connection.addressee_id == viewer.id,
            ),
        )
    )
    if row is None:
        raise _not_found()
    return row


# --- errors ------------------------------------------------------------------


def _not_found() -> ApiError:
    """One answer for "no such id", "not yours", and "not your side of it"."""

    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message="That connection was not found.",
    )


def _already_connected() -> ApiError:
    return ApiError(
        status_code=409,
        code=ErrorCode.CONFLICT,
        message="You are already connected.",
    )


def _awaiting_their_reply() -> ApiError:
    return ApiError(
        status_code=409,
        code=ErrorCode.CONFLICT,
        message="There is already a request between you. Answer it instead of "
        "sending another.",
    )


def _invalid_transition(current: ConnectionStatus, target: str) -> ApiError:
    return ApiError(
        status_code=409,
        code=ErrorCode.CONFLICT,
        message=f"A {current.value} connection cannot be {target}.",
    )


def _self_connection() -> ApiError:
    """A 422 naming the field, not a database CHECK violation.

    The ``requester_id <> addressee_id`` constraint would also refuse this, but as
    an integrity error from inside the transaction. Saying it here produces a 422
    the client can render next to the field, which is the outcome the
    specification asks for.
    """

    return ApiError(
        status_code=422,
        code=ErrorCode.VALIDATION_ERROR,
        message="You cannot send a connection request to yourself.",
        details=[
            error_detail(
                "body.user_id", "Choose someone other than yourself.", "value_error"
            )
        ],
    )


def _no_such_user() -> ApiError:
    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message="We could not find that person.",
    )


# --- write -------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(UTC)


def _persist(
    session: Session,
    row: Connection,
    viewer: User,
    notify: Callable[[Connection], Notification] | None = None,
) -> ConnectionRead:
    """Commit a new or revived row, and answer with it.

    The ``IntegrityError`` arm is not defensive padding. Between this function's
    lookup and its insert, another request for the same pair can be committed by a
    different session, and the unique index on ``(LEAST, GREATEST)`` rejects the
    loser. The application check cannot see that race, so the database decides it —
    and the loser is given the same 409 a plain duplicate receives, never a 500 and
    never the SQL text.

    ``notify`` is §6.3's notification side effect, and it runs **inside** this
    transaction rather than after it. That placement is the point: the flush gives
    the row its id (so the notification can point at it), the notification is
    staged, and one commit writes both or neither. There is no window in which a
    connection exists and its notification does not, nor the reverse — which is
    what "transactional with the originating operation" requires. On the
    IntegrityError path the whole unit rolls back together.
    """

    session.add(row)
    try:
        session.flush()
        notification = notify(row) if notify is not None else None
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise _already_connected() from exc
    session.refresh(row)
    # Phase 3 realtime: the commit above returned, so the connection row and its
    # notification are both durable. Publishing any earlier would announce a row a
    # rollback could still erase — and the IntegrityError arm above, which raises,
    # reaches neither this line nor the publisher.
    if notification is not None:
        notification_events.publish_for(notification)
        # Phase 4 push: after the commit and after the socket, so a backgrounded
        # recipient is reached by the fallback path only.
        push.dispatch(session, notification)
    return connection_read(row, viewer)


def _find_pair(session: Session, one: uuid.UUID, two: uuid.UUID) -> Connection | None:
    """The single row for this pair, in either direction.

    Written as the two orderings rather than with ``LEAST``/``GREATEST`` so the
    database can use the same unique index to find it.
    """

    return session.scalar(
        select(Connection).where(
            or_(
                and_(Connection.requester_id == one, Connection.addressee_id == two),
                and_(Connection.requester_id == two, Connection.addressee_id == one),
            )
        )
    )


def _request_notifier(
    session: Session, recipient_id: uuid.UUID, requester: User
) -> Callable[[Connection], Notification]:
    """Build the ``connection_request`` side effect for one send.

    A closure rather than a helper with eight arguments, because the two
    participants differ per call and the row is not known until the flush. The
    recipient is the **addressee**, determined by the state machine, and the actor
    is the authenticated requester — neither is ever a request field, so neither
    can be spoofed.

    Returns the staged ``Notification`` so the caller can publish it *after* its
    commit; see ``realtime/notification_events.py``.
    """

    def notify(row: Connection) -> Notification:
        return notifications.emit(
            session,
            recipient_id=recipient_id,
            notification_type=NotificationType.CONNECTION_REQUEST,
            actor_id=requester.id,
            target_type="connection",
            target_id=row.id,
            title=_CONNECTION_REQUEST_TITLE,
            # §13.2: `data` is for the client's deep link, never a rendered
            # message — an id, and nothing that could carry text.
            data={"connection_id": str(row.id)},
        )

    return notify


def _accepted_notifier(
    session: Session, recipient_id: uuid.UUID, accepter: User
) -> Callable[[Connection], Notification]:
    """Build §6.3's ``connection_accepted`` side effect for one accept.

    The recipient is the **requester** — the person who asked — and the actor is
    the addressee who said yes. The roles are exactly reversed from the request
    notification, which is the whole point of §6.3: each side is told about the
    other's action.
    """

    def notify(row: Connection) -> Notification:
        return notifications.emit(
            session,
            recipient_id=recipient_id,
            notification_type=NotificationType.CONNECTION_ACCEPTED,
            actor_id=accepter.id,
            target_type="connection",
            target_id=row.id,
            title=_CONNECTION_ACCEPTED_TITLE,
            data={"connection_id": str(row.id)},
        )

    return notify


def send_request(
    session: Session, viewer: User, addressee_id: uuid.UUID
) -> tuple[ConnectionRead, bool]:
    """``POST /connections`` — returns the record and whether it was created.

    The flag is the only reason the route can be honest about its status code: a
    pair that did not exist answers **201**, and one that was revived or already
    pending answers **200** with the same record. A client retrying a request it
    never saw the answer to must not be told it created something new, and a 201
    for a row that predates the call would be a lie.

    Four cases, and the pair has one row throughout:

    * **No row** — insert it pending, requester is the caller.
    * **Pending, sent by the caller** — idempotent; hand back the same row.
    * **Pending, sent by *them*** — 409. Silently reversing it would rewrite the
      other person's outgoing row, so the caller is told to answer it instead.
    * **Accepted** — 409. A live connection is not downgraded to a request.
    * **Declined or canceled** — revive: same row, pending again, roles pointing
      at whoever is asking now, ``responded_at`` cleared.
    """

    if addressee_id == viewer.id:
        raise _self_connection()
    if session.get(User, addressee_id) is None:
        raise _no_such_user()

    existing = _find_pair(session, viewer.id, addressee_id)

    if existing is None:
        row = Connection(
            requester_id=viewer.id,
            addressee_id=addressee_id,
            status=ConnectionStatus.PENDING,
            responded_at=None,
        )
        return (
            _persist(
                session,
                row,
                viewer,
                notify=_request_notifier(session, addressee_id, viewer),
            ),
            True,
        )

    if existing.status is ConnectionStatus.ACCEPTED:
        raise _already_connected()

    if existing.status is ConnectionStatus.PENDING:
        if existing.requester_id != viewer.id:
            raise _awaiting_their_reply()
        return connection_read(existing, viewer), False

    existing.requester_id = viewer.id
    existing.addressee_id = addressee_id
    existing.status = ConnectionStatus.PENDING
    existing.responded_at = None
    return (
        _persist(
            session,
            existing,
            viewer,
            notify=_request_notifier(session, addressee_id, viewer),
        ),
        False,
    )


def _move_to(
    session: Session,
    row: Connection,
    viewer: User,
    target: ConnectionStatus,
    verb: str,
    notify: Callable[[Connection], Notification] | None = None,
) -> ConnectionRead:
    """Settle a pending request into ``target``.

    Already in the target state is a no-op that returns the same record — §18
    requires accept/decline/cancel to be idempotent, because a client retrying a
    tap must not be shown an error for a change that already happened. Any *other*
    state is a 409: the transition does not exist, and inventing it would be how a
    declined request becomes accepted.
    """

    if row.status is target:
        return connection_read(row, viewer)
    if row.status is not ConnectionStatus.PENDING:
        raise _invalid_transition(row.status, verb)

    row.status = target
    row.responded_at = _now()
    session.add(row)
    # Staged before this commit for the same reason as `_persist`: the status
    # change and its notification land together or not at all. The early return
    # above is what keeps a repeated accept from notifying twice.
    notification = notify(row) if notify is not None else None
    session.commit()
    session.refresh(row)
    # Phase 3 realtime: after the commit, so a rollback leaves no event. The early
    # return above publishes nothing, so a repeated accept notifies once.
    if notification is not None:
        notification_events.publish_for(notification)
        # Phase 4 push: same placement — after the commit, after the socket.
        push.dispatch(session, notification)
    return connection_read(row, viewer)


def accept(session: Session, viewer: User, raw_id: str) -> ConnectionRead:
    """``POST /connections/{id}/accept`` — addressee only."""

    row = find_participant(session, viewer, raw_id)
    if row.addressee_id != viewer.id:
        raise _not_found()
    return _move_to(
        session,
        row,
        viewer,
        ConnectionStatus.ACCEPTED,
        "accepted",
        # The requester is told; the addressee is the actor.
        notify=_accepted_notifier(session, row.requester_id, viewer),
    )


def decline(session: Session, viewer: User, raw_id: str) -> ConnectionRead:
    """``POST /connections/{id}/decline`` — addressee only.

    Named ``decline`` because the mobile client calls exactly that (§6.1). A
    ``/reject`` alias would be a second path with no caller.
    """

    row = find_participant(session, viewer, raw_id)
    if row.addressee_id != viewer.id:
        raise _not_found()
    return _move_to(session, row, viewer, ConnectionStatus.DECLINED, "declined")


def cancel(session: Session, viewer: User, raw_id: str) -> ConnectionRead:
    """``POST /connections/{id}/cancel`` — requester only.

    The mirror of accept: the addressee declines, the requester withdraws, and
    neither may do the other's job. ``responded_at`` is set even though nobody
    "responded", because the database CHECK defines the column as "pending ended".
    """

    row = find_participant(session, viewer, raw_id)
    if row.requester_id != viewer.id:
        raise _not_found()
    return _move_to(session, row, viewer, ConnectionStatus.CANCELED, "canceled")


def remove(session: Session, viewer: User, raw_id: str) -> None:
    """``DELETE /connections/{id}`` — either participant, accepted only.

    ``removed`` is not a stored status (§6.1), so this deletes the row rather than
    setting a value. A pending row is refused: the verbs for it are cancel and
    decline, and a ``DELETE`` that quietly removed somebody's unanswered request
    would be a different operation wearing the same name.
    """

    row = find_participant(session, viewer, raw_id)
    if row.status is not ConnectionStatus.ACCEPTED:
        raise _invalid_transition(row.status, "removed")
    session.delete(row)
    session.commit()
