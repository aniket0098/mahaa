"""``connections`` — one relationship request or connection between two accounts.

This is the first table in the schema that points at ``users`` **twice**, and
almost everything unusual about it follows from that.

**One row per pair, in either direction.** The unique index is on
``(LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))``, not
on ``(requester_id, addressee_id)``. Sorting the pair before indexing it is what
makes "A→B" and "B→A" the *same* key, so a duplicate request is impossible even
when two clients race and both pass the application's "does this already exist?"
check. A plain two-column unique constraint would have permitted exactly the
contradictory pair the specification forbids.

**``status`` is a state, not a label.** There is no ``PATCH /connections/{id}``
route, so the only way to change it is through the dedicated verb that the
mobile client calls — accept, decline, cancel — or by deleting an accepted
connection. The database therefore stores no value the state machine cannot
reach, and the CHECK below is the last line of that defence.

**``responded_at`` means "pending ended", not "the addressee acted".** The CHECK
``(status = 'pending') = (responded_at IS NULL)`` is the specification's (§14.5) and
it is load-bearing: it makes a cancellation — which the *requester* performs, so
nobody "responded" — record a timestamp too. A row is pending if and only if it
has never been answered or cancelled, and the two columns can never disagree.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import ConnectionStatus, pg_enum


class Connection(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A request, or an accepted connection, between two accounts."""

    __tablename__ = "connections"
    __table_args__ = (
        # Self-connection is refused in the service layer as a 422 the caller can
        # read, and forbidden here for everything that does not go through it.
        CheckConstraint("requester_id <> addressee_id", name="no_self_connection"),
        # See the module docstring: pending is the only state with no timestamp.
        CheckConstraint(
            "(status = 'pending') = (responded_at IS NULL)",
            name="responded_at_matches_pending",
        ),
        # The two list queries behind `GET /connections?status=`: the incoming
        # list filters on the addressee, the sent list on the requester.
        Index("ix_connections_addressee_id_status", "addressee_id", "status"),
        Index("ix_connections_requester_id_status", "requester_id", "status"),
        {"comment": "One row per unordered pair of users; see the unique index."},
    )

    requester_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    addressee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[ConnectionStatus] = mapped_column(
        pg_enum(ConnectionStatus, "connection_status"), nullable=False
    )
    #: Set by accept, decline and cancel alike; null while still pending.
    responded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    requester: Mapped["User"] = relationship(  # noqa: F821
        foreign_keys=[requester_id]
    )
    addressee: Mapped["User"] = relationship(  # noqa: F821
        foreign_keys=[addressee_id]
    )


#: Declared after the class rather than in ``__table_args__`` because
#: ``LEAST``/``GREATEST`` take the *columns*, and inside a class body the mapped
#: attributes do not exist yet — ``func.least("requester_id", ...)`` would emit
#: the string literals instead of the columns and index nothing useful.
Index(
    "uq_connections_requester_id_addressee_id",
    func.least(Connection.requester_id, Connection.addressee_id),
    func.greatest(Connection.requester_id, Connection.addressee_id),
    unique=True,
)
