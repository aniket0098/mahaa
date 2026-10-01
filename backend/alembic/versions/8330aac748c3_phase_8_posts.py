"""Phase 8 — posts. The ``posts`` and ``post_media`` tables.

**Two of §14.9's five tables.** ``post_likes``, ``post_bookmarks`` and
``post_comments`` are deliberately absent: §9.1 marks every route that reaches
them **[F]** — "No mobile caller", stage 2, "an honest empty state" — and creating
tables for routes the client does not call would be surface the specification
explicitly declined. Their keys and indexes are fully specified in §14.9 for
whenever that phase is picked up.

**Vocabularies are ``VARCHAR`` + ``CHECK``, not native ``ENUM``** — the project
rule from Phase 1, kept by ``pg_enum``. ``post_kind`` and ``post_category`` are
constrained strings, so adding a value stays a code change rather than an
``ALTER TYPE``.

**``post_media``'s primary key is ``(post_id, position)`` and nothing else.** §14.9
makes ``position`` part of the key ("Ordering is data"), so a duplicate position is
unrepresentable rather than merely discouraged. There is deliberately **no** ``id``
column here: this is the one table in the schema without a surrogate key, because
§14.9 does not describe one, and the same asset may legitimately appear in two
different posts — a row identity of its own would promise something the
specification never did. Contrast ``posts``, which does take the standard
``UUIDPrimaryKeyMixin``.

**``post_media.media_id`` is ``RESTRICT``, ``post_id`` is ``CASCADE``.** §14.9:
deleting an asset a published post uses must be **refused** rather than silently
detaching the image from a live post; but the attachment rows belong to the post,
so they go with it. The RESTRICT is the second line of defence — §14.11 also makes
reference-checking the media delete route's job, and ``services.media.delete``
raises 409 before the database ever sees the delete.

**``ix_posts_created_at_id_live`` is partial.** §9.3's soft delete means most rows
are eventually tombstones; indexing live rows only keeps the feed's scan small and
is the reason the predicate is in the index at all. ``id DESC`` is the tiebreak
that makes offset pagination deterministic.

**Reversible**: ``downgrade`` drops both indexes and both tables, touching nothing
an earlier phase created.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "8330aac748c3"
down_revision: str | None = "c4e8a17b92d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "posts",
        # CASCADE (§14.9): a post belongs to exactly one account.
        sa.Column("author_id", sa.UUID(), nullable=False),
        # Derived server-side on every write (§9.2). Stored so the feed does not
        # re-derive it per row, but never accepted from the request.
        sa.Column(
            "kind",
            sa.Enum(
                "text",
                "image",
                "video",
                "project",
                "achievement",
                "learning",
                name="post_kind",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column(
            "category",
            sa.Enum(
                "projects",
                "achievements",
                "learning",
                "community",
                name="post_category",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=200), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        # Display payloads, not queryable records — §14.9 is explicit that a
        # `post_projects` table would be over-modelling.
        sa.Column("project", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "achievement", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column(
            "tags",
            sa.ARRAY(sa.String(length=64)),
            server_default="{}",
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
        # §9.3's soft delete. Not a `status` column: there is no "deleted" state a
        # user can see, only a row the feed must ignore.
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        # The three *payload* columns only. §9.3's broader "at least one of body,
        # media, project, achievement" cannot be a CHECK: `post_media` rows are
        # inserted after the post, so at insert time there is nothing to test and
        # the constraint would reject every legitimate media-only post. The service
        # holds the real rule; the database holds the part it can hold.
        sa.CheckConstraint(
            "body IS NOT NULL OR project IS NOT NULL OR achievement IS NOT NULL",
            name=op.f("ck_posts_has_a_payload"),
        ),
        sa.ForeignKeyConstraint(
            ["author_id"],
            ["users.id"],
            name=op.f("fk_posts_author_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_posts")),
    )
    # `GET /posts/mine`, and the owner check on PATCH/DELETE.
    op.create_index(
        "ix_posts_author_id_created_at",
        "posts",
        ["author_id", sa.literal_column("created_at DESC")],
        unique=False,
    )
    # The feed's total order, live rows only. See the module docstring.
    op.create_index(
        "ix_posts_created_at_id_live",
        "posts",
        [sa.literal_column("created_at DESC"), sa.literal_column("id DESC")],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_table(
        "post_media",
        sa.Column("post_id", sa.UUID(), nullable=False),
        sa.Column("media_id", sa.UUID(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # RESTRICT, not CASCADE — see the module docstring.
        sa.ForeignKeyConstraint(
            ["media_id"],
            ["media_assets.id"],
            name=op.f("fk_post_media_media_id_media_assets"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["post_id"],
            ["posts.id"],
            name=op.f("fk_post_media_post_id_posts"),
            ondelete="CASCADE",
        ),
        # Exactly these two columns. No `id` — see the module docstring.
        sa.PrimaryKeyConstraint("post_id", "position", name=op.f("pk_post_media")),
        # The same asset twice in one post is meaningless (§14.9).
        sa.UniqueConstraint("post_id", "media_id", name="post_id_media_id"),
    )
    op.create_index(
        "ix_post_media_post_id_position",
        "post_media",
        ["post_id", "position"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_post_media_post_id_position", table_name="post_media")
    op.drop_table("post_media")
    op.drop_index(
        "ix_posts_created_at_id_live",
        table_name="posts",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index("ix_posts_author_id_created_at", table_name="posts")
    op.drop_table("posts")
