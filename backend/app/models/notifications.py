"""``notifications`` — the one domain that reads across every other one.

A single table (§14.7), and the column list is the specification's verbatim. The
decisions worth stating are the ones where the obvious alternative is wrong.

**``is_read`` is a boolean and there is no ``read_at``.** §13.2 says "``is_read``
is a boolean on the row", §14.7 lists ``is_read bool NOT NULL DEFAULT false`` and
nothing else, and §14.7's column list is exhaustive elsewhere. A ``read_at``
timestamp is the reflex every notification system has — the mobile wants to show
"read 3 days ago", a retention job wants to know what to keep — and V1 has a use
for neither. When a phase needs the timestamp, its migration adds the column.

**``actor_id`` is SET NULL, not CASCADE, and that is the whole point of it.**
§13.4: "Do **not** cascade-delete notifications when the actor's content is
deleted — the recipient still needs to know something happened, with ``actor``
rendered as null/anonymous." §14 says it outright: "`actor_id` is `SET NULL`,
not `CASCADE`, precisely so §13.4 holds." So an account that goes away takes its
*notifications to other people* down with it — those rows survive, lose their
actor, and render as ``actor: null``.

**``user_id`` is CASCADE, the opposite, and deliberately so.** It is the
**recipient**, and a recipient's notifications are their mail: nobody has a
legitimate interest in another account's inbox, so the account's deletion takes
them with it. §14's general rule ("CASCADE only for true children") is what puts
a notification in the CASCADE column at all — it *is* a child of its recipient.

**No foreign key on ``target_id``.** It is a nullable uuid naming whatever the
notification is *about* — a connection, a conversation — and those tables are
owned by other domains. §14.7 gives the column no constraint, and a foreign key
here would make this table a circular dependency on the phases that own those
rows (and would break outright for a future target type that has no table). The
service layer knows the entity, which is where the question belongs.

**``data`` is jsonb and carries no rendered text.** §13.2: "a small JSON payload
for the client's deep link (e.g. ``{connection_id}``), never a rendered
message". It holds identifiers; ``title``/``body`` hold the server's wording, so
a copy change is a deployment and not a client release.

**The two indexes are both named in §14.7** and are not interchangeable: the
partial one serves `unread_only` and the unread count, the full one serves the
ordered list. Neither alone can do the other's job.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, UUIDPrimaryKeyMixin
from app.models.enums import NotificationType, pg_enum


class Notification(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One thing that happened, addressed to one account."""

    __tablename__ = "notifications"
    __table_args__ = (
        # §14.7's two indexes, in its order.
        #
        # The partial one is the unread query: `?unread_only=true` and the count
        # endpoint both filter `is_read = false`, and this index holds only those
        # rows, so a user with 4,000 notifications and 3 unread reads 3 index
        # entries rather than 4,000. The predicate is the literal text §13.2 and
        # §14.7 both give, because a partial index's predicate has to be immutable
        # for the planner to use it at all.
        Index(
            "ix_notifications_user_id_created_at_unread",
            "user_id",
            "created_at",
            postgresql_where=text("is_read = false"),
        ),
        # The full one is the list's sort key. §13.3 pages on
        # `(created_at, id) DESC`, and `id` is in the index because timestamps
        # alone are not unique — without it the tiebreak is a sort, and two rows
        # sharing a timestamp could come back in a different order on a re-read,
        # which is exactly the duplicate-across-pages bug keyset exists to prevent.
        Index(
            "ix_notifications_user_id_created_at_id",
            "user_id",
            "created_at",
            "id",
        ),
        {
            "comment": "One event addressed to one recipient. "
            "actor_id is SET NULL (§13.4)."
        },
    )

    #: The **recipient**. Always the server's own determination — never a request
    #: field, because a notification is somebody's mail and the only safe rule is
    #: that no client may address it.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    #: CHECK-constrained to :class:`NotificationType` — §13.1's registry, enforced
    #: by the database and not merely by the application that writes it.
    type: Mapped[NotificationType] = mapped_column(
        pg_enum(NotificationType, "notification_type"),
        nullable=False,
    )
    #: §13.2: "``actor`` is **nullable** — a system notification has no actor."
    #: SET NULL so the notification outlives the account (§13.4).
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: What this is about. No FK, deliberately — see the module docstring. Both
    #: are nullable because a ``system`` notification has no entity.
    target_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    #: Server-rendered wording. NOT NULL because a row with nothing to render is
    #: not a notification; ``body`` is nullable because a short title alone is a
    #: complete notification.
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: §13.2's "small JSON payload for the client's deep link". Identifiers only.
    data: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}", default=dict
    )
    is_read: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )

    #: Loaded only to build the read model. The nullable actor means the read
    #: model must genuinely cope with ``actor`` being absent (§13.2).
    actor: Mapped["User | None"] = relationship(foreign_keys=[actor_id])  # noqa: F821
