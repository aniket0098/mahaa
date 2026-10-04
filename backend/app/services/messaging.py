"""The messaging domain: conversations, membership, messages, read state.

Every rule that decides *who may do what* lives here rather than in the route, so
the seven endpoints cannot drift apart and each rule is testable without HTTP.

**Membership is the only authority on an existing conversation.** §7.4 and §16
both say a non-member gets **404**, never 403 — the same anti-enumeration rule
Phase 4 applied to connections. A 403 on somebody else's thread would confirm it
exists; 404 gives one indistinguishable answer for "no such id", "not yours" and
"not your side of it". ``_find_member`` is the single door, and the membership
filter is part of the lookup rather than a check performed afterwards, so there is
no window in which another account's conversation has been loaded.

**The relationship requirement is checked once, at creation.** §22.1 is explicit
that Phase 5 "depends on Phase 4 — messaging between strangers needs a
relationship rule", so a conversation can only be opened between two people with
an **accepted** connection. It is not re-checked on every send: §7.4's
authorisation rule for an existing conversation is membership, and re-checking
would mean a removed connection silently blocked the reading of history the
platform is keeping. That trade is a genuine gap in the specification, not an
oversight here — see the phase report.

**One 403 covers both "not connected" and "messages disabled".** §7.5 requires a
``POST /conversations`` against someone who disabled messages to be refused
*before* the row is created, "otherwise the sender learns the setting by trial".
Two different codes or two different sentences would defeat exactly that, so both
refusals return one indistinguishable 403.

**The transport is REST and the model does not bake in polling.** §7.2's whole
reasoning for REST over WebSocket is that the *message model* must stay
transport-agnostic — a monotonic ``id`` and ``created_at`` that a WebSocket or SSE
layer can be added in front of later without a schema change. Nothing here knows
how delivery happens; ``?since=`` is the polling affordance §7.2 names, and it is
the same rows a socket would push.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ApiError, ErrorCode, error_detail
from app.models import (
    Connection,
    Conversation,
    ConversationMember,
    Message,
    ProfilePrivacy,
    User,
)
from app.models.enums import ConnectionStatus, NotificationType
from app.realtime import messaging_events, notification_events
from app.schemas.messaging import (
    ConversationPage,
    ConversationRead,
    MessageCreate,
    MessagePage,
    MessageRead,
)
from app.schemas.users import UserSummary
from app.services import notifications, push
from app.services.media import avatar_url_for
from app.services.ownership import parse_id

#: How many messages a page may hold. The same ceiling the profile sections use
#: (`schemas.common.MAX_PAGE_LIMIT`), kept as one number per domain rather than
#: imported, because the two limits are unrelated decisions that happen to agree.
MESSAGE_PAGE_MAX = 100
MESSAGE_PAGE_DEFAULT = 50

#: Same ceiling for the conversation list. A student does not have thousands of
#: conversations, and an unbounded page is a way to be handed the whole table.
CONVERSATION_PAGE_MAX = 100
CONVERSATION_PAGE_DEFAULT = 50

#: Server-rendered wording for the `message` notification (§13.2). Fixed
#: and generic on purpose: the notification says *that* somebody wrote,
#: and the client opens the conversation. A notification that quoted the
#: message would leak its content into a list that renders while locked.
_MESSAGE_TITLE = "New message"
# --- errors ------------------------------------------------------------------
#
# One message per outcome. Anything a caller could not already know stays out of
# them: a 404 never says "not yours" and a 403 never says why.


def _conversation_not_found() -> ApiError:
    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message="That conversation was not found.",
    )


def _message_not_found() -> ApiError:
    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message="That message was not found.",
    )


def _cannot_start_conversation() -> ApiError:
    """Deliberately says neither "you are not connected" nor "they disabled it".

    §7.5 exists precisely so a sender cannot learn the other person's
    ``allow_messages`` by trial. Two failures, one sentence, one code.
    """

    return ApiError(
        status_code=403,
        code=ErrorCode.FORBIDDEN,
        message="You cannot start a conversation with this person.",
    )


def _self_conversation() -> ApiError:
    return ApiError(
        status_code=422,
        code=ErrorCode.VALIDATION_ERROR,
        message="You cannot start a conversation with yourself.",
        details=[
            error_detail(
                "body.user_id",
                "Choose someone other than yourself.",
                "value_error",
            )
        ],
    )


def _no_such_user() -> ApiError:
    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message="We could not find that person.",
    )


def _bad_cursor() -> ApiError:
    """A cursor the server did not mint is a bad request, not an empty page.

    Answering an empty page would let a client loop forever believing it had
    reached the end when it had in fact sent nonsense.
    """

    return ApiError(
        status_code=422,
        code=ErrorCode.VALIDATION_ERROR,
        message="That page cursor is not valid.",
        details=[
            error_detail(
                "query.cursor", "Use a cursor from the API.", "value_error"
            )
        ],
    )


# --- keyset cursors ----------------------------------------------------------
#
# A cursor is base64url of "<iso8601>|<uuid>" for the sort key's boundary row.
# Opaque to the client by construction, so the internal encoding can change
# without a client change — which is the entire reason to bother.


def _now() -> datetime:
    return datetime.now(UTC)


def encode_cursor(sort_at: datetime | None, row_id: uuid.UUID) -> str:
    """Encode a sort-key boundary. ``sort_at`` may be None.

    ``conversations.last_message_at`` is nullable — a conversation with no messages
    yet has no activity — so the codec has to carry "null" as a real value rather
    than refusing it. An empty ISO field is that encoding.
    """

    stamp = sort_at.isoformat() if sort_at is not None else ""
    raw = f"{stamp}|{row_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> tuple[datetime | None, uuid.UUID] | None:
    """Decode a cursor, or ``None`` for "no cursor".

    An **empty** cursor counts as absent rather than as invalid. A query string is
    built by string concatenation in plenty of clients, and ``?cursor=`` is what
    that produces when the value is empty. Treating it as a bad request would fail
    a caller for sending exactly what "no cursor" means.
    """

    if not cursor or not cursor.strip():
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        stamp, row_id = base64.urlsafe_b64decode(padded).decode().split("|")
        created_at = datetime.fromisoformat(stamp) if stamp else None
        return created_at, uuid.UUID(row_id)
    except (ValueError, TypeError, binascii.Error, UnicodeDecodeError) as exc:
        raise _bad_cursor() from exc


def _direct_key(one: uuid.UUID, two: uuid.UUID) -> str:
    """``min:max`` of the two ids — the pair's identity, independent of who asked."""

    first, second = sorted((str(one), str(two)))
    return f"{first}:{second}"


