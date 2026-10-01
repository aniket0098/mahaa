"""Phase 8 (stories) — the ``stories`` and ``story_views`` tables of §14.10.

Follows ``8330aac748c3`` (Phase 8 posts). Stories reference ``media_assets``, so this
can only come after Phase 7, and it is a separate revision from posts because the two
fail independently: rolling this back must not touch ``posts``.

**The ``company_id`` / ``opportunity_id`` columns §14.10 specifies are absent, and
that is the staged Phase 8 boundary rather than an oversight.** Both are FKs into the
career domain — ``companies`` and ``opportunities`` — which is Phase 9 and does not
exist here, so a foreign key cannot be declared to an absent table. In their place a
story carries ``publisher`` and ``opportunity`` as JSONB display payloads holding
exactly the fields §10.1's response needs. Phase 9 replaces those two columns with
real FKs and adds back
``CHECK (publisher_kind = 'company') = (company_id IS NOT NULL)``, which is why
``publisher_kind`` is stored and constrained now even though Phase 8 only accepts
``platform``: the column is real, only the write path is restricted.

**``expires_at`` is NOT NULL and stored**, per §10.2's explicit recommendation —
"Explicit column rather than deriving ``created_at + interval '24h'``, because a
per-story window is then adjustable without a migration, and because an index on
``(expires_at)`` is then usable." No server default: the publisher supplies the
window, and a default would let a row exist with an undefined deadline.

**Both §14.10 indexes are created**, and neither is redundant: ``(expires_at)`` serves
the ``expires_at > now()`` filter alone, while ``(expires_at, created_at DESC)`` is
the composite §14.10 names for the feed's ordering. ``id DESC`` is appended to the
second as a total-order tiebreak — two stories published in the same instant would
otherwise be able to swap places between two identical requests, which is the classic
way an offset feed repeats a row on page 2.

**``story_views`` has no surrogate key.** §14.10's primary key is
``(story_id, viewer_id)``, and that pair *is* the idempotency guarantee for
``POST /stories/{id}/view``. An ``id`` would make the key three columns for a row
whose identity is fully described by who viewed what — the same reasoning
``post_media`` follows.

**``media_id`` is RESTRICT and ``story_id`` is CASCADE.** An asset a live story shows
must not be deletable out from under it (§14.11's reference check), while a deleted
story takes its own views with it, which is what §10.2's retention rule relies on.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "5d1c74ab9e02"
down_revision: str | None = "8330aac748c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stories",
        sa.Column("author_id", sa.UUID(), nullable=False),
        # Stored and constrained now even though Phase 8 only writes `platform`:
        # the column is part of the schema, and Phase 9 relaxes the write path
        # rather than the schema.
        sa.Column(
            "publisher_kind",
            sa.Enum(
                "company",
                "platform",
                name="story_publisher_kind",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        # The display snapshot that stands in for `company_id` — see the module
        # docstring. Only `{name, logo_url, verified}` is ever stored here.
        sa.Column("publisher", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        # §10.1's four values, closed.
        sa.Column(
            "content_type",
            sa.Enum(
                "job",
                "internship",
                "announcement",
                "event",
                name="story_content_type",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("caption", sa.Text(), nullable=False),
        # §10.1's `{id, title, location, work_mode}` summary; stands in for
        # `opportunity_id`. Null throughout V1.
        sa.Column(
            "opportunity", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        # §14.10: RESTRICT, exactly as `post_media.media_id` is.
        sa.Column("media_id", sa.UUID(), nullable=True),
        # §10.1's `{published, archived}`.
        sa.Column(
            "status",
            sa.Enum(
                "published",
                "archived",
                name="story_status",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        # NOT NULL, no server default: the publisher owns the window.
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
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
        sa.Column("id", sa.UUID(), nullable=False),
        # §14.10 says `caption NOT NULL`; a blank caption is a story nobody can
        # read, so the database refuses it rather than trusting the service.
        sa.CheckConstraint(
            "btrim(caption) <> ''", name=op.f("ck_stories_caption_not_blank")
        ),
        sa.ForeignKeyConstraint(
            ["author_id"],
            ["users.id"],
            name=op.f("fk_stories_author_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["media_id"],
            ["media_assets.id"],
            name=op.f("fk_stories_media_id_media_assets"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stories")),
    )
    # §14.10's `(expires_at)`: the list query's `expires_at > now()` filter.
    op.create_index("ix_stories_expires_at", "stories", ["expires_at"], unique=False)
    # §14.10's `(expires_at, created_at DESC)`, plus the total-order tiebreak.
    op.create_index(
        "ix_stories_expires_at_created_at",
        "stories",
        [
            "expires_at",
            sa.literal_column("created_at DESC"),
            sa.literal_column("id DESC"),
        ],
        unique=False,
    )
    op.create_table(
        "story_views",
        sa.Column("story_id", sa.UUID(), nullable=False),
        sa.Column("viewer_id", sa.UUID(), nullable=False),
        sa.Column(
            "viewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # No `id` column — §14.10's key is exactly these two, and the composite key
        # is the idempotency guarantee.
        sa.ForeignKeyConstraint(
            ["story_id"],
            ["stories.id"],
            name=op.f("fk_story_views_story_id_stories"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["viewer_id"],
            ["users.id"],
            name=op.f("fk_story_views_viewer_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("story_id", "viewer_id", name=op.f("pk_story_views")),
    )


def downgrade() -> None:
    op.drop_table("story_views")
    op.drop_index("ix_stories_expires_at_created_at", table_name="stories")
    op.drop_index("ix_stories_expires_at", table_name="stories")
    op.drop_table("stories")
