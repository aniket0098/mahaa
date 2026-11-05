"""Phase 26 — saved items (candidate's saved library).

Additive only: creates the ``saved_items`` table backing ``GET/POST/DELETE /saved``.
No existing object is touched.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "e7a3c5d91b24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saved_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("resource_type", sa.String(length=20), nullable=False),
        sa.Column("resource_id", sa.UUID(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_saved_items_user_id_users", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_saved_items"),
        comment="One saved item per (user, resource_type, resource_id); duplicates are unrepresentable -- idempotent save.",
    )
    op.create_index(
        "ix_saved_items_user_resource",
        "saved_items",
        ["user_id", "resource_type", "resource_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_saved_items_user_resource", table_name="saved_items")
    op.drop_table("saved_items")