def _summary(user: User, session: Session) -> UserSummary:
    """The project's minimal user representation. No private fields exist here.

    ``avatar_url`` is resolved through ``media.avatar_url_for``. It used to be a
    permanent ``None`` "until the media phase", so a conversation participant who
    had saved a photo still showed initials in the thread. Same relative path,
    same helper, every other surface.
    """

    return UserSummary(
        user_id=str(user.id),
        public_id=user.public_id,
        username=user.username,
        name=user.name,
        role=user.role.value,
        avatar_url=avatar_url_for(user, session),
    )


def message_read(message: Message, session: Session) -> MessageRead:
    """One message, with its body replaced by a tombstone if it was soft-deleted."""

    deleted = message.deleted_at is not None
    return MessageRead(
        id=str(message.id),
        conversation_id=str(message.conversation_id),
        sender=_summary(message.sender, session),
        # The column is NOT NULL and stays that way on disk; nulling it here is
        # what turns a deleted row into a tombstone instead of exposing its text.
        body=None if deleted else message.body,
        client_message_id=message.client_message_id,
        created_at=message.created_at.isoformat(),
        edited_at=message.edited_at.isoformat() if message.edited_at else None,
        deleted_at=message.deleted_at.isoformat() if message.deleted_at else None,
    )
# --- reading conversations ---------------------------------------------------


