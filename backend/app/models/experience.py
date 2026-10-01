"""``experience`` — one entry on a user's work timeline.

Same two date CHECKs as ``education``, for the same reason: a reversed range or
a "current" role with a closed end date is always an entry mistake, and both
break any duration the client shows.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import WorkMode, pg_enum


class Experience(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One work record."""

    __tablename__ = "experience"
    __table_args__ = (
        CheckConstraint(
            "end_date IS NULL OR start_date IS NULL OR end_date >= start_date",
            name="experience_dates_ordered",
        ),
        CheckConstraint(
            "NOT current OR end_date IS NULL",
            name="experience_current_is_open",
        ),
        Index("ix_experience_user_id_start_date", "user_id", "start_date"),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    company_name: Mapped[str] = mapped_column(String(200), nullable=False)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    work_mode: Mapped[WorkMode | None] = mapped_column(
        pg_enum(WorkMode, "experience_work_mode"), nullable=True
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    current: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship(back_populates="experience")  # noqa: F821
