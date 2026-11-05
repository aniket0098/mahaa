"""Phase 14 — calling. The ``calls`` table.

The durable lifecycle record behind voice and video calling. A call is not a
transient signal: it is a row bound to an existing 1:1 ``conversation``, and that
binding is what makes authorization a schema fact. The LiveKit room name is this
table's own primary key — an opaque UUID, never PII — so a participant token can
only be minted for a member of the bound conversation, and a caller cannot name
somebody else's room.

**``caller_id`` and ``callee_id`` are both CASCADE.** A call is meaningless
without either participant, and unlike a message there is no "other side still
reading it" trade: history of a call nobody in it can see is not history worth
keeping. Both point at ``users``; ``conversation_id`` points at ``conversations``
and cascades so deleting a thread takes its calls with it.

**``room_name`` is UNIQUE.** It doubles as the LiveKit room identifier, so two
rows can never claim the same room. It is populated by the service from the call's
own UUID at creation, not supplied by a client.

**The one-live-call-per-conversation guarantee is a partial unique index**, not a
service-layer check. ``uq_calls_one_live_per_conversation`` covers only RINGING
and ACCEPTED rows, so a completed call does not block the next one but two racing
"start" invocations cannot both create a live invitation — the second INSERT
collides with the index instead of producing a duplicate ring.

**``no_self_call``** mirrors ``no_self_connection``: a conversation has two
distinct members, so a call cannot be to yourself.

Reversible: ``downgrade`` drops the table. It has no dependents. Touches no object
any earlier revision created.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str | None = 'b7d2f8c41a93'
down_revision: str | Sequence[str] | None = 'f4c7a2e91b06'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'calls',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('conversation_id', sa.UUID(), nullable=False),
        sa.Column('room_name', sa.String(), nullable=False),
        sa.Column('caller_id', sa.UUID(), nullable=False),
        sa.Column('callee_id', sa.UUID(), nullable=False),
        sa.Column('mode', sa.Enum('audio', 'video', name='call_mode', native_enum=False, create_constraint=True), nullable=False),
        sa.Column('status', sa.Enum('ringing', 'accepted', 'ended', 'rejected', 'cancelled', 'expired', name='call_status', native_enum=False, create_constraint=True), nullable=False),
        sa.Column('answered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ended_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('clock_timestamp()'), nullable=False),
        sa.CheckConstraint('caller_id <> callee_id', name=op.f('ck_calls_no_self_call')),
        sa.ForeignKeyConstraint(['callee_id'], ['users.id'], name=op.f('fk_calls_callee_id_users'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['caller_id'], ['users.id'], name=op.f('fk_calls_caller_id_users'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], name=op.f('fk_calls_conversation_id_conversations'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['ended_by'], ['users.id'], name=op.f('fk_calls_ended_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_calls')),
        comment='One 1:1 call; room name is the primary key (opaque UUID).',
    )
    op.create_index('ix_calls_conversation_id_status', 'calls', ['conversation_id', 'status'], unique=False)
    op.create_index('ix_calls_callee_id_status', 'calls', ['callee_id', 'status'], unique=False)
    op.create_index('uq_calls_room_name', 'calls', ['room_name'], unique=True)
    # Exactly one live (RINGING or ACCEPTED) call per conversation, enforced in
    # the database so two racing starts cannot both create an invitation.
    op.create_index(
        'uq_calls_one_live_per_conversation',
        'calls',
        ['conversation_id'],
        unique=True,
        postgresql_where=sa.text("status IN ('ringing', 'accepted')"),
    )


def downgrade() -> None:
    op.drop_index('uq_calls_one_live_per_conversation', table_name='calls')
    op.drop_index('uq_calls_room_name', table_name='calls')
    op.drop_index('ix_calls_callee_id_status', table_name='calls')
    op.drop_index('ix_calls_conversation_id_status', table_name='calls')
    op.drop_table('calls')