def _unread_counts(
    session: Session, conversation_ids: list[uuid.UUID], viewer: User
) -> dict[uuid.UUID, int]:
    """Unread counts for a whole page, in **one** query.

    A count per conversation would be an N+1 across up to a hundred rows. Joining
    to the viewer's own membership row carries the read pointer into the same
    query, so the "after my pointer" comparison happens in SQL against the
    ``(conversation_id, created_at, id)`` index rather than in Python.

    A conversation the caller did not feature in the result simply has no entry;
    that is 0, and ``dict.get`` supplies it.
    """

    if not conversation_ids:
        return {}

    anchor = Message.__table__.alias("read_anchor")
    statement = (
        select(Message.conversation_id, func.count(Message.id))
        .join(
            ConversationMember.__table__,
            and_(
                ConversationMember.__table__.c.conversation_id
                == Message.__table__.c.conversation_id,
                ConversationMember.__table__.c.user_id == viewer.id,
            ),
        )
        .outerjoin(
            anchor,
            anchor.c.id == ConversationMember.__table__.c.last_read_message_id,
        )
        .where(
            Message.__table__.c.conversation_id.in_(conversation_ids),
            # You cannot unread what you just wrote. Without this the sender sees
            # their own conversation as unread, which is nonsense.
            Message.__table__.c.sender_id != viewer.id,
            or_(
                anchor.c.id.is_(None),
                Message.__table__.c.created_at > anchor.c.created_at,
                and_(
                    Message.__table__.c.created_at == anchor.c.created_at,
                    Message.__table__.c.id > anchor.c.id,
                ),
            ),
        )
        .group_by(Message.__table__.c.conversation_id)
    )
    return {
        conversation_id: int(total)
        for conversation_id, total in session.execute(statement)
    }


def _sorted_members(conversation: Conversation) -> list[ConversationMember]:
    """A deterministic member order: who joined first, id breaking any tie."""

    return sorted(conversation.members, key=lambda m: (m.joined_at, str(m.user_id)))


def conversation_reads(
    session: Session, conversations: list[Conversation], viewer: User
) -> list[ConversationRead]:
    """Build a whole page of conversation read models without an N+1.

    Three queries for the page regardless of its size: the conversations and their
    members (already eager-loaded by the caller), the last message of each, and the
    unread counts.
    """

    if not conversations:
        return []

    last_ids = [
        c.last_message_id for c in conversations if c.last_message_id is not None
    ]
    last_messages: dict[uuid.UUID, Message] = {}
    if last_ids:
        last_messages = {
            message.id: message
            for message in session.scalars(
                select(Message)
                .options(selectinload(Message.sender))
                .where(Message.id.in_(last_ids))
            )
        }

    counts = _unread_counts(session, [c.id for c in conversations], viewer)

    results: list[ConversationRead] = []
    for conversation in conversations:
        member = next(
            m for m in conversation.members if m.user_id == viewer.id
        )
        last = last_messages.get(conversation.last_message_id)
        results.append(
            ConversationRead(
                id=str(conversation.id),
                created_by=str(conversation.created_by),
                created_at=conversation.created_at.isoformat(),
                last_message_at=(
                    conversation.last_message_at.isoformat()
                    if conversation.last_message_at
                    else None
                ),
                last_message=message_read(last, session) if last is not None else None,
                members=[_summary(m.user, session) for m in _sorted_members(conversation)],
                unread_count=counts.get(conversation.id, 0),
                muted=member.muted,
                archived=member.archived,
            )
        )
    return results


def _find_member(
    session: Session, viewer: User, raw_id: str
) -> tuple[Conversation, ConversationMember]:
    """The caller's conversation with this id, plus their membership row — or 404.

    ``parse_id`` answers 404 for a malformed id so the route is not a
    UUID-format oracle, and the membership filter is part of the lookup rather
    than a check afterwards.
    """

    conversation_id = parse_id(raw_id, "conversation")
    member = session.scalar(
        select(ConversationMember)
        .options(
            selectinload(ConversationMember.conversation).selectinload(
                Conversation.members
            ).selectinload(ConversationMember.user),
        )
        .where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == viewer.id,
        )
    )
    if member is None:
        raise _conversation_not_found()
    return member.conversation, member


# --- opening a conversation --------------------------------------------------


