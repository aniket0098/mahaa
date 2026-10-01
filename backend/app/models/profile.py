"""The profile aggregate: identity text, privacy flags, job-search preferences,
and external links.

All three one-to-one tables key on ``user_id`` **as the primary key**, so a
second profile for the same account is impossible at the database level rather
than by an application check that races. That is the specification's "1:1, so
`user_id` is both PK and FK".

``profile_preferences`` is deliberately *not* auto-created alongside a profile.
The mobile aggregate types it as ``preferences | null``, meaning "never set" is
a state distinct from "set to nothing" — a nullable row is how that distinction
is represented.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import ProfileVisibility, pg_enum


class Profile(TimestampMixin, Base):
    """Free-text identity for one user. 1:1 with ``users``."""

    __tablename__ = "profiles"
    __table_args__ = (
        # A profile is only ever read through its user, and the unique primary
        # key already covers that lookup, so no extra index is warranted.
        {"comment": "Free-text profile. One row per user, keyed by user_id."},
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    headline: Mapped[str | None] = mapped_column(String(200), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    interests: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, server_default="{}", default=list
    )

    user: Mapped["User"] = relationship(back_populates="profile")  # noqa: F821


class ProfilePrivacy(TimestampMixin, Base):
    """Who may see what. 1:1 with ``users``.

    Every boolean is ``NOT NULL`` with a server default. A nullable privacy flag
    is ``NULL`` in practice on the very first read and every service then has to
    decide what "unknown" means — which is how a private profile leaks.
    """

    __tablename__ = "profile_privacy"
    __table_args__ = ({"comment": "Per-user privacy settings. One row per user."},)

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    profile_visibility: Mapped[ProfileVisibility] = mapped_column(
        pg_enum(ProfileVisibility, "profile_visibility"),
        nullable=False,
        server_default=ProfileVisibility.PRIVATE.value,
    )
    discoverable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    allow_messages: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true", default=True
    )
    show_email: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    show_phone: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )

    user: Mapped["User"] = relationship(back_populates="privacy")  # noqa: F821


class ProfilePreferences(TimestampMixin, Base):
    """Job-search preferences. 1:1 with ``users``; absent means "never set"."""

    __tablename__ = "profile_preferences"
    __table_args__ = (
        CheckConstraint(
            "salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min",
            name="salary_range_ordered",
        ),
        # No index on the array columns. A btree index over a text[] is valid
        # but is not what any planned query uses — the catalogue reads them
        # whole, one user at a time — so adding one would be exactly the
        # speculative index the Phase 1 brief warns against.
        {"comment": "Job-search preferences. Absent row means never set."},
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    work_modes: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, server_default="{}", default=list
    )
    employment_types: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, server_default="{}", default=list
    )
    preferred_locations: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, server_default="{}", default=list
    )
    salary_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    salary_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default="INR", default="INR"
    )
    availability_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    willing_to_relocate: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )

    user: Mapped["User"] = relationship(back_populates="preferences")  # noqa: F821


class ProfileLink(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One external/professional link, e.g. a portfolio or a GitHub profile."""

    __tablename__ = "profile_links"
    __table_args__ = (
        # One link per network per user: the client edits a link rather than
        # listing five GitHub URLs. As a UniqueConstraint (not a bare index) so
        # the rule is visible as a constraint. It also covers the plain
        # "my links" lookup, because user_id leads the key — a separate
        # user_id index would be a redundant second copy of the same btree.
        UniqueConstraint("user_id", "kind", name="uq_profile_links_user_id_kind"),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(50), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str] = mapped_column(String(2000), nullable=False)

    user: Mapped["User"] = relationship(back_populates="links")  # noqa: F821
