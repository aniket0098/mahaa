"""Phase 10 — `user_devices`: push registration for a backgrounded app (§14.13).

Follows `b3f8a1c07d54` (Phase 9 career). It is **purely additive** — one new
table, one new index, one new constraint — so a deployment that already carries
Phases 1–9 keeps every existing row untouched.

**Why the table exists.** A WebSocket only reaches a running app. When Mahaa is
backgrounded or killed the socket is gone, and a connection request or a message
reaches the recipient only when they next open the app. `user_devices` is what
lets the backend reach the phone the other way round.

**``push_token`` is a credential.** It is stored because delivery requires it and
is never logged, never returned by an API, and never written into an error detail
(§20.3). It is `TEXT` rather than `VARCHAR` because a provider token's length is
the provider's business, and §14.4's "never trust an external system's field
width" is the rule this project already applies to third-party ids.

**The unique constraint is scoped to ``user_id`` on purpose.** ``UNIQUE
(push_token)`` alone would let whichever account registered last take delivery
for a device the other still owns. ``UNIQUE (user_id, push_token)`` instead makes
*registration* idempotent for one user — §13.6's "same user + same token = same
device" — without denying a second account a device it legitimately holds.

**``platform`` is a CHECK, not an ENUM**, matching every other vocabulary in §14:
adding iOS later is a constraint change the project already knows how to express,
and an ENUM would make it an ALTER TYPE.

**``ondelete="CASCADE"``** matches every other user-owned table (`profiles`,
`connections`, `user_skills`): the registration is part of the account and has no
meaning once the account is gone.

**``is_active`` rather than a delete.** §13.5 requires that an invalidated
provider token be *disabled*, because provider errors are frequently transient and
destroying the row would turn a delivery hiccup into a lost device.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

#: Generated in the project's existing format: 12 hex characters of revision id
#: followed by the slug. Following the chain, so this is Phase 10.
revision: str = "d7e4c1a9f2b8"
down_revision: str | None = "b3f8a1c07d54"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_devices",
        # Every primary key in this schema is an application-generated uuid (§14's
        # conventions) — a sequential id would be enumerable across accounts.
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("push_token", sa.Text(), nullable=False),
        sa.Column("platform", sa.String(length=20), nullable=False),
        sa.Column("device_name", sa.String(length=120), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_devices")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_devices_user_id_users"),
            ondelete="CASCADE",
        ),
        # §14.13's two-value CHECK. Named explicitly so `downgrade` can drop it
        # by name rather than relying on PostgreSQL's generated one.
        sa.CheckConstraint(
            "platform IN ('android', 'ios')",
            name=op.f("ck_user_devices_platform"),
        ),
        # §14.13's idempotency rule — see the module docstring for why it is
        # scoped to the user and not global.
        sa.UniqueConstraint(
            "user_id",
            "push_token",
            name=op.f("uq_user_devices_user_id_push_token"),
        ),
    )
    # The lookup delivery performs. Every push would otherwise scan a user's
    # whole device list.
    op.create_index(
        "ix_user_devices_user_id_is_active",
        "user_devices",
        ["user_id", "is_active"],
        unique=False,
    )


def downgrade() -> None:
    # Removes only the objects this revision created. `user_devices` is a child
    # of `users`, so dropping it cannot affect any other table.
    op.drop_index("ix_user_devices_user_id_is_active", table_name="user_devices")
    op.drop_table("user_devices")
