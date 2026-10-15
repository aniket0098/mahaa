"""The message-request domain: list, count, create, accept, reject.

Every rule that decides *who may do what* lives here rather than in the route,
so the endpoints cannot drift apart and each rule is testable without HTTP.

**Recipient-only, and non-recipients get 404.** A request that is not the
caller's answers 404, never 403 — the same anti-enumeration rule the main
backend applies to connections and conversations. A 403 would confirm the id
exists; 404 gives one indistinguishable answer for "no such id" and "not yours".
The acting user is always the authenticated caller: no request body ever names
a sender or recipient that is then trusted.

**The state machine is `pending → accepted | rejected`, once.** A row that is
already resolved answers **409**, so a double tap or a stale list cannot
silently re-decide. The transition happens under ``SELECT … FOR UPDATE``, so
two concurrent accepts serialise on the row and the loser sees the settled
state (and gets the same 409), while the CHECK constraint
``(status = 'pending') = (responded_at IS NULL)`` remains the database-level
backstop for anything that bypasses this service.

**Create is idempotent per pending pair**, mirroring the main backend's
``POST /connections`` convention: sending a second request while one is
already pending answers 200 with the same record instead of a 409, because a
double tap is not a conflict. The partial unique index on
``(sender, recipient) WHERE status = 'pending'`` is what makes two *simultaneous*
creates converge instead of racing.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ApiError, ErrorCode, error_detail
from app.models import MessageRequest, MessageRequestStatus
from app.schemas.message_requests import (
    MessageRequestCreate,
    MessageRequestPage,
    MessageRequestRead,
    SenderSummary,
)
from app.services import identity
from app.services.identity import UserRow

#: How many requests one page may hold. Bounded like every other list in the
#: platform: an unbounded page is a way to be handed the whole table.
PAGE_MAX = 100
PAGE_DEFAULT = 50


def _not_found() -> ApiError:
    """One 404 for "no such id", "not yours" and a malformed id alike."""

    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message="This request could not be found.",
    )


def _conflict(message: str) -> ApiError:
    return ApiError(status_code=409, code=ErrorCode.CONFLICT, message=message)


def parse_id(raw: str) -> uuid.UUID:
    """Parse a path id, answering 404 for anything unparseable.

    A 422 would say "you sent a malformed id", which is feedback an attacker
    can use and a legitimate client never needs: its ids come from this API.
    """

    try:
        return uuid.UUID(raw)
    except (TypeError, ValueError):
        raise _not_found() from None


def _summary(user: UserRow | None) -> SenderSummary:
    """The sender block for a card.

    ``None`` means the account vanished between the request row and the summary
    query — impossible while the FK holds, but rendered as an empty identity
    rather than a crash.
    """

    if user is None:
        return SenderSummary(
            user_id="", public_id="", username="", name="Unavailable", role="candidate"
        )
    return SenderSummary(
        user_id=str(user.id),
        public_id=user.public_id,
        username=user.username,
        name=user.name,
        role=user.role,
        designation=user.designation,
        avatar_url=user.avatar_url,
    )


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime | None) -> str | None:
    return None if value is None else value.isoformat()


def _read(record: MessageRequest, sender: UserRow | None) -> MessageRequestRead:
    return MessageRequestRead(
        id=str(record.id),
        status=record.status,
        note=record.note,
        created_at=(record.created_at or _now()).isoformat(),
        responded_at=_iso(record.responded_at),
        sender=_summary(sender),
    )


def pending_count(session: Session, viewer: UserRow) -> int:
    """``GET /message-requests/count`` — server-derived, never client-added."""

    return int(
        session.scalar(
            select(func.count())
            .select_from(MessageRequest)
            .where(
                MessageRequest.recipient_id == viewer.id,
                MessageRequest.status == MessageRequestStatus.PENDING.value,
            )
        )
        or 0
    )


def list_for(
    session: Session,
    viewer: UserRow,
    wanted: str = MessageRequestStatus.PENDING.value,
    limit: int = PAGE_DEFAULT,
) -> MessageRequestPage:
    """The caller's own received requests, newest first.

    Scoped to ``recipient_id == viewer.id`` **in the query itself** — the
    caller's id comes from the token, never from a parameter, so there is no
    request that can read somebody else's inbox.
    """

    records = session.scalars(
        select(MessageRequest)
        .where(
            MessageRequest.recipient_id == viewer.id,
            MessageRequest.status == wanted,
        )
        .order_by(MessageRequest.created_at.desc(), MessageRequest.id.desc())
        .limit(limit)
    ).all()
    senders = identity.find_users(session, {record.sender_id for record in records})
    return MessageRequestPage(
        items=[_read(record, senders.get(record.sender_id)) for record in records],
        pending_count=pending_count(session, viewer),
    )


def create(
    session: Session, viewer: UserRow, payload: MessageRequestCreate
) -> tuple[MessageRequestRead, bool]:
    """Send a request. Returns ``(record, created)``.

    ``created=False`` means a pending request for the same pair already
    existed; the route answers 200 with the same record, exactly as
    ``POST /connections`` does. The partial unique index settles a race: the
    loser of two simultaneous inserts catches ``IntegrityError``, rolls back,
    and reads the winner's row.
    """

    if payload.recipient_id == viewer.id:
        raise ApiError(
            status_code=422,
            code=ErrorCode.VALIDATION_ERROR,
            message="You cannot send a message request to yourself.",
            details=[error_detail("body.recipient_id", "You cannot message yourself.")],
        )

    recipient = identity.find_user(session, payload.recipient_id)
    if recipient is None:
        raise ApiError(
            status_code=404,
            code=ErrorCode.NOT_FOUND,
            message="That account could not be found.",
        )

    existing = session.scalar(
        select(MessageRequest).where(
            MessageRequest.sender_id == viewer.id,
            MessageRequest.recipient_id == payload.recipient_id,
            MessageRequest.status == MessageRequestStatus.PENDING.value,
        )
    )
    if existing is not None:
        return _read(existing, viewer), False

    record = MessageRequest(
        sender_id=viewer.id,
        recipient_id=payload.recipient_id,
        status=MessageRequestStatus.PENDING.value,
        note=payload.note,
    )
    session.add(record)
    try:
        session.commit()
    except IntegrityError:
        # The partial unique index fired: a concurrent create won the race.
        session.rollback()
        winner = session.scalar(
            select(MessageRequest).where(
                MessageRequest.sender_id == viewer.id,
                MessageRequest.recipient_id == payload.recipient_id,
                MessageRequest.status == MessageRequestStatus.PENDING.value,
            )
        )
        if winner is None:
            # The other request was resolved between our insert and this read;
            # nothing left to converge on, so surface the real failure.
            raise
        return _read(winner, viewer), False

    session.refresh(record)
    return _read(record, viewer), True


def respond(
    session: Session, viewer: UserRow, raw_id: str, *, accept: bool
) -> MessageRequestRead:
    """Accept or reject — **recipient only**, exactly once.

    The row is locked for the duration of the transition (``FOR UPDATE``), so
    two concurrent taps serialise: the first settles the row, the second sees
    the settled state and is refused with 409 rather than overwriting it. The
    caller's identity comes from the token (``viewer``), never from the path —
    knowing an id is not proof of being its recipient.
    """

    request_id = parse_id(raw_id)
    record = session.scalar(
        select(MessageRequest)
        .where(MessageRequest.id == request_id)
        .with_for_update()
    )
    # Not found and "not yours" are the same 404 — see the module docstring.
    if record is None or record.recipient_id != viewer.id:
        raise _not_found()

    if record.status != MessageRequestStatus.PENDING.value:
        # The recipient may know their own request's state; naming it makes the
        # 409 actionable instead of mysterious.
        if record.status == MessageRequestStatus.ACCEPTED.value:
            raise _conflict("This request was already accepted.")
        raise _conflict("This request was already rejected.")

    record.status = (
        MessageRequestStatus.ACCEPTED.value
        if accept
        else MessageRequestStatus.REJECTED.value
    )
    record.responded_at = _now()
    session.add(record)
    session.commit()
    session.refresh(record)

    sender = identity.find_user(session, record.sender_id)
    return _read(record, sender)
