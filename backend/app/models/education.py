"""``education`` — one entry on a user's education timeline.

Two CHECK constraints carry real meaning here:

* an end date cannot precede a start date;
* ``current = true`` requires an open end (``end_date IS NULL``), because a
  "currently studying" row with a past end date is always a data-entry mistake
  and it silently breaks any duration the client computes.

``level`` is nullable on purpose: the mobile contract types it
``EducationLevel | null``, so a user who does not know the level of a school
qualification is a valid state.
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
from app.models.enums import EducationLevel, pg_enum


class Education(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One education record."""

    __tablename__ = "education"
    __table_args__ = (
        CheckConstraint(
            "end_date IS NULL OR start_date IS NULL OR end_date >= start_date",
            name="education_dates_ordered",
        ),
        CheckConstraint(
            "NOT current OR end_date IS NULL",
            name="education_current_is_open",
        ),
        # The list endpoint is "my education, most recent first".
        Index("ix_education_user_id_start_date", "user_id", "start_date"),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    institution: Mapped[str] = mapped_column(String(200), nullable=False)
    degree: Mapped[str | None] = mapped_column(String(200), nullable=True)
    field_of_study: Mapped[str | None] = mapped_column(String(200), nullable=True)
    level: Mapped[EducationLevel | None] = mapped_column(
        pg_enum(EducationLevel, "education_level"), nullable=True
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    current: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    grade: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship(back_populates="education")  # noqa: F821
