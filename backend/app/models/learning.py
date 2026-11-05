"""The Learning Hub domain — ``courses``, ``course_sections``, ``course_lectures``,
``enrollments`` and ``lecture_progress``.

Stage 2 lays the whole domain down at once because the tables are one shape:
a course without sections, sections without lectures, or an enrollment without
a progress table would each need a second migration for no gain. **Only the
catalogue read path exists as an API this stage** (``/courses`` and
``/courses/{id}``); creator publishing, enrollment and progress endpoints
arrive with their planned stages, and nothing here pretends otherwise.

**Free-first, and the schema says so.** ``is_free`` is the designation and
``price``/``price_currency`` are the future-compatible representation of a paid
course — a CHECK makes the two states mutually exclusive so a "paid" course
without a price (or a "free" course carrying one) is unrepresentable, while no
payment, entitlement or purchase logic exists anywhere. Stage 9 adds a real
server-verified payment flow; until then a later enrollment endpoint is only
ever allowed to enrol free courses.

**Ordering is a unique column, not a sort key computed at read time.**
Sections are unique on ``(course_id, position)`` and lectures on
``(section_id, position)``: duplicate positions within a parent are
unrepresentable rather than merely discouraged, in the same spirit as
``post_likes``' composite key. The service orders by ``position``, so a
curriculum cannot shuffle between reads.

**Media references obey the existing media rules; they do not widen them.**
``thumbnail_media_id`` and ``course_lectures.media_id`` are ``SET NULL``
pointers at ``media_assets``. A pointer is *not* a grant: ``GET /media/{id}``
still refuses any reader its existing ownership/reference rules refuse, so a
course row can never be used to launder private bytes. The API therefore
serialises the *reference id* only — emitting a ``served_at`` URL before the
media reference-access rule is (deliberately) extended for courses would hand
the client a URL that 404s. ``external_url`` is unaffected: it is an
``https://`` link to a third party's host and never touches our media
pipeline.

**Deletion behaviour is uniform: a course takes its curriculum with it.**
Sections cascade from the course, lectures from the section; enrollments and
progress cascade from their parents. ``creator_id`` cascades for the same
reason an author takes their posts. Deleting a ``media_assets`` row
SET-NULLs the thumbnail/lecture pointer — the course survives without it.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    UUID,
    func,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import (
    CourseStatus,
    CourseVisibility,
    EnrollmentStatus,
    LectureKind,
    LectureStatus,
    SkillLevel,
    pg_enum,
)


class Course(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One course in the Learning Hub catalogue.

    **``price`` is ``NUMERIC(12,2)``**, the same column type as an
    opportunity's comp figures, and serialises as ``float`` in the service for
    the same reason: a ``Decimal`` reaches the wire as the *string*
    ``"10.00"`` and the client's ``number | null`` would silently become text.

    **``pricing_matches_access`` is one CHECK expressing two facts**: a free
    course carries no price, and a paid course carries a non-negative one. The
    two flags cannot drift apart at the database level, so "paid" can never
    mean "price to be decided" by the time Stage 9 reads it.

    ``category`` is free text capped at 80 characters, mirroring
    ``skills.category``: it is a filter facet, not a closed vocabulary.
    """

    __tablename__ = "courses"
    __table_args__ = (
        CheckConstraint(
            "(is_free AND price IS NULL) OR "
            "(NOT is_free AND price IS NOT NULL AND price >= 0)",
            name="pricing_matches_access",
        ),
        CheckConstraint(
            "estimated_duration_minutes IS NULL OR estimated_duration_minutes >= 0",
            name="duration_non_negative",
        ),
        # Slugs are the stable, human-readable identity a deep link uses.
        Index("uq_courses_slug", "slug", unique=True),
        # "my courses" (the creator workspace, later) filters on the author.
        Index("ix_courses_creator_id", "creator_id"),
        # A list-filter column, on the wire from day one.
        Index("ix_courses_category", "category"),
        # The catalogue query's shape: published+public rows, newest first.
        Index(
            "ix_courses_status_visibility_published_at",
            "status",
            "visibility",
            text("published_at DESC"),
        ),
        {
            "comment": (
                "One Learning Hub course. price is present if and only if the "
                "course is not free (CHECK pricing_matches_access)."
            )
        },
    )

    creator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    #: Lower-case, URL-safe, unique. Written by the service, never by a client.
    slug: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: A **pointer**, not a grant — see the module docstring.
    thumbnail_media_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True
    )
    #: Free text, mirroring ``skills.category``. NULL rather than a made-up
    #: default, so nothing pretends a taxonomy was agreed.
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    #: Reuses the platform's skill vocabulary rather than defining a second one.
    skill_level: Mapped[SkillLevel | None] = mapped_column(
        pg_enum(SkillLevel, "skill_level"), nullable=True
    )
    language: Mapped[str | None] = mapped_column(String(50), nullable=True)
    estimated_duration_minutes: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    is_free: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    #: NUMERIC(12,2) — see the class docstring on Decimal serialisation.
    price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    #: ISO 4217 code, e.g. ``INR``. Nullable only because a free course has no
    #: currency; the pricing CHECK keeps it out of the free state entirely.
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
    #: NULL until published, exactly like an opportunity — the list's ordering
    #: uses it, so it must not be faked at insert time.
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    #: ``lazy="joined"`` because every catalogue read serialises the instructor
    #: snapshot, and an N+1 of 20 per page is the failure mode it prevents.
    creator: Mapped["User"] = relationship(foreign_keys=[creator_id], lazy="joined")  # noqa: F821


