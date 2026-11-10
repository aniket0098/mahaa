"""Learning models for the Learn service.

Maps to the existing database tables owned by the main backend.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
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
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects import postgresql
from app.db.base import Base, CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import (
    CourseStatus,
    CourseVisibility,
    LectureKind,
    LectureStatus,
    MediaKind,
    pg_enum,
)

SkillLevel = "SkillLevel"

# ---------------------------------------------------------------------------
# User  (maps to ``users``)
# ---------------------------------------------------------------------------

class User(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One account ??? shared with the main backend."""

    __tablename__ = "users"

    __table_args__ = (
        Index("ix_users_role", "role"),
        {"comment": "One Mahaa account. Public-facing identity is public_id."},
    )

    public_id: Mapped[str] = mapped_column(
        String(32), nullable=False, unique=True, index=True
    )
    username: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default=text("'candidate'"),
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default=text("'active'"),
    )
    designation: Mapped[str | None] = mapped_column(String(200), nullable=True)
    avatar_media_id: Mapped[str | None] = mapped_column(
        String(32), nullable=True
    )
    email_verified_at: Mapped[str | None] = mapped_column(
        String, nullable=True
    )
    last_login_at: Mapped[str | None] = mapped_column(String, nullable=True)

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
        back_populates="user", cascade="all, delete-orphan", order_by="ProfileLink.created_at"
    )
    skills: Mapped[list["UserSkill"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    education: Mapped[list["Education"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    experience: Mapped[list["Experience"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    projects: Mapped[list["Project"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    certifications: Mapped[list["Certification"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    achievements: Mapped[list["Achievement"]] = relationship(back_populates="user", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# Course  (maps to ``courses``)
# ---------------------------------------------------------------------------


class Course(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    

    """One course in the Learning Hub catalogue."""
    __tablename__ = "courses"

    creator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_media_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True
    )
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    skill_level: Mapped[str | None] = mapped_column(
        pg_enum(SkillLevel, "skill_level"), nullable=True
    )
    language: Mapped[str | None] = mapped_column(String(50), nullable=True)
    estimated_duration_minutes: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    is_free: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    price: Mapped[float | None] = mapped_column(String, nullable=True)
    price_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    status: Mapped[CourseStatus] = mapped_column(
        pg_enum(CourseStatus, "course_status"),
        nullable=False,
        server_default=CourseStatus.DRAFT,
    )
    visibility: Mapped[CourseVisibility] = mapped_column(
        pg_enum(CourseVisibility, "course_visibility"),
        nullable=False,
        server_default=CourseVisibility.PUBLIC,
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    creator: Mapped["User"] = relationship(foreign_keys=[creator_id], lazy="joined")




# ---------------------------------------------------------------------------
# CourseSection  (maps to ``course_sections``)
# ---------------------------------------------------------------------------


class CourseSection(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One ordered section of a course's curriculum."""

    __tablename__ = "course_sections"

    

    course_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))



# ---------------------------------------------------------------------------
# CourseLecture  (maps to ``course_lectures``)
# ---------------------------------------------------------------------------


class CourseLecture(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One lecture inside a course section."""

    __tablename__ = "course_lectures"

    

    course_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    section_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("course_sections.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(String(50), nullable=False, server_default=text("'hosted_video'"))
    media_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True
    )
    external_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_preview: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'draft'")
    )
    processing_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(80), nullable=True)
    provider_video_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    language: Mapped[str | None] = mapped_column(String(20), nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tags: Mapped[list[str] | None] = mapped_column(postgresql.ARRAY(String(40)), nullable=True)
    thumbnail_media_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True
    )

    course: Mapped["Course"] = relationship(foreign_keys=[course_id])
    section: Mapped["CourseSection"] = relationship(foreign_keys=[section_id])



# ---------------------------------------------------------------------------
# Enrollment  (maps to ``enrollments``)
# ---------------------------------------------------------------------------


class Enrollment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One student's enrolment in one course."""

    __tablename__ = "enrollments"

    

    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'active'")
    )



# ---------------------------------------------------------------------------
# LectureView  (maps to ``lecture_views``)
# ---------------------------------------------------------------------------


class LectureView(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One student's watch anchor on a lecture."""

    __tablename__ = "lecture_views"

    

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    lecture_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("course_lectures.id", ondelete="CASCADE"), nullable=False
    )
    position_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    watched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    lecture: Mapped["CourseLecture"] = relationship(foreign_keys=[lecture_id])



# ---------------------------------------------------------------------------
# LectureLike  (maps to ``lecture_likes``)
# ---------------------------------------------------------------------------


class LectureLike(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One like on one lecture by one user."""

    __tablename__ = "lecture_likes"

    

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    lecture_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("course_lectures.id", ondelete="CASCADE"), nullable=False
    )

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    lecture: Mapped["CourseLecture"] = relationship(foreign_keys=[lecture_id])



# ---------------------------------------------------------------------------
# LectureComment  (maps to ``lecture_comments``)
# ---------------------------------------------------------------------------


class LectureComment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One comment on a lecture, optionally a reply to another comment."""

    __tablename__ = "lecture_comments"

    

    lecture_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("course_lectures.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("lecture_comments.id", ondelete="CASCADE"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    is_removed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    lecture: Mapped["CourseLecture"] = relationship(foreign_keys=[lecture_id])
    parent: Mapped["LectureComment | None"] = relationship(
        foreign_keys=[parent_id], remote_side="LectureComment.id"
    )



# ---------------------------------------------------------------------------
# LectureUpload  (maps to ``lecture_uploads``)
# ---------------------------------------------------------------------------


class LectureUpload(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One resumable lecture-video upload session."""

    __tablename__ = "lecture_uploads"

    

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    lecture_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("course_lectures.id", ondelete="SET NULL"), nullable=True
    )
    original_filename: Mapped[str] = mapped_column(String(300), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    total_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    checksum: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default=text("'pending_upload'")
    )



# ---------------------------------------------------------------------------
# MediaAsset  (maps to ``media_assets``)
# ---------------------------------------------------------------------------


class MediaAsset(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One uploaded file: its metadata, and ??? in V1 ??? its bytes."""

    __tablename__ = "media_assets"

    

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[MediaKind] = mapped_column(
        pg_enum(MediaKind, "media_kind"), nullable=False
    )
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    storage_kind: Mapped[str] = mapped_column(
        String(50), nullable=False, server_default=text("'local'")
    )
    storage_key: Mapped[str] = mapped_column(String(200), nullable=False)
    served_at: Mapped[str] = mapped_column(String(300), nullable=False)
    data: Mapped[bytes | None] = mapped_column(BigInteger, nullable=True)

    owner: Mapped["User"] = relationship(foreign_keys=[owner_id])

# ---------------------------------------------------------------------------
# SavedItem  (maps to ``saved_items``)
# ---------------------------------------------------------------------------


class SavedItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One saved item ??? a course or lecture saved by a user."""

    __tablename__ = "saved_items"

    

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=True
    )
    lecture_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("course_lectures.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            text(
                "(resource_type = 'course' AND course_id IS NOT NULL AND lecture_id IS NULL) OR "
                "(resource_type = 'lecture' AND lecture_id IS NOT NULL AND course_id IS NULL) OR "
                "(resource_type NOT IN ('course', 'lecture'))"
            ),
            name="chk_saveditem_resource_type",
        ),

        UniqueConstraint("user_id", "course_id", name="uq_saveditem_user_course"),
        UniqueConstraint("user_id", "lecture_id", name="uq_saveditem_user_lecture"),
    )



