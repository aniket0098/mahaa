"""``users`` — the account row every other record hangs off.

Identity fields are deliberately split across three columns because the mobile
client treats them differently:

* ``id`` is the internal key. It is what a foreign key points at and what a
  connection request is sent by. It is never shown to a person.
* ``public_id`` is the permanent, immutable, human-shareable handle
  (``MJ-XXXXXXXX``). The client only displays and copies it.
* ``username`` is the searchable handle, changeable under a password
  confirmation and a cooldown.

``email`` is ``citext`` so uniqueness is case-insensitive **in the database**.
That matters more than it looks: ``Alice@example.com`` and
``alice@example.com`` are one account, and a uniqueness check done in the
application is only correct for the casing it happened to see.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import UserRole, UserStatus, pg_enum


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One account."""

    __tablename__ = "users"
    __table_args__ = (
        # `role` is filtered on by every role-scoped query, so it earns an
        # index. The three unique columns index themselves.
        Index("ix_users_role", "role"),
        {"comment": "One Mahaa account. Public-facing identity is public_id."},
    )

    public_id: Mapped[str] = mapped_column(
        String(32), nullable=False, unique=True, index=True
    )
    username: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    email: Mapped[str] = mapped_column(CITEXT, nullable=False, unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)

    #: Argon2id hash. The plaintext never reaches this column, and no schema
    #: layer may return it. Named to make that impossible to miss in a query.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        pg_enum(UserRole, "user_role"),
        nullable=False,
        server_default=UserRole.CANDIDATE.value,
    )
    status: Mapped[UserStatus] = mapped_column(
        pg_enum(UserStatus, "user_status"),
        nullable=False,
        server_default=UserStatus.ACTIVE.value,
    )
    designation: Mapped[str | None] = mapped_column(String(200), nullable=True)

    #: Points at ``media_assets.id``. **The foreign key is added by the media
    #: migration**, which Phase 1 deferred for the reason its own comment gives:
    #: "a constraint may not reference a table that does not exist yet". That
    #: table now exists, so the constraint is added here to match §14.1's
    #: "``avatar_media_id`` uuid NULL FK media_assets" — it is not optional
    #: polish, it is the integrity rule that stops an account pointing at an
    #: asset that does not exist or at somebody else's.
    #:
    #: ``SET NULL`` rather than CASCADE on the *asset* side, deliberately: a
    #: deleted avatar must clear the pointer, not delete the account. Deleting
    #: the *account* still cascades to its media via ``media_assets.owner_id``.
    avatar_media_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("media_assets.id", ondelete="SET NULL"),
        nullable=True,
    )

    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # --- relationships -------------------------------------------------
    # `delete-orphan` on the one-to-one rows and the owned sections: these have
    # no meaning without their user, which is exactly the specification's
    # "CASCADE only for true children". Deleting a *user* is never cascaded
    # from here — that is an explicit, confirmed action in a later phase.
    profile: Mapped["Profile | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )
    privacy: Mapped["ProfilePrivacy | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )
    preferences: Mapped["ProfilePreferences | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )
    links: Mapped[list["ProfileLink"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="ProfileLink.created_at",
    )
    skills: Mapped[list["UserSkill"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    education: Mapped[list["Education"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    experience: Mapped[list["Experience"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    projects: Mapped[list["Project"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    certifications: Mapped[list["Certification"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    achievements: Mapped[list["Achievement"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