def _may_message(session: Session, viewer: User, target: User) -> bool:
    """Whether these two may have a conversation at all.

    Two conditions, and they deliberately collapse into one boolean because the
    caller turns both into the same 403:

    * an **accepted** connection exists between them. §22.1: "messaging between
      strangers needs a relationship rule", and Phase 4's ``accepted`` row is the
      only such relationship the platform has. A pending request is not acceptance.
    * the target has not turned messages off (§7.5). A missing privacy row means
      the column default, which is ``allow_messages = true`` — read without
      creating one, because a read must not write.
    """

    connected = session.scalar(
        select(Connection.id).where(
            Connection.status == ConnectionStatus.ACCEPTED,
            or_(
                and_(
                    Connection.requester_id == viewer.id,
                    Connection.addressee_id == target.id,
                ),
                and_(
                    Connection.requester_id == target.id,
                    Connection.addressee_id == viewer.id,
                ),
            ),
        )
    )
    if connected is None:
        return False

    privacy = session.get(ProfilePrivacy, target.id)
    return privacy is None or privacy.allow_messages


def _load_by_direct_key(
    session: Session, key: str
) -> Conversation | None:
    return session.scalar(
        select(Conversation)
        .options(selectinload(Conversation.members).selectinload(ConversationMember.user))
        .where(Conversation.direct_key == key)
    )


def create_or_reuse(
    session: Session, viewer: User, target_id: uuid.UUID
) -> tuple[ConversationRead, bool]:
    """``POST /conversations`` — returns the conversation and whether it was created.

    **201 only when a row was actually inserted.** §7.3 says "Open (or reuse)", so
    a second request between the same two people is the same conversation, not a
    second one. Reuse answers 200: claiming to have created a resource that already
    existed is the same lie Phase 4 refused to tell for a duplicate connection
    request.

    The pair is identified by ``direct_key`` rather than by a "does one exist?"
    check, so two simultaneous opens cannot produce two threads. If the second
    INSERT still loses the race, the unique index decides and this returns the
    winner's row instead of a 500.
    """

    if target_id == viewer.id:
        raise _self_conversation()
    target = session.get(User, target_id)
    if target is None:
        raise _no_such_user()
    if not _may_message(session, viewer, target):
        raise _cannot_start_conversation()

    key = _direct_key(viewer.id, target_id)

    existing = _load_by_direct_key(session, key)
    if existing is not None:
        return conversation_reads(session, [existing], viewer)[0], False

    conversation = Conversation(created_by=viewer.id, direct_key=key)
    session.add(conversation)
    try:
        session.flush()  # the members need the id
        session.add_all(
            [
                ConversationMember(conversation_id=conversation.id, user_id=viewer.id),
                ConversationMember(
                    conversation_id=conversation.id, user_id=target_id
                ),
            ]
        )
        session.commit()
    except IntegrityError as exc:
        # Lost the race. The unique index decided, not us, and the loser gets the
        # winner's conversation rather than a 500.
        session.rollback()
        existing = _load_by_direct_key(session, key)
        if existing is None:
            raise _cannot_start_conversation() from exc
        return conversation_reads(session, [existing], viewer)[0], False

    session.refresh(conversation)
    created = _load_by_direct_key(session, key)
    assert created is not None  # just committed; the reload only populates members
    return conversation_reads(session, [created], viewer)[0], True
# --- listing and detail ------------------------------------------------------


