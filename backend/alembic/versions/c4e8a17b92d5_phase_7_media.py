"""Phase 7 — media. The `media_assets` table, and one foreign key Phase 1 deferred.

**One new table, and one constraint on an existing one.** §14.11 describes
`media_assets` exactly as it is created here. The only other change is the
`users.avatar_media_id` foreign key, which Phase 1 declared as a bare uuid and
promised this migration would add — its own comment says "The FK is added by the
media migration, which is the only place that can add it safely," and §14.1 asks
for it as "avatar_media_id uuid NULL FK media_assets". Adding it here is
following that instruction, not extending scope: without it an account could
point at an asset that does not exist, or at another account's.

**`ondelete="SET NULL"` on the avatar.** Deleting an avatar must clear the
pointer, never the account. The account-deletion direction still cascades, through
`media_assets.owner_id` — an upload is owned by exactly one account (§14.11), so
its bytes go with it.

**`served_at` is `NOT NULL` and holds a path.** §14.11: "served_at is the
relative path the client joins onto the base URL." It is written at insert, never
updated, and its name is a genuine trap for anyone who assumes otherwise.

**`data` is `BYTEA`, and it lives here.** §14.11's column list does not name it,
but `storage_kind` defaults to `'database'` (§14.11), §11.1 calls binary storage
"a separate concern" rather than "a separate table", and
`docs/feed-api-contract.md` has a heading "Why bytes live in the database". So the
bytes are a column on this table, and `storage_kind` is the switch that makes
moving them a row update instead of a schema redesign — the whole reason the
column is reserved.

**Reversible**: `downgrade` drops the FK, the index and the table, and touches
nothing an earlier phase created.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c4e8a17b92d5"
down_revision: str | None = "b91d47e0c6a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "media_assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        # CASCADE (§14.11): an upload belongs to exactly one account.
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "image",
                "video",
                "document",
                name="media_kind",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        # bigint, not integer: §14.11 says bigint. The ceiling is configuration,
        # not a schema promise.
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        # Always NULL in V1. §11.4 publishes `video_duration_enforced: false`
        # because there is no decoder, and §11.5 forbids trusting a
        # client-declared duration.
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        # Reserved so storage becomes "a configuration change and a row" (§11.1).
        # A plain string, not an enum, so adding `s3` needs no migration.
        sa.Column(
            "storage_kind",
            sa.String(length=50),
            nullable=False,
            server_default="database",
        ),
        # Locator within `storage_kind`. No FK: it names a row in this table today
        # and an object key later.
        sa.Column("storage_key", sa.String(length=200), nullable=False),
        # A URL PATH, not a timestamp (§14.11).
        sa.Column("served_at", sa.String(length=300), nullable=False),
        # The bytes. See the module docstring for why they live here.
        sa.Column("data", postgresql.BYTEA(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # §14.11's "CHECK ≥ 0", at the database level so a writer that forgets the
        # application check still cannot store a negative size.
        sa.CheckConstraint(
            "size_bytes >= 0",
            name=op.f("ck_media_assets_size_bytes_non_negative"),
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name=op.f("fk_media_assets_owner_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_media_assets")),
        comment=(
            "One uploaded file. served_at is a URL path the client joins onto the "
            "base URL, not a timestamp (§14.11)."
        ),
    )

    # §14.11's index. Owner-first because every read in this phase is "an asset of
    # this owner": the owner's own list, and the lookup that precedes an
    # authorization decision.
    op.create_index(
        "ix_media_assets_owner_id_created_at",
        "media_assets",
        ["owner_id", sa.text("created_at DESC")],
        unique=False,
    )

    # §14.1's `avatar_media_id` FK, deferred from Phase 1 because the table did
    # not exist. SET NULL so removing an avatar clears the pointer rather than
    # deleting the account.
    op.create_foreign_key(
        "fk_users_avatar_media_id_media_assets",
        "users",
        "media_assets",
        ["avatar_media_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_users_avatar_media_id_media_assets",
        "users",
        type_="foreignkey",
    )
    op.drop_index("ix_media_assets_owner_id_created_at", table_name="media_assets")
    op.drop_table("media_assets")
