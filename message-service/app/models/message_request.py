"""``message_requests`` — the one table this service owns.

**Why this table exists.** The main backend's messaging domain has no
message-request concept: ``POST /conversations`` is refused with 403 unless the
two accounts share an *accepted connection*, so a stranger has no way to ask
for permission to message somebody. The Messages screen's Requests tab is that
missing workflow, and it is modelled as its own entity rather than as a
connection request — accepting a message request is permission to message, not
the creation of a social connection, and conflating the two would let a tap on
"Accept" silently change a different relationship.

Design decisions worth stating:

**One row per directed pair while pending.** A partial unique index on
``(sender_id, recipient_id) WHERE status = 'pending'`` makes two simultaneous
creates converge on one row without a serialisable transaction — the same race
the main backend's connection table solves with a sorted-pair index, but here
the direction is meaningful (A asking B is not B asking A), so the plain pair
is the key.

**``responded_at`` mirrors the connections rule.** The CHECK
``(status = 'pending') = (responded_at IS NULL)`` is the last line of defence
behind the service layer's state machine: the two columns can never disagree,
and no route can set one without the other.

**Sender and recipient are both plain FKs to ``users`` with CASCADE.** A
message request has no meaning once an account is gone, unlike a conversation
somebody else is still reading — this is the connections table's choice, not
the messaging one's.

**No message body.** The request carries an optional short *note* (§ "request
note"), never message content: private message content must not be reachable
by an unauthorised caller, and a note is the only text this endpoint ever
persists.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

# Registers the `users` FK-target stub in this metadata. A string foreign key
# resolves against the *declaring* metadata, so without this import the first
# flush fails with "could not find table 'users'" — see
# app/db/dependencies.py for the two defences that keep the stub out of
# migrations.
from app.db import dependencies as _fk_targets  # noqa: F401
from app.db.base import Base, CreatedAtMixin, UUIDPrimaryKeyMixin


class MessageRequestStatus(StrEnum):
    """The state machine. ``pending`` is the only state with no timestamp."""

    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class MessageRequest(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """A request from one account to message another."""

    __tablename__ = "message_requests"
    __table_args__ = (
        # Bare CHECK names: the metadata naming convention
        # (`ck_%(table_name)s_…` in app/db/base.py) supplies the
        # `ck_message_requests_` prefix at run time — exactly how the main
        # backend's models work (see backend/app/models/connections.py).
        CheckConstraint("sender_id <> recipient_id", name="no_self_request"),
        CheckConstraint(
            "(status = 'pending') = (responded_at IS NULL)",
            name="responded_at_matches_pending",
        ),
        # The column is a bounded string rather than a native enum type so the
        # whole vocabulary lives in one place — this CHECK — and adding a state
        # later is one migration instead of an ``ALTER TYPE`` under load.
        CheckConstraint(
            "status IN ('pending', 'accepted', 'rejected')",
            name="status_is_known",
        ),
        # The recipient's list and count are the only reads that matter, so
        # they are one indexed scan rather than a filter over the whole table.
        Index(
            "ix_message_requests_recipient_id_status",
            "recipient_id",
            "status",
        ),
        # The create path's "is there already a pending one?" lookup.
        Index(
            "ix_message_requests_sender_id_recipient_id_status",
            "sender_id",
            "recipient_id",
            "status",
        ),
        {
            "comment": "A request to message; owned by the message service.",
        },
    )

    sender_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    recipient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: Stored as the enum's string value with a CHECK-friendly column type; see
    #: ``MessageRequestStatus``. The service layer is the state machine, the
    #: constraint is the backstop.
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=MessageRequestStatus.PENDING.value,
        server_default=MessageRequestStatus.PENDING.value,
    )
    #: The short "why I'm messaging you" note. Never message content.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Set by accept *and* reject alike; null while still pending (CHECK above).
    responded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # No ``sender`` / ``recipient`` relationships: ``users`` belongs to the main
    # backend and is not a mapped class here. A relationship would point at a
    # class this registry has never seen and fail mapper configuration on the
    # first query, so the sender summary is fetched with an explicit SELECT in
    # ``app/services/identity.py`` — which is also where the "read-only, never
    # write" rule for that table lives.


#: Declared after the class so ``func`` receives *columns*: inside the class
#: body the mapped attributes do not exist yet, and a string literal would be
#: indexed instead of the column. Partial, so only pending rows collide — a
#: resolved request never blocks a later one.
Index(
    "uq_message_requests_pending_pair",
    MessageRequest.sender_id,
    MessageRequest.recipient_id,
    unique=True,
    postgresql_where=MessageRequest.status == MessageRequestStatus.PENDING.value,
)
