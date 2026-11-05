"""Phase 26b — enforce uniqueness on saved_items (user, resource_type, resource_id)."""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: str | Sequence[str] | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_saved_items_user_resource", table_name="saved_items")
    op.create_index(
        "ix_saved_items_user_resource",
        "saved_items",
        ["user_id", "resource_type", "resource_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_saved_items_user_resource", table_name="saved_items")
    op.create_index(
        "ix_saved_items_user_resource",
        "saved_items",
        ["user_id", "resource_type", "resource_id"],
        unique=False,
    )
