"""``achievements`` — awards, competitions, publications and the like.

``category`` is ``NOT NULL`` because the mobile contract types it as a required
member of a closed six-value union on create (``AchievementCreate.category``),
and the specification calls it required. A missing category would be a record
the client cannot place in any section of the profile timeline.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import Date, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import AchievementCategory, pg_enum


class Achievement(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One achievement."""

    __tablename__ = "achievements"
    __table_args__ = (
        Index("ix_achievements_user_id", "user_id"),
        # The timeline is grouped by category in the client.
        Index("ix_achievements_user_id_category", "user_id", "category"),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    issuer: Mapped[str | None] = mapped_column(String(200), nullable=True)
    category: Mapped[AchievementCategory] = mapped_column(
        pg_enum(AchievementCategory, "achievement_category"),
        nullable=False,
    )
    achieved_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship(back_populates="achievements")  # noqa: F821