def list_for(
    session: Session,
    viewer: User,
    limit: int = CONVERSATION_PAGE_DEFAULT,
    cursor: str | None = None,
) -> ConversationPage:
    """``GET /conversations`` — the caller's threads, newest activity first.

    Ordered by ``last_message_at DESC NULLS LAST, id DESC`` (§14.6's index) and
    paged on **that same key**. Paging on anything else is how a row slips through
    the gap when a message arrives mid-scroll.

    ``NULLS LAST`` means a conversation with no messages sorts to the end, and the
    cursor has to cope: once the walk reaches the null tail the boundary is "still
    null, and a smaller id", which is a different predicate from the ordinary one.
    Both are handled rather than pretending the column is non-null.
    """

    statement = (
        select(Conversation)
        .join(
            ConversationMember,
            ConversationMember.conversation_id == Conversation.id,
        )
        .where(ConversationMember.user_id == viewer.id)
    )

    boundary = decode_cursor(cursor)
    if boundary is not None:
        sort_at, row_id = boundary
        if sort_at is None:
            statement = statement.where(
                and_(
                    Conversation.last_message_at.is_(None),
                    Conversation.id < row_id,
                )
            )
        else:
            statement = statement.where(
                or_(
                    Conversation.last_message_at < sort_at,
                    and_(
                        Conversation.last_message_at == sort_at,
                        Conversation.id < row_id,
                    ),
                )
            )

    rows = list(
        session.scalars(
            statement.options(
                selectinload(Conversation.members).selectinload(
                    ConversationMember.user
                )
            )
            .order_by(
                Conversation.last_message_at.desc().nullslast(),
                Conversation.id.desc(),
            )
            # One row more than asked for: that is how has_more is known without a
            # COUNT, which is the whole point of keyset over offset.
            .limit(limit + 1)
        )
    )
    has_more = len(rows) > limit
    page = rows[:limit]
    # The next page continues below the *last* row of this one — which, since the
    # page is fetched newest-first, is its oldest.
    oldest = page[-1] if page and has_more else None
    return ConversationPage(
        items=conversation_reads(session, page, viewer),
        next_cursor=(
            encode_cursor(oldest.last_message_at, oldest.id) if oldest else None
        ),
        has_more=has_more,
    )


def detail(session: Session, viewer: User, raw_id: str) -> ConversationRead:
    """``GET /conversations/{id}`` — members and last message, members only."""

    conversation, _ = _find_member(session, viewer, raw_id)
    return conversation_reads(session, [conversation], viewer)[0]
# --- messages ----------------------------------------------------------------


def list_messages(
    session: Session,
    viewer: User,
    raw_id: str,
    limit: int = MESSAGE_PAGE_DEFAULT,
    cursor: str | None = None,
    since: uuid.UUID | None = None,
) -> MessagePage:
    """``GET /conversations/{id}/messages`` — always oldest → newest within the page.

    Two paging directions, because the client needs both:

    * ``cursor`` walks **backwards** through history. The database is asked for the
      newest rows below the boundary (so the index can walk it) and the page is
      reversed before returning, which is what puts the thread the right way up.
    * ``since`` is §7.2's polling affordance — "everything after this message",
      for the 5–10s focused-thread poll. It is a message id rather than a timestamp
      because timestamps are not unique, and a tie would silently drop a message.

    No cursor and no ``since`` returns the **most recent** page, because that is
    what a thread shows when it is opened.
    """

    conversation, _ = _find_member(session, viewer, raw_id)
    base = (
        select(Message)
        .options(selectinload(Message.sender))
        .where(Message.conversation_id == conversation.id)
    )

    if since is not None:
        anchor = session.get(Message, since)
        if anchor is None or anchor.conversation_id != conversation.id:
            # A message id belonging to a different conversation must not become a
            # way to read a conversation the caller is not a member of.
            raise _message_not_found()
        rows = list(
            session.scalars(
                base.where(
                    or_(
                        Message.created_at > anchor.created_at,
                        and_(
                            Message.created_at == anchor.created_at,
                            Message.id > anchor.id,
                        ),
                    )
                )
                .order_by(Message.created_at, Message.id)
                .limit(limit + 1)
            )
        )
        has_more = len(rows) > limit
        items = rows[:limit]
        newest = items[-1] if items and has_more else None
        return MessagePage(
            items=[message_read(message, session) for message in items],
            next_cursor=(
                encode_cursor(newest.created_at, newest.id) if newest else None
            ),
            has_more=has_more,
        )

    boundary = decode_cursor(cursor)
    if boundary is not None:
        sort_at, row_id = boundary
        base = base.where(
            or_(
                Message.created_at < sort_at,
                and_(
                    Message.created_at == sort_at,
                    Message.id < row_id,
                ),
            )
        )

    newest_first = list(
        session.scalars(
            base.order_by(
                Message.created_at.desc(), Message.id.desc()
            ).limit(limit + 1)
        )
    )
    has_more = len(newest_first) > limit
    page = list(reversed(newest_first[:limit]))  # <- oldest → newest within the page
    oldest = page[0] if page and has_more else None
    return MessagePage(
        items=[message_read(message, session) for message in page],
        next_cursor=(
            encode_cursor(oldest.created_at, oldest.id) if oldest else None
        ),
        has_more=has_more,
    )
