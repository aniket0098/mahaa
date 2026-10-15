"""message_requests

Revision ID: 0a1b2c3d4e5f
Revises:
Create Date: 2026-10-09

The one and only table the message service owns. Additive by design: it
creates nothing else, references only the main backend's existing ``users``
table, and its downgrade drops exactly this table — no foreign keys into other
people's schemas are ever altered here.

**Run order matters.** The foreign keys require ``users`` to exist, so this
migration runs *after* the main backend's ``alembic upgrade head``. Against a
production database it is an operator's step, never a developer's; see
README.md.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0a1b2c3d4e5f"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "message_requests"


def upgrade() -> None:
    """Create ``message_requests`` and its indexes."""
    op.create_table(
        TABLE,
        sa.Column("id", sa.UUID(), primary_key=True, nullable=False),
        # ``created_at`` is application-side default in the ORM but
        # server-side here too, so a row inserted by any tool gets a real
        # timestamp rather than NULL.
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "sender_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "recipient_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "sender_id <> recipient_id",
            # Bare name: the offline DDL below proves the Alembic env's naming
            # convention supplies the `ck_message_requests_` prefix at run
            # time — a literal prefix here is applied twice.
            name="no_self_request",
        ),
        sa.CheckConstraint(
            "(status = 'pending') = (responded_at IS NULL)",
            name="responded_at_matches_pending",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'accepted', 'rejected')",
            name="status_is_known",
        ),
        comment="A request to message; owned by the message service.",
    )
    op.create_index(
        "ix_message_requests_recipient_id_status",
        TABLE,
        ["recipient_id", "status"],
    )
    op.create_index(
        "ix_message_requests_sender_id_recipient_id_status",
        TABLE,
        ["sender_id", "recipient_id", "status"],
    )
    # Partial: only pending rows collide, so a resolved request never blocks a
    # later one, and two simultaneous creates converge on a single row.
    op.create_index(
        "uq_message_requests_pending_pair",
        TABLE,
        ["sender_id", "recipient_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    """Drop the table. Nothing of anybody else's is touched."""

    op.drop_index("uq_message_requests_pending_pair", table_name=TABLE)
    op.drop_index("ix_message_requests_sender_id_recipient_id_status", table_name=TABLE)
    op.drop_index("ix_message_requests_recipient_id_status", table_name=TABLE)
    op.drop_table(TABLE)
