"""The ``/conversations`` and ``/messages`` router — §7.3's seven endpoints.

**Every endpoint here is Proposed in the specification, and none of them has a
mobile caller.** §7.1 records that the app has no ``src/api/messages.ts`` or
``conversations.ts``, and that both messages screens are `StageScreen` notices
("Stage 8 — messaging"). So unlike Phases 2–4, this contract comes from the
specification alone and is not a mirror of any TypeScript type. These shapes are
what a Phase 10 mobile module will bind to.

**REST, deliberately.** §7.2 rejects WebSocket for V1 on three grounds — the
client has no socket capability at all, Render's free plan spins down when idle so
a long-lived socket is both a keep-warm and the first thing dropped, and LiveKit
already owns the realtime path that genuinely needs it. Nothing in this file knows
how delivery happens; ``?since=`` is the documented poll, and the message model is
plain rows with a monotonic id so a socket or SSE layer can be added in front
later without touching the schema.

**Two 201/200 pairs, both for the same reason.** A resource that already exists is
not "created", so a repeat answers 200 with the same record: opening a conversation
one already has, and re-sending a message with the same ``client_message_id``.
Reporting 201 would tell the client it made something new.

**No role restriction.** ``CurrentUser``, not ``CandidateUser``. Messaging is not a
candidate-record feature — an employer answering a candidate is the point — and §7
never scopes it to a role.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.messaging import (
    ConversationCreate,
    ConversationPage,
    ConversationRead,
    MarkReadRequest,
    MessageCreate,
    MessagePage,
    MessageRead,
    MessageUpdate,
)
from app.services import messaging as svc
from app.services.messaging import (
    CONVERSATION_PAGE_DEFAULT,
    CONVERSATION_PAGE_MAX,
    MESSAGE_PAGE_DEFAULT,
    MESSAGE_PAGE_MAX,
)

router = APIRouter(tags=["messaging"])

#: One bound pair of query parameters for both paged endpoints. Declared once so
#: the two cannot drift, exactly as `schemas.common.page_params` does for the offset
#: pages — except these are keyset, so there is no `offset`, and no `total`, which
#: keyset deliberately does not compute.
#:
#: The bounds live inside `Query` and the **defaults live in the signatures**,
#: which is the only arrangement FastAPI accepts: setting a default inside
#: `Annotated` is an assertion error, and leaving it out of both is a required
#: parameter. Splitting it this way is not a preference, it is the API contract.
ConversationLimit = Annotated[int, Query(ge=1, le=CONVERSATION_PAGE_MAX)]
MessageLimit = Annotated[int, Query(ge=1, le=MESSAGE_PAGE_MAX)]
Cursor = Annotated[str | None, Query(description="Opaque cursor from a previous page.")]
Since = Annotated[
    uuid.UUID | None,
    Query(description="Return messages after this one. Polling (§7.2)."),
]
@router.get(
    "/conversations",
    response_model=ConversationPage,
    summary="My conversations, newest activity first",
)
def list_conversations(
    current_user: CurrentUser,
    session: DbSession,
    limit: ConversationLimit = CONVERSATION_PAGE_DEFAULT,
    cursor: Cursor = None,
) -> ConversationPage:
    """Every conversation the caller is a member of, with unread counts.

    Membership is the only filter, so there is no way to ask for somebody else's
    list — the query joins the caller's own membership row, so a conversation the
    caller is not in cannot be returned even by accident.
    """

    return svc.list_for(session, current_user, limit, cursor)


@router.post(
    "/conversations",
    response_model=ConversationRead,
    status_code=status.HTTP_201_CREATED,
    summary="Open or reuse a 1:1 conversation",
)
def open_conversation(
    payload: ConversationCreate,
    response: Response,
    current_user: CurrentUser,
    session: DbSession,
) -> ConversationRead:
    """Open a thread with ``user_id``, or hand back the one that already exists.

    Refused with **403** when the two are not connected, or when the other person
    has turned messages off — one code and one sentence for both, because §7.5
    exists precisely so a sender cannot discover a private setting by trying.
    """

    record, created = svc.create_or_reuse(session, current_user, payload.user_id)
    if not created:
        response.status_code = status.HTTP_200_OK
    return record


@router.get(
    "/conversations/{conversation_id}",
    response_model=ConversationRead,
    summary="Conversation detail",
)
def read_conversation(
    conversation_id: str, current_user: CurrentUser, session: DbSession
) -> ConversationRead:
    """Members and the last message. A non-member gets 404, never 403."""

    return svc.detail(session, current_user, conversation_id)


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=MessagePage,
    summary="A page of messages, oldest to newest",
)
def list_messages(
    conversation_id: str,
    current_user: CurrentUser,
    session: DbSession,
    limit: MessageLimit = MESSAGE_PAGE_DEFAULT,
    cursor: Cursor = None,
    since: Since = None,
) -> MessagePage:
    """Page a thread.

    ``cursor`` walks backwards through history; ``since`` is the polling direction
    §7.2 describes. With neither, the most recent page — what a thread shows when
    it is opened.
    """

    return svc.list_messages(
        session, current_user, conversation_id, limit, cursor, since
    )


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=MessageRead,
    status_code=status.HTTP_201_CREATED,
    summary="Send a message",
)
def send_message(
    conversation_id: str,
    payload: MessageCreate,
    response: Response,
    current_user: CurrentUser,
    session: DbSession,
) -> MessageRead:
    """Store a message with the **authenticated caller** as its sender.

    The body has no sender field and ``extra="forbid"``, so a client cannot name
    somebody else even by accident.
    """

    record, created = svc.send(session, current_user, conversation_id, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    return record


@router.post(
    "/conversations/{conversation_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Mark read up to a message",
)
def mark_read(
    conversation_id: str,
    payload: MarkReadRequest,
    current_user: CurrentUser,
    session: DbSession,
) -> Response:
    """Move the caller's own read pointer forward.

    204: the caller already has the thread open, and its next read of the thread or
    of the list reports the new unread count.
    """

    svc.mark_read(session, current_user, conversation_id, payload.message_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/messages/{message_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft delete my own message",
)
def delete_message(
    message_id: str, current_user: CurrentUser, session: DbSession
) -> Response:
    """The sender only. The row keeps its slot and reads back as a tombstone."""

    svc.soft_delete(session, current_user, message_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/messages/{message_id}",
    response_model=MessageRead,
    summary="Edit my own message",
)
def update_message(
    message_id: str,
    payload: MessageUpdate,
    current_user: CurrentUser,
    session: DbSession,
) -> MessageRead:
    """Rewrite the text of a message the **authenticated caller** authored.

    The body has no author field and ``extra="forbid"``, so a client cannot
    name a different sender or stamp its own ``edited_at`` even by accident.
    A non-author, a non-member and an unknown id all read back as the same 404
    (anti-enumeration, matching ``DELETE /messages/{id}``); a deleted message
    is equally final and answers the same way. Identical text is a no-op that
    returns the stored row without moving ``edited_at``.
    """

    return svc.edit(session, current_user, message_id, payload)