class CourseSection(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One curriculum section — the ordered band a course is divided into.

    ``(course_id, position)`` is unique so a course cannot hold two sections
    claiming slot 3; the service always writes the next free position. The
    uniqueness is a database fact rather than a service convention for the
    same reason every other uniqueness rule in this schema is one: two writers
    racing cannot both be told "check first".
    """

    __tablename__ = "course_sections"
    __table_args__ = (
        CheckConstraint("position >= 0", name="position_non_negative"),
        Index(
            "uq_course_sections_course_id_position",
            "course_id",
            "position",
            unique=True,
        ),
        {"comment": "One ordered section of a course's curriculum."},
    )

    course_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    course: Mapped[Course] = relationship(foreign_keys=[course_id])


class CourseLecture(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One lecture inside a section.

    **A lecture carries exactly one source, enforced by CHECKs.**
    ``external_video`` requires an ``https://`` ``external_url``; a URL is
    also allowed for ``reading`` (a linked article is a reading), and
    ``hosted_video`` is media-only. ``media_id`` and ``external_url`` are never
    both set, so a lecture can never offer two sources. The media pointer stays
    optional (nullable) because a hosted video or reading PDF is attached by
    the creator-upload flow, which does not exist until a later stage — a
    CHECK demanding media would make every future draft unrepresentable today.

    **The source columns are serialised for published lectures even though no
    enrolment API exists yet.** All Stage 2 courses are free, there is no
    enrolment gate to honour, and a curriculum whose lecture bodies are all
    hidden cannot be built or tested; when enrolment lands, the detail
    projection gains its gate here, in one place.
    """

    __tablename__ = "course_lectures"
    __table_args__ = (
        CheckConstraint("position >= 0", name="position_non_negative"),
        CheckConstraint(
            "duration_seconds IS NULL OR duration_seconds >= 0",
            name="duration_non_negative",
        ),
        # A link and a media pointer are never both set.
        CheckConstraint(
            "media_id IS NULL OR external_url IS NULL",
            name="not_both_sources",
        ),
        # A link belongs only to the kinds whose source can be a link, and
        # ``external_video`` is exactly the kind that must have one.
        CheckConstraint(
            "external_url IS NULL OR kind IN ('external_video', 'reading')",
            name="url_requires_linkable_kind",
        ),
        CheckConstraint(
            "kind <> 'external_video' OR external_url IS NOT NULL",
            name="external_video_requires_url",
        ),
        # Third-party links are https-only, so a lecture can never become the
        # place a plaintext URL sneaks in.
        CheckConstraint(
            "external_url IS NULL OR external_url LIKE 'https://%'",
            name="external_url_https",
        ),
        Index(
            "uq_course_lectures_section_id_position",
            "section_id",
            "position",
            unique=True,
        ),
        {
            "comment": (
                "One lecture. Exactly one source per lecture: an https:// "
                "external URL or a media_assets pointer, never both."
            )
        },
    )

    section_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("course_sections.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[LectureKind] = mapped_column(
        pg_enum(LectureKind, "lecture_kind"), nullable=False
    )
    #: Pointer, not a grant — see the module docstring. SET NULL so deleting an
    #: asset empties the slot rather than the curriculum.
    media_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True
    )
    external_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    #: NULL means "unknown", never zero — we do not decode durations (§11.4).
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: A preview lecture is the free sample a catalogue card may show before
    #: enrolment; it is a curriculum fact, not a marketing one.
    is_preview: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    status: Mapped[LectureStatus] = mapped_column(
        pg_enum(LectureStatus, "lecture_status"),
        nullable=False,
        server_default=LectureStatus.DRAFT,
    )

    section: Mapped[CourseSection] = relationship(foreign_keys=[section_id])