# --- sending, reading up to, soft delete ------------------------------------


def _cannot_send() -> ApiError:
    """A deliberate 409 rather than a leaked integrity error. See ``send``."""

    return ApiError(
        status_code=409,
        code=ErrorCode.CONFLICT,
        message="That message could not be sent. Please try again.",
    )


def send(
    session: Session, viewer: User, raw_id: str, payload: MessageCreate
) -> tuple[MessageRead, bool]:
    """``POST /conversations/{id}/messages`` — the message, and whether it is new.

    **The sender is ``viewer``, always.** It is never read from ``payload``, and
    ``MessageCreate`` has no field it could be read from; a client that tries to
    supply one is refused by ``extra="forbid"`` before it reaches here.

    ``client_message_id`` makes a retried send safe (§18). A repeat returns the
    message that already exists with **200**, because nothing was created — the
    same reasoning Phase 4 used for a duplicate connection request. If two retries
    race, the unique index rejects the loser and the loser re-reads the winner's
    row rather than surfacing an integrity error to a person.
    """

    conversation, _ = _find_member(session, viewer, raw_id)

    # The recipient is the **other** member. `_find_member` has already proved the
    # viewer is one, and V1 is 1:1, so the counterpart is the single membership
    # row that is not the caller's. Derived from the conversation, never from the
    # request body — `MessageCreate` has no field a recipient could be read from,
    # and the sender is `viewer` alone.
    recipient = next(
        member.user_id
        for member in _sorted_members(conversation)
        if member.user_id != viewer.id
    )

    def _by_key() -> Message | None:
        return session.scalar(
            select(Message)
            .options(selectinload(Message.sender))
            .where(
                Message.conversation_id == conversation.id,
                Message.sender_id == viewer.id,
                Message.client_message_id == payload.client_message_id,
            )
        )

    if payload.client_message_id is not None:
        existing = _by_key()
        if existing is not None:
            return message_read(existing, session), False

    message = Message(
        conversation_id=conversation.id,
        sender_id=viewer.id,
        body=payload.body,
        client_message_id=payload.client_message_id,
    )
    session.add(message)
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        winner = _by_key() if payload.client_message_id is not None else None
        if winner is None:
            raise _cannot_send() from exc
        return message_read(winner, session), False

    # Advance the conversation's activity pointer, and only ever forwards. Two
    # messages sent in the same instant can finish committing out of order, and
    # without this the conversation could end up pointing at the *older* one.
    if (
        conversation.last_message_at is None
        or message.created_at >= conversation.last_message_at
    ):
        conversation.last_message_at = message.created_at
        conversation.last_message_id = message.id

    session.add(conversation)
    # §13.1's `message` type. Staged **before** this commit so the notification
    # and the message it describes are written by one transaction: a message
    # cannot exist without its notification, and the IntegrityError arm above
    # (which returns `False` and never reaches here) cannot leave one behind.
    notification = notifications.emit(
        session,
        recipient_id=recipient,
        notification_type=NotificationType.MESSAGE,
        actor_id=viewer.id,
        target_type="conversation",
        target_id=conversation.id,
        title=_MESSAGE_TITLE,
        # §13.2: identifiers for the deep link, never the message text. Putting
        # the body here would copy every private message into a second table.
        data={"conversation_id": str(conversation.id)},
    )
    session.commit()
    session.refresh(message)

    # Phase 3 realtime: after the commit, so a rollback leaves no event. A message
    # legitimately produces TWO events — `message.created` for the thread and
    # `notification.created` for the badge — and they are not interchangeable: the
    # first carries the body, the second carries only the notification's own
    # fields. Publishing only one would leave the recipient's badge stale.
    notification_events.publish_for(notification)

    # Phase 2 realtime: ONLY now, after the commit returned. A rollback at any
    # point above would leave the recipient holding an event for a message that
    # does not exist, and no client-side reconciliation repairs that.
    #
    # `created` is false on the idempotent paths above (already stored, or lost
    # a race), and both returned before reaching here — so this fires once per
    # stored message and never for a retry.
    messaging_events.message_created(
        recipient_user_id=str(recipient),
        message_id=str(message.id),
        conversation_id=str(message.conversation_id),
        sender_user_id=str(message.sender_id),
        created_at=message.created_at.isoformat(),
        body=message.body,
        client_message_id=message.client_message_id,
    )

    # Phase 4 push: last, and strictly after the commit above. Two reasons for the
    # position, not just the ordering: a rollback leaves no push, so a message that
    # does not exist can never appear on a lock screen; and it runs *after* both
    # socket publishes because that call is synchronous network I/O to a third
    # party, and the foreground path must not wait on it. A recipient with the app
    # open is served by the socket; push is the background fallback and has no
    # business being in front of it.
    push.dispatch(session, notification)
    return message_read(message, session), True


