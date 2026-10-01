"""The skill catalogue and a user's claims on it.

``skills`` is a **catalogue table**, not a per-user list. ``GET /skills/catalog``
searches it directly, and the specification is explicit that the catalogue is
database-backed and never shipped to the client as a constant. That is also why
a skill is a row with its own identity rather than free text on the user.

``user_skills`` is the join. It carries ``Unique (user_id, skill_id)`` so the
same skill cannot be added to one account twice, and it carries ``level``,
``years``, ``source`` and ``verified`` — none of which a plain many-to-many could
hold. ``verified`` defaults to false because the client renders a badge from
that column and nothing else; there is no verification signal yet, so a default
of true would be a false credential claim in production.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import SkillLevel, pg_enum


class Skill(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A catalogue entry, e.g. "Python"."""

    __tablename__ = "skills"
    __table_args__ = (
        # Unique on name backs the unique constraint and its index together.
        Index("ix_skills_category", "category"),
        {"comment": "Global skill catalogue backing GET /skills/catalog."},
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)


class UserSkill(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One user's claim on one catalogue skill."""

    __tablename__ = "user_skills"
    __table_args__ = (
        # The same skill cannot be attached to one account twice. Enforced here
        # rather than in the service layer, where two concurrent adds could both
        # pass a "does it exist?" check.
        UniqueConstraint("user_id", "skill_id", name="uq_user_skills_user_id_skill_id"),
        # The list endpoint is "my skills, newest first" plus a skill lookup.
        Index("ix_user_skills_user_id", "user_id"),
        Index("ix_user_skills_skill_id", "skill_id"),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    skill_id: Mapped[str] = mapped_column(
        # RESTRICT, not CASCADE: a catalogue entry that is still claimed by
        # someone cannot be deleted out from under them.
        ForeignKey("skills.id", ondelete="RESTRICT"),
        nullable=False,
    )
    level: Mapped[SkillLevel] = mapped_column(
        pg_enum(SkillLevel, "skill_level"), nullable=False
    )
    years: Mapped[Decimal | None] = mapped_column(Numeric(4, 1), nullable=True)
    verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    source: Mapped[str] = mapped_column(String(50), nullable=False)

    user: Mapped["User"] = relationship(back_populates="skills")  # noqa: F821
    skill: Mapped["Skill"] = relationship()
