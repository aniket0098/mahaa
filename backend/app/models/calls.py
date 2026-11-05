"""``calls`` — one voice or video call between the two members of a conversation.

A call is a **durable lifecycle row**, not a transient signal, and that choice is
load-bearing for three reasons the schema makes explicit:

**It binds to a conversation, so authorization is inherited.** A call may only
exist between the two members of an existing 1:1 conversation, and the service
re-derives "is the caller a member of this conversation?" from the row rather
than trusting anything the client sent. There is no caller-chosen room name and
no free-form participant list: the LiveKit room is named after ``id`` (an opaque
UUID, never PII — LiveKit logs room names), and a participant token is minted
only for a member of the bound conversation. This is what makes "a caller cannot
join someone else's room" a schema fact rather than a hoped-for behaviour.

**It is the signaling record.** Ringing, answer, reject, cancel, hang-up and
expiry are all state transitions on this one row, so "who may perform this
transition" is decided in one place against one source of truth. An accepted
call is what tells the recipient's client to fetch a token and join; a ringing
call is what a second ``start`` from the same caller collapses onto rather than
creating a duplicate invitation.

**It is the call history and the missed-call record.** ``ended_at`` plus
``status`` answer "what happened", and the reaper stamps ``EXPIRED`` so an
unanswered ring is a durable missed call rather than an invitation that quietly
vanished.

**Tokens are never stored here.** A LiveKit token is short-lived and re-minted on
demand; persisting it would create a secret at rest with no need. Media and API
secrets are likewise absent — the only LiveKit value on the row is the room name,
which is this table's own primary key.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, UUIDPrimaryKeyMixin
from app.models.enums import CallMode, CallStatus, pg_enum


class Call(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One 1:1 voice or video call, bound to the conversation it belongs to."""

    __tablename__ = "calls"
    __table_args__ = (
        # Self-call is impossible because a conversation has two distinct members;
        # the service refuses it as a 422 and this stops anything that bypasses it.
        CheckConstraint("caller_id <> callee_id", name="no_self_call"),
        # A call cannot outlive the conversation it belongs to. CASCADE, not
        # RESTRICT: conversations are deleted with their messages, and their calls
        # are history of the same thread, so they go together.
        Index("ix_calls_conversation_id_status", "conversation_id", "status"),
        # The "is this person already in a call?" check that start and accept both
        # need before they may proceed.
        Index("ix_calls_callee_id_status", "callee_id", "status"),
        {"comment": "One 1:1 call; room name is the primary key (opaque UUID)."},
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    #: The only LiveKit value stored: the room name, opaque and never PII.
    room_name: Mapped[str] = mapped_column(nullable=False, unique=True)
    caller_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    callee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    mode: Mapped[CallMode] = mapped_column(
        pg_enum(CallMode, "call_mode"), nullable=False
    )
    status: Mapped[CallStatus] = mapped_column(
        pg_enum(CallStatus, "call_status"), nullable=False, default=CallStatus.RINGING
    )
    #: Server wall-clock at insert. ``clock_timestamp()``, not ``now()``: the
    #: ``CreatedAtMixin`` default is ``now()``, which in PostgreSQL is the
    #: *transaction start* and is therefore identical for every row written in one
    #: transaction. ``GET /conversations/{id}/calls`` orders by ``created_at desc``
    #: to render a newest-first "recent calls" list, so two calls created in the
    #: same transaction (the test harness runs a whole test in one savepoint) would
    #: tie and fall through to a random UUID tiebreak. ``clock_timestamp()`` is
    #: monotonic within a transaction, which is what a per-row creation ordering
    #: needs. Column type and nullability are unchanged, so this is a server_default
    #: only — no migration, and existing rows keep their value.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.clock_timestamp()
    )
    #: Server clock when the call moved out of RINGING (accepted, rejected,
    #: cancelled or expired alike). Null while still ringing — the same
    #: "null means the state has not been reached" convention connections uses.
    answered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Server clock when the call reached a terminal state. Null until then.
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Whose action ended it, so a hang-up is attributable. Null when the reaper
    #: expired it or the caller cancelled before answer — neither has an "ender".
    ended_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    conversation = relationship("Conversation")  # noqa: F821
    caller = relationship("User", foreign_keys=[caller_id])  # noqa: F821
    callee = relationship("User", foreign_keys=[callee_id])  # noqa: F821


#: Declared after the class because it references mapped columns.
#: Exactly one live (RINGING or ACCEPTED) call per conversation, enforced in the
#: database so two racing "start" calls cannot both create an invitation.
Index(
    "uq_calls_one_live_per_conversation",
    Call.conversation_id,
    unique=True,
    postgresql_where=Call.status.in_([CallStatus.RINGING, CallStatus.ACCEPTED]),
)