def mark_read(
    session: Session, viewer: User, raw_id: str, message_id: uuid.UUID
) -> None:
    """``POST /conversations/{id}/read`` — move the caller's own read pointer.

    Two rules:

    * **Only the caller's row moves.** Read state is per member; touching anybody
      else's would be marking their mail for them.
    * **Only forwards.** A read receipt is a pointer that advances (§7.4). A stale
      client re-sending an old message id must not un-read everything after it —
      that would make unread counts grow on a routine retry.
    """

    conversation, member = _find_member(session, viewer, raw_id)

    message = session.get(Message, message_id)
    if message is None or message.conversation_id != conversation.id:
        # Same 404 as "no such conversation": the caller must not be able to probe
        # for message ids in a thread they are not a member of.
        raise _message_not_found()

    if member.last_read_message_id is not None:
        current = session.get(Message, member.last_read_message_id)
        if current is not None and (
            current.created_at,
            current.id,
        ) >= (message.created_at, message.id):
            return  # already read this far, or further

    member.last_read_message_id = message.id
    session.add(member)
    session.commit()

    # Phase 2 realtime: after the commit, and only because the pointer actually
    # moved. The early return above fires no event — re-announcing a read that
    # did not change would make the recipient's UI flicker for nothing.
    #
    # The audience is the other participant, derived from the conversation's own
    # membership rows, and the reader is `viewer` — the authenticated caller.
    # Neither value came from the request.
    recipients = [
        other.user_id
        for other in _sorted_members(conversation)
        if other.user_id != viewer.id
    ]
    for recipient in recipients:
        messaging_events.conversation_read(
            recipient_user_id=str(recipient),
            conversation_id=str(conversation.id),
            reader_user_id=str(viewer.id),
            last_read_message_id=str(message.id),
            read_at=datetime.now(UTC).isoformat(),
        )


def soft_delete(session: Session, viewer: User, raw_id: str) -> None:
    """``DELETE /messages/{id}`` — the **sender** only; the row keeps its slot.

    §14.6: "a deleted row keeps its slot with a tombstone". The row is stamped, not
    removed, so the message does not jump position in a thread somebody else is
    reading; :func:`message_read` turns it into a tombstone with no body.

    A non-member and a non-sender both get the same 404. The message is in a
    conversation the caller belongs to, so there is nothing to enumerate — but a
    distinct "you are not the sender" answer would still be more information than
    the caller needs, and this endpoint has no legitimate reason to give it.
    """

    message_id = parse_id(raw_id, "message")
    message = session.get(Message, message_id)
    if message is None:
        raise _message_not_found()

    member = session.scalar(
        select(ConversationMember).where(
            ConversationMember.conversation_id == message.conversation_id,
            ConversationMember.user_id == viewer.id,
        )
    )
    if member is None or message.sender_id != viewer.id:
        raise _message_not_found()

    if message.deleted_at is not None:
        return  # already deleted; a repeat is a no-op, not a second tombstone

    message.deleted_at = _now()
    message.deleted_by = viewer.id
    session.add(message)
    session.commit()
