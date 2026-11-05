
"""Wire schemas for /courses — the Learning Hub catalogue reads and writes.

**Snake case throughout, mirroring the client's own types**
(``src/types/course.ts``), the same parity ``opportunities.py`` guarantees.

**``status`` and ``visibility`` are deliberately absent from the output** of the
catalogue reads (``CourseOut``). Both routes only ever serialise rows that are
published *and* public, so the fields would be constants — and a constant on
the wire is an invitation for the client to branch on something that never
varies. The creator workspace uses ``MyCourseOut`` / ``MyCourseDetailOut``,
which add ``status`` and ``visibility``.

The reference ids (``thumbnail_media_id``, ``media_id``) are pointers, not URLs:
the media service's read rules still decide who may fetch the bytes, so no
response can hand out access the ``GET /media/{id}`` route would refuse (see
the ``app.models.learning`` module docstring).

``price`` is ``float | None``, converted once in the service, because the
``NUMERIC(12,2)`` column arrives as ``Decimal`` and would serialise as a
string.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import (
    CourseStatus,
class CourseInstructorOut(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    name: str
    public_id: str


class CourseOut(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    title: str
    slug: str
    description: str | None
    category: str | None
    skill_level: SkillLevel | None
    language: str | None
    estimated_duration_minutes: int | None
    is_free: bool
    price: float | None
    price_currency: str | None
    thumbnail_media_id: uuid.UUID | None
    instructor: CourseInstructorOut
    created_at: datetime
    published_at: datetime | None


class MyCourseOut(CourseOut):
    model_config = ConfigDict(frozen=True)

    status: CourseStatus
    visibility: CourseVisibility


class CourseLectureOut(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    title: str


class CourseCreate(BaseModel):
    model_config = ConfigDict(frozen=True)

    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    category: str | None = Field(default=None, max_length=80)
    skill_level: SkillLevel | None = None
    language: str | None = Field(default=None, max_length=50)
    estimated_duration_minutes: int | None = Field(default=None, ge=0)
    is_free: bool = True
    visibility: CourseVisibility = CourseVisibility.PUBLIC


class CourseUpdate(BaseModel):
    model_config = ConfigDict(frozen=True)

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    category: str | None = Field(default=None, max_length=80)
    skill_level: SkillLevel | None = None
    language: str | None = Field(default=None, max_length=50)
    estimated_duration_minutes: int | None = Field(default=None, ge=0)
    is_free: bool | None = None
    visibility: CourseVisibility | None = None
    thumbnail_media_id: uuid.UUID | None = None


class SectionCreate(BaseModel):
    model_config = ConfigDict(frozen=True)

    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)


class SectionUpdate(BaseModel):
    model_config = ConfigDict(frozen=True)

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)


class LectureCreate(BaseModel):
    model_config = ConfigDict(frozen=True)

    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    kind: LectureKind
    media_id: uuid.UUID | None = None
    external_url: str | None = Field(default=None, max_length=500)
    duration_seconds: int | None = Field(default=None, ge=0)
    is_preview: bool = False
    status: LectureStatus = LectureStatus.DRAFT


class LectureUpdate(BaseModel):
    model_config = ConfigDict(frozen=True)

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    kind: LectureKind | None = None
    media_id: uuid.UUID | None = None
    external_url: str | None = Field(default=None, max_length=500)
    duration_seconds: int | None = Field(default=None, ge=0)
    is_preview: bool | None = None
    status: LectureStatus | None = None


__all__ = [
    "CourseCreate",
    "CourseDetailOut",
    "CourseInstructorOut",
    "CourseLectureOut",
    "CourseOut",
    "CourseSectionOut",
    "CourseStatus",
    "CourseUpdate",
    "CourseVisibility",
    "EnrollmentOut",
    "EnrollmentStateOut",
    "EnrolledCourseOut",
    "EnrollmentStatus",
    "LectureCreate",
    "LectureKind",
    "LectureStatus",
    "LectureUpdate",
    "MyCourseDetailOut",
    "MyCourseOut",
    "SectionCreate",
    "SectionUpdate",
    "SkillLevel",
]
"@

Set-Content -Path 'C:/mahaa/backend/app/schemas/courses.py' -Value $content
    description: str | None
    position: int
    kind: LectureKind
    media_id: uuid.UUID | None
    external_url: str | None
    duration_seconds: int | None
    is_preview: bool
    status: LectureStatus


class CourseSectionOut(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    title: str
    description: str | None
    position: int
    lectures: list[CourseLectureOut]


class CourseDetailOut(CourseOut):
    sections: list[CourseSectionOut]


class MyCourseDetailOut(MyCourseOut):
    model_config = ConfigDict(frozen=True)

    sections: list[CourseSectionOut]


class EnrollmentOut(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    course_id: uuid.UUID
    status: EnrollmentStatus
    created_at: datetime
    updated_at: datetime


class EnrollmentStateOut(BaseModel):
    model_config = ConfigDict(frozen=True)

    enrolled: bool
    enrollment: EnrollmentOut | None


class EnrolledCourseOut(BaseModel):
    model_config = ConfigDict(frozen=True)

    enrollment: EnrollmentOut
    course: CourseOut

    CourseVisibility,
    EnrollmentStatus,
    LectureKind,
    LectureStatus,
    SkillLevel,
)

