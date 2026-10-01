"""``posts`` and ``post_media`` — §14.9, the two tables the [M] routes need.

**Only two of §14.9's five tables exist here.** ``post_likes``,
``post_bookmarks`` and ``post_comments`` are deliberately absent: §9.1 marks every
route that reaches them **[F]** — "No mobile caller. `CommentsSheet` shows an
honest empty state" — and creating tables for routes the client does not call
would be inventing surface the specification explicitly deferred. Their keys and
indexes are already fully specified in §14.9 when that phase is picked up.

**``kind`` is derived, never accepted.** §9.2: "kind is **derived server-side**
from which payload is present, never accepted as a free string." The client sends
it, which is the temptation to store it; storing it would let a caller label a
project post as ``achievement`` and change which block the feed renders. The
column records what the server concluded.

**Soft delete, and the index is partial because of it.** §9.3: "**Soft delete**
so a published post's position and its comments survive." §14.9's index is
therefore ``(created_at DESC, id DESC) WHERE deleted_at IS NULL`` — a deleted
post leaves the index entirely, so the feed's window never has to skip over
tombstones. That predicate is the whole reason for the index: an index over live
rows only is dramatically smaller.

**``project`` and ``achievement`` are jsonb, not tables.** §14.9 is explicit:
they are "**display payloads, not queryable records** (they duplicate
`ProfileTimeline` output); the brief lists no `post_projects` table and inventing
one would be over-modelling".

**The CHECK requires a payload, but not media.** §14.9 requires
``body IS NOT NULL OR project IS NOT NULL OR achievement IS NOT NULL`` — three
payload columns, no media. §9.3 asks for something broader ("at least one of
`body`, `media`, `project`, `achievement`") and that broader rule is enforced in
the service, because a CHECK mentioning ``post_media`` cannot exist: the media
rows are inserted after the post, so at insert time there is nothing to test and
the constraint would reject every legitimate post. The database holds the rule it
can hold; the service holds the real one.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UUIDPrimaryKeyMixin
from app.models.enums import PostCategory, PostKind, pg_enum
from app.models.user import User


class Post(UUIDPrimaryKeyMixin, Base):
    """One published post. ``author_id`` is CASCADE (§14.9)."""

    __tablename__ = "posts"
    __table_args__ = (
        # The feed's ordering, live rows only. See the module docstring.
        Index(
            "ix_posts_created_at_id_live",
            text("created_at DESC"),
            text("id DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # `GET /posts/mine`, and the owner check on PATCH/DELETE.
        Index("ix_posts_author_id_created_at", "author_id", text("created_at DESC")),
        CheckConstraint(
            "body IS NOT NULL OR project IS NOT NULL OR achievement IS NOT NULL",
            name="has_a_payload",
        ),
    )

    author_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    #: Derived by the service, never taken from the request (§9.2).
    kind: Mapped[PostKind] = mapped_column(
        pg_enum(PostKind, "post_kind"), nullable=False
    )
    category: Mapped[PostCategory] = mapped_column(
        pg_enum(PostCategory, "post_category"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Display payloads, not records — see the module docstring.
    project: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    achievement: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(String(64)), nullable=False, server_default="{}", default=list
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    #: §9.3's soft delete. Not a `status` column: there is no "deleted" state a
    #: user can see, only a row the feed must ignore.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    author: Mapped[User] = relationship(foreign_keys=[author_id], lazy="joined")
    media: Mapped[list["PostMedia"]] = relationship(
        back_populates="post",
        cascade="all, delete-orphan",
        order_by="PostMedia.position",
        lazy="selectin",
    )


class PostMedia(Base):
    """One attachment.

    §14.9: PK ``(post_id, position)``, unique ``(post_id, media_id)``.

    ``position`` is part of the **primary key**, not an ordinary column, because
    §14.9 says so: "Ordering is data, so `position` is part of the key." That
    makes a duplicate position unrepresentable rather than merely discouraged, so
    two attachments can never claim the same slot in the card.

    **It does not inherit ``UUIDPrimaryKeyMixin``**, unlike every other table here.
    That mixin contributes an ``id`` column and marks it ``primary_key=True``; left
    in place, the table would carry ``PRIMARY KEY (id, post_id, position)`` — three
    key columns, with a UUID nobody sets or reads, and a key that §14.9 does not
    describe. The two declared columns *are* the key, so the mixin is dropped rather
    than worked around. A composite key is also the honest shape: the same asset may
    legitimately appear in two different posts, so an id of its own would suggest a
    row identity the specification never promised.
    """

    __tablename__ = "post_media"
    __table_args__ = (
        UniqueConstraint("post_id", "media_id", name="post_id_media_id"),
        Index("ix_post_media_post_id_position", "post_id", "position"),
    )

    post_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True
    )
    #: RESTRICT, not CASCADE (§14.9). Deleting an asset a published post uses must
    #: be refused — §14.11 makes reference-checking the media route's job — rather
    #: than silently detaching the image from a live post.
    media_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("media_assets.id", ondelete="RESTRICT"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    post: Mapped[Post] = relationship(back_populates="media")
    asset: Mapped["MediaAsset"] = relationship(  # noqa: F821
        foreign_keys=[media_id], lazy="joined"
    )