class Enrollment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One student's enrolment in one course.

    **The surrogate UUID id follows this stage's brief**, unlike ``post_likes``
    (which deliberately has no surrogate): an enrollment is a record with a
    lifecycle — a status that will change, timestamps that are read, and
    future payment rows that will point at it — so it is addressed
    individually. The uniqueness that makes a duplicate enrolment
    unrepresentable lives in ``uq_enrollments_student_id_course_id``, where a
    racing second INSERT collides with the index rather than producing two
    rows an application-level check would have to deduplicate.

    **There is no enrolment API in Stage 2.** The table exists so the later
    free-enrolment endpoint, the progress writes and the future paid flow all
    land against a settled shape; no route writes to it today.
    """

    __tablename__ = "enrollments"
    __table_args__ = (
        Index(
            "uq_enrollments_student_id_course_id",
            "student_id",
            "course_id",
            unique=True,
        ),
        # "which courses is this student in" reads through the unique index
        # above (student leads); this one answers "who is in this course".
        Index("ix_enrollments_course_id", "course_id"),
        {"comment": "One student's enrolment in one course; one row per pair."},
    )

    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[EnrollmentStatus] = mapped_column(
        pg_enum(EnrollmentStatus, "enrollment_status"),
        nullable=False,
        server_default=EnrollmentStatus.ACTIVE,
    )

    student: Mapped["User"] = relationship(foreign_keys=[student_id])  # noqa: F821
    course: Mapped[Course] = relationship(foreign_keys=[course_id])


class LectureProgress(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One student's progress on one lecture.

    **The client never supplies another account's progress.** There is no write
    API yet; when it arrives, the service resolves the student from the
    authenticated caller exactly as every ownership check in this codebase
    does — ``student_id`` is never read from a request body.

    **``position_seconds`` is nullable and non-negative**, so "never opened"
    (NULL) is distinguishable from "at second zero", and a corrupt negative
    playback position is unrepresentable.
    """

    __tablename__ = "lecture_progress"
    __table_args__ = (
        CheckConstraint(
            "position_seconds IS NULL OR position_seconds >= 0",
            name="position_seconds_non_negative",
        ),
        Index(
            "uq_lecture_progress_student_id_lecture_id",
            "student_id",
            "lecture_id",
            unique=True,
        ),
        {
            "comment": (
                "One student's progress row per lecture; duplicates are "
                "unrepresentable."
            )
        },
    )

    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    lecture_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("course_lectures.id", ondelete="CASCADE"), nullable=False
    )
    completed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    #: NULL means "unknown position", never zero.
    position_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    student: Mapped["User"] = relationship(foreign_keys=[student_id])  # noqa: F821
    lecture: Mapped[CourseLecture] = relationship(foreign_keys=[lecture_id])


class SavedItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'saved_items'

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('users.id', ondelete='CASCADE'), nullable=False
    )
    resource_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # 'course' | 'lecture'
    resource_id: Mapped[uuid.UUID] = mapped_column(
        UUID, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            'ix_saved_items_user_resource',
            'user_id',
            'resource_type',
            'resource_id',
            unique=True,
        ),
        {
            'comment': 'One saved item per (user, resource_type, resource_id); duplicates are unrepresentable -- idempotent save.',
        },
    )

    user: Mapped['User'] = relationship(foreign_keys=[user_id])  # noqa: F821
