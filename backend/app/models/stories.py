from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UUIDPrimaryKeyMixin
from app.models.enums import (
    StoryContentType,
    StoryPublisherKind,
    StoryStatus,
    pg_enum,
)


class Story(UUIDPrimaryKeyMixin, Base):
    """One story — §14.10.

    **A story is not peer content.** §10.1: ``publisher.kind ∈ {company,
    platform}``, "this is why the app is described as a *student* feed: stories are
    recruiter/platform-published, not peer content". So ``publisher`` identifies a
    *publisher*, never the reader, and ``author_id`` is who created the row.

    **``publisher`` is a JSONB display snapshot, and it stays one in Phase 9.** §14.10
    specifies ``company_id`` FK → ``companies`` plus
    ``CHECK (publisher_kind = 'company') = (company_id IS NOT NULL)``, and Phase 9 adds
    both — ``company_id`` now exists and the CHECK is enforced. What remains a payload
    is the *presentation*: ``{name, logo_url, verified}`` are copied from the company at
    publication time rather than joined on every read.

    That is deliberate rather than a leftover. §10.1 calls this a "student feed" and
    the client renders a publisher banner from these three fields without re-fetching,
    so a snapshot is both cheaper and *stable*: a company that renames itself does not
    retroactively rewrite the caption under every story it published, and a deleted
    company leaves a readable story rather than a dangling reference. The live link is
    still ``company_id`` — it is what enforces authority and what the CHECK binds to.

    **``opportunity`` is the same arrangement and is now backed by a real FK.**
    §10.1's summary is ``{id, title, location, work_mode}``. Phase 9 adds
    ``opportunity_id`` FK → ``opportunities``; the summary stays a snapshot so the
    card renders identically whether or not the posting is still live.

    **``expires_at`` is a column, not ``created_at + interval '24h'``** — §10.2 says
    so explicitly and gives the reasons: a per-story window becomes adjustable
    without a migration, and an index on ``(expires_at)`` becomes usable. Expiry is
    evaluated **at query time**; no sweeper exists and none is needed, because a
    story nobody can see is indistinguishable from one that was deleted.

    **``status`` and expiry are two different ways to disappear.** ``ARCHIVED`` is
    withdrawn deliberately and keeps its ``story_views`` rows for §10.2's retention
    job to account for; ``expires_at`` is the window closing on its own. Both are
    filtered out of the list, and the detail route 404s on both.
    """

    __tablename__ = "stories"
    __table_args__ = (
        # §14.10's `(expires_at)`. The list query filters `expires_at > now()`, so
        # this is the index that turns "every story, newest first" into "the handful
        # still active".
        Index("ix_stories_expires_at", "expires_at"),
        # §14.10's `(expires_at, created_at DESC)`, plus `id DESC` as the tiebreak
        # for the same reason posts has one: two stories can share a `created_at`,
        # and without a total order page 2 can repeat a row from page 1.
        Index(
            "ix_stories_expires_at_created_at",
            "expires_at",
            text("created_at DESC"),
            text("id DESC"),
        ),
        # §14.10 says `caption NOT NULL`; a blank caption is a story the viewer
        # cannot read, so the database refuses it rather than the service.
        CheckConstraint("btrim(caption) <> ''", name="caption_not_blank"),
        # §14.10: "CHECK (publisher_kind = 'company') = (company_id IS NOT NULL)" — a
        # company story must name its company, and a platform story must not. This is
        # the constraint Phase 8 could not write because `companies` did not exist, and
        # it is the reason Phase 9 adds the column rather than leaving the staged JSONB
        # publisher in place indefinitely.
        CheckConstraint(
            "(publisher_kind = 'company') = (company_id IS NOT NULL)",
            name="company_kind_matches_company",
        ),
    )

    #: Who created the row. CASCADE, matching every other owner column here.
    author_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    #: §14.10's `publisher_kind text NOT NULL` CHECK in (company, platform).
    publisher_kind: Mapped[StoryPublisherKind] = mapped_column(
        pg_enum(StoryPublisherKind, "story_publisher_kind"), nullable=False
    )
    #: The display snapshot — see the class docstring for why JSONB in V1.
    publisher: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    content_type: Mapped[StoryContentType] = mapped_column(
        pg_enum(StoryContentType, "story_content_type"), nullable=False
    )
    caption: Mapped[str] = mapped_column(Text, nullable=False)
    #: §10.1's `{id, title, location, work_mode}` summary, or null.
    opportunity: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    #: §14.10's `company_id` FK companies **SET NULL**, added in Phase 9.
    #:
    #: SET NULL rather than CASCADE because the CHECK pairs it with
    #: `publisher_kind`: a story whose company is deleted must not vanish with it, and
    #: PostgreSQL cannot satisfy the CHECK on a cascaded delete anyway (the row would go
    #: before any SET NULL could run). The service therefore downgrades such a story to
    #: `platform` — see `services/stories.py`.
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), nullable=True
    )
    #: §14.10's `opportunity_id` FK opportunities **SET NULL**, added in Phase 9.
    #:
    #: SET NULL for the same reason, and because an opportunity going away must not
    #: delete an announcement that merely referenced it.
    opportunity_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("opportunities.id", ondelete="SET NULL"), nullable=True
    )
    #: §14.10's `media_id` FK media_assets RESTRICT — the same rule as
    #: `post_media.media_id`: an asset a live story shows must not be deleted out
    #: from under it.
    media_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="RESTRICT"), nullable=True
    )
    status: Mapped[StoryStatus] = mapped_column(
        pg_enum(StoryStatus, "story_status"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
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

    author: Mapped["User"] = relationship(  # noqa: F821
        foreign_keys=[author_id], lazy="joined"
    )
    media: Mapped["MediaAsset | None"] = relationship(  # noqa: F821
        foreign_keys=[media_id], lazy="joined"
    )
    views: Mapped[list["StoryView"]] = relationship(
        back_populates="story", cascade="all, delete-orphan"
    )


views: Mapped[list["StoryView"]] = relationship(
    back_populates="story", cascade="all, delete-orphan"
)


class StoryView(Base):
    """``story_views`` — §14.10's join table.

    **The composite primary key *is* the idempotency guarantee.** §14.10 says the PK
    is ``(story_id, viewer_id)`` and that this is "exactly what makes
    ``POST /stories/{id}/view`` idempotent and the ``already_recorded`` flag
    honest". A second insert cannot even be attempted, so the route's answer is
    backed by the schema rather than by a read-then-write check a race could
    interleave with.

    Like ``post_media``, this deliberately does **not** inherit
    ``UUIDPrimaryKeyMixin``. That mixin would add an ``id`` column and make the key
    ``(id, story_id, viewer_id)`` — three columns for a row whose identity is fully
    described by who viewed what. §14.10 names two.

    Both FKs are CASCADE, per §14.10: a deleted story takes its views with it (and
    §10.2 relies on exactly that for retention), and a deleted account takes its own
    view history with it. No third party's data lives in this row.

    §10.2 is clear that the table has no privacy semantics of its own — "there is no
    per-viewer story ACL in V1, so ``story_views`` is a plain join table" — which is
    why there is nothing here about visibility and nothing to leak.
    """

    __tablename__ = "story_views"

    story_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("stories.id", ondelete="CASCADE"), primary_key=True
    )
    viewer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    viewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    story: Mapped[Story] = relationship(back_populates="views")
    viewer: Mapped["User"] = relationship(lazy="joined")  # noqa: F821
