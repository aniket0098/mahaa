"""``projects`` and ``project_skills``.

``project_skills`` is a real table rather than a ``text[]`` column because the
mobile contract needs both ends of the relationship: ``ProjectCreate`` accepts
``skill_ids[]`` and ``ProjectRead.skills[]`` returns ``{skill_id, name}[]``. A
``text[]`` could hold an id but not a name, and could not hold a foreign key, so
the catalogue could be renamed out from under a project.

The composite primary key ``(project_id, skill_id)`` is what makes the
association itself unique — a project cannot list the same skill twice.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import Date, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Project(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One project a user has built."""

    __tablename__ = "projects"
    __table_args__ = (Index("ix_projects_user_id", "user_id"),)

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[str | None] = mapped_column(String(120), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    live_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    user: Mapped["User"] = relationship(back_populates="projects")  # noqa: F821
    skills: Mapped[list["ProjectSkill"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )


class ProjectSkill(Base):
    """Join row: which catalogue skills a project used."""

    __tablename__ = "project_skills"
    __table_args__ = (
        # `skill_id` is indexed because the catalogue is queried in reverse
        # ("which projects used Python?"). `project_id` leads the primary key
        # and is already covered by it.
        Index("ix_project_skills_skill_id", "skill_id"),
    )

    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    skill_id: Mapped[str] = mapped_column(
        # RESTRICT for the same reason as user_skills: a claimed catalogue
        # entry is not deletable while anything references it.
        ForeignKey("skills.id", ondelete="RESTRICT"),
        primary_key=True,
    )

    project: Mapped["Project"] = relationship(back_populates="skills")
    skill: Mapped["Skill"] = relationship()
