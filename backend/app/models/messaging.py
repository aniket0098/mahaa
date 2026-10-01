"""``conversations``, ``conversation_members`` and ``messages`` — the messaging domain.

Three tables, exactly as §14.6 specifies them. The design decisions that are not
obvious from the column list, and why each one is here:

**``direct_key`` is the 1:1 guarantee.** ``min:max`` of the two participants'
internal ids, UNIQUE. A conversation is then uniquely determined by *who* rather
than by a "does one already exist?" check, which is what makes two simultaneous
``POST /conversations`` for the same pair safe without a serialisable transaction.
It is NULLABLE, so a future group conversation (more than two members, no sorted
pair) does not need a migration — the unique index simply does not apply to it.

**There is no ``sender`` on a conversation and no ``conversation_id`` on a user.**
Both are the join table's job. That is why ``conversation_members`` is not a
convenience: it is where read state lives, and where a group conversation would
get its third participant for free.

**Two foreign keys are deliberately absent.**

* ``messages.media_id`` has no FK because ``media_assets`` does not exist until the
  media phase. Phase 1 set the same precedent with ``users.avatar_media_id``, and
  the reason is identical: a constraint may not reference a table that is not there
  yet. The media phase adds the table and the FK in one migration.
* ``conversation_members.last_read_message_id`` and
  ``conversations.last_message_id`` have no FK either. A foreign key from a
  conversation to a message inside that same conversation is circular, and
  ``last_read_message_id`` legitimately outlives the message it points at when a
  conversation is deleted along with its messages. Both are validated in the
  service layer, which is where "this message really is in this conversation" is
  already known.

**``sender_id`` is RESTRICT, not CASCADE.** Deleting an account must never silently
delete a conversation somebody else is still reading. The cost is that an account
with messages cannot be hard-deleted, which is the correct trade: §13.4 treats
deletion as a soft pause, and the account-delete route in Phase 3 is a separate
decision this domain does not get to make.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, UUIDPrimaryKeyMixin


class Conversation(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One 1:1 thread in V1; a group is the same row with a NULL ``direct_key``."""

    __tablename__ = "conversations"
    __table_args__ = (
        {"comment": "One thread. direct_key makes it 1:1 in V1; NULL allows groups."},
    )

    #: Who opened it. RESTRICT: a conversation whose creator row vanished would be
    #: an orphan nobody can name or clean up.
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    last_message_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Denormalised "most recent activity" pointer, so the list is one indexed scan
    #: rather than a correlated MAX over every conversation the caller is in.
    last_message_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    #: ``min:max`` of the two participants' ids. UNIQUE is the 1:1 guarantee.
    #: 36 + 1 + 36 characters, so String(73) is exact rather than generous.
    direct_key: Mapped[str | None] = mapped_column(
        String(73), nullable=True, unique=True
    )

    members: Mapped[list["ConversationMember"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


#: The list index, declared after the class because ``DESC NULLS LAST`` has to be
#: built from the mapped attribute. ?14.6 asks for exactly this ordering, and
#: ``NULLS LAST`` puts a conversation with no messages yet at the end of the list
#: rather than at the top, where a NULL would otherwise sort first in PostgreSQL.
#:
#: Built as a real expression rather than ``text("(col) DESC NULLS LAST")`` for two
#: reasons. SQLAlchemy renders the element, so the parens cannot be got wrong ?
#: ``((col DESC NULLS LAST))`` is a PostgreSQL parse error, because ordering
#: modifiers belong outside a parenthesised expression. And a ``text()`` element
#: does not compare equal to the expression Alembic reflects back out of the
#: database, so ``alembic check`` would report permanent phantom drift.
Index(
    "ix_conversations_last_message_at",
    Conversation.last_message_at.desc().nullslast(),
)


class ConversationMember(Base):
    """One participant's place in a conversation, and their read pointer.

    The composite primary key ``(conversation_id, user_id)`` *is* the membership
    rule: a duplicate join is a primary-key violation, so the database stops it
    even when two requests race.
    """

    __tablename__ = "conversation_members"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    #: A pointer, not a per-message boolean (§7.4): a read receipt is one row
    #: update rather than N. No FK — see the module docstring.
    last_read_message_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    #: Stored per §14.6. V1 has no route that changes them; they are the caller's
    #: own state, so they are safe to echo back in a read model.
    muted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )

    conversation: Mapped["Conversation"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship()  # noqa: F821

    __table_args__ = (
        # The reverse of the primary key, and the one the list endpoint needs:
        # "every conversation I am in", which the PK alone cannot serve.
        Index(
            "ix_conversation_members_user_id_conversation_id",
            "user_id",
            "conversation_id",
        ),
    )



class Message(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One message.

    ``body`` is NOT NULL and cannot be empty, and a soft-deleted row **keeps its
    slot**: ``DELETE /messages/{id}`` stamps ``deleted_at`` and the read model
    returns a tombstone, so the message neither jumps position nor vanishes from a
    thread somebody is reading.
    """

    __tablename__ = "messages"
    __table_args__ = (
        # §18: the client's own key makes a retried send safe. Three NULL
        # client_message_ids are three distinct rows, because PostgreSQL treats
        # NULLs as distinct in a unique index — which is what lets ordinary
        # messages coexist alongside keyed ones.
        UniqueConstraint(
            "conversation_id",
            "sender_id",
            "client_message_id",
            name="uq_messages_conversation_id_sender_id_client_message_id",
        ),
        # The pagination index. ``(conversation_id, created_at, id)`` is exactly the
        # keyset's sort key (§7.4), so paging a thread is an index walk, not a sort.
        Index(
            "ix_messages_conversation_id_created_at_id",
            "conversation_id",
            "created_at",
            "id",
        ),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    #: Always ``current_user.id``. Never taken from a request body.
    sender_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    #: No FK: the media phase owns this column and the table it would point at.
    media_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    client_message_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    #: Present so a future edit has a place to live; V1 has no edit route, and the
    #: schema does not pretend otherwise by omitting it.
    edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
    sender: Mapped["User"] = relationship(foreign_keys=[sender_id])  # noqa: F821

