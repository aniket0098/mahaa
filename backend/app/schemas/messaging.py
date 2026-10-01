"""Messaging read and write models — the wire shapes for §7.3's seven endpoints.

**No mobile module exists yet.** §7.1 records that there is no
``src/api/messages.ts`` or ``conversations.ts``, and both messages screens are
`StageScreen` notices, so there is no TypeScript type to mirror field-for-field.
These shapes are therefore derived from the *specification* alone (§7.3, §7.4,
§14.6) and are written to be the thing a Phase 10 mobile module binds to.

Three shape decisions worth stating, because each one is a place a reasonable
implementer could have gone differently:

**``body`` is nullable, and null means deleted.** The column is ``NOT NULL`` and a
soft-deleted row keeps its slot (§14.6), so the read model cannot simply stop
including the message — that would make it jump position in a thread somebody is
reading. Instead the deleted message comes back as a tombstone: ``body`` is null
and ``deleted_at`` is set. Those two are equivalent by construction, so there is no
separate ``is_deleted`` flag that could fall out of step with them.

**``sender`` is the project's existing ``UserSummary``** — the same minimal shape
``GET /users/lookup`` returns. A message is the most exposed object in the product,
so it carries a name, a handle and a role and nothing else: no email, no phone, no
headline, nothing the owner's ``profile_privacy`` governs. There is no schema field
that could leak, which is stronger than remembering to redact.

**Pagination is keyset, and the envelope is deliberately new.** §17 requires keyset
for "endpoints that will grow without bound — messages, notifications, call
history, conversations", but V1 has only the offset and ``FastApiPage`` envelopes
and neither fits. So this adds the third: ``{items, next_cursor, has_more}``, where
the cursor is opaque and encodes the sort key. It is not a renamed ``Page`` —
``Page`` promises a real ``total`` count, which is exactly what keyset avoids
computing.

**There is no ``sender_id`` on any write model.** A client cannot set who sent a
message because there is no field to set, and ``extra="forbid"`` turns an attempt
into a 422 rather than a silently ignored key.
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.users import UserSummary

#: The longest a single message may be. A chat bubble that cannot hold an
#: interview link and two sentences is not a chat bubble, and an unbounded column
#: would let one request carry megabytes.
MESSAGE_BODY_MAX = 4000

#: Whitespace-only bodies are refused rather than stored. Without this, `"   "` is
#: a valid string of length 3 and renders as an empty bubble forever.
_NO_CONTENT_MESSAGE = "A message cannot be empty."


class ConversationCreate(BaseModel):
    """``POST /conversations`` — body is exactly ``{user_id}``.

    The internal id of the other participant, which is what ``/users/lookup``
    returns. The service decides whether the pair may have a conversation at all.
    """

    model_config = ConfigDict(extra="forbid")

    user_id: uuid.UUID


class MessageCreate(BaseModel):
    """``POST /conversations/{id}/messages``.

    There is no ``sender_id``, and ``extra="forbid"`` is what turns a client that
    tries to supply one into a 422 instead of an impersonation.
    """

    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=MESSAGE_BODY_MAX)
    #: The sender's own idempotency key (§18). Optional, and absent means "do not
    #: bother": ordinary messages carry a NULL here, and PostgreSQL treats NULLs as
    #: distinct, so keyed and unkeyed messages never collide.
    client_message_id: str | None = Field(
        default=None, min_length=1, max_length=100
    )

    @field_validator("body")
    @classmethod
    def _body_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError(_NO_CONTENT_MESSAGE)
        return value
class MarkReadRequest(BaseModel):
    """``POST /conversations/{id}/read`` — body is exactly ``{message_id}``.

    "Mark read up to a point" needs a point, so the id is required rather than
    optional. Sending null would have to mean "mark everything", which is a
    different operation and would need its own name.
    """

    model_config = ConfigDict(extra="forbid")

    message_id: uuid.UUID


class MessageRead(BaseModel):
    """One message, as a member of the conversation sees it."""

    id: str
    conversation_id: str
    sender: UserSummary
    #: Null exactly when ``deleted_at`` is set — the tombstone of a soft delete.
    body: str | None
    client_message_id: str | None
    created_at: str
    edited_at: str | None
    deleted_at: str | None


class ConversationRead(BaseModel):
    """One conversation, including the caller's own view of it."""

    id: str
    created_by: str
    created_at: str
    last_message_at: str | None
    last_message: MessageRead | None
    members: list[UserSummary]
    #: Messages after the caller's read pointer that the caller did **not** send.
    #: The caller's own messages never count: you cannot unread what you just
    #: wrote, so counting them would show the sender their thread as unread.
    unread_count: int
    #: The caller's own membership flags, echoed from §14.6. V1 has no route that
    #: changes them; they are here so the stored state is visible rather than
    #: invisible, and they are the caller's own rows so there is nothing to leak.
    muted: bool
    archived: bool


class ConversationPage(BaseModel):
    """Keyset page of conversations — see the module docstring for why this shape."""

    items: list[ConversationRead]
    #: Opaque. Pass it back as ``cursor``. Null when there is nothing older.
    next_cursor: str | None
    has_more: bool


class MessagePage(BaseModel):
    """Keyset page of messages, always **oldest → newest within the page**.

    Ascending inside a page is what a thread renders; the cursor walks *backwards*
    through history, so a page is fetched newest-first from the database and
    reversed before it is returned. Getting that order wrong shows a conversation
    upside down, which is why it is stated here, in the service, and in the test.
    """

    items: list[MessageRead]
    #: Opaque. Pass it back as ``cursor``. Null when there is nothing older.
    next_cursor: str | None
    has_more: bool
