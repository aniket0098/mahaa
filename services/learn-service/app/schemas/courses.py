"""Course Pydantic schemas for the Learn service."""

from __future__ import annotations

from typing import Generic, List, Optional, TypeVar

from uuid import UUID

from pydantic import BaseModel, Field

T = TypeVar("T")


class CourseOut(BaseModel):
    id: UUID
    title: str
    slug: str
    description: Optional[str] = None
    category: Optional[str] = None
    skill_level: Optional[str] = None
    language: Optional[str] = None
    estimated_duration_minutes: Optional[int] = None
    is_free: bool
    price: Optional[float] = None
    price_currency: Optional[str] = None
    thumbnail_media_id: Optional[UUID] = None
    instructor: Optional[dict] = None
    created_at: Optional[str] = None
    published_at: Optional[str] = None

    class Config:
        from_attributes = True
class CourseDetailOut(CourseOut):
    sections: List["CourseSectionOut"] = []
    lectures: List["CourseLectureOut"] = []

    class Config:
        from_attributes = True


class CourseSectionOut(BaseModel):
    id: UUID
    title: str
    description: Optional[str] = None
    position: int = 0

    class Config:
        from_attributes = True


class CourseLectureOut(BaseModel):
    id: UUID
    title: str
    section_id: Optional[UUID] = None
    position: Optional[int] = None
    estimated_duration_minutes: Optional[int] = None
    source_type: Optional[str] = None
    processing_status: Optional[str] = None

    class Config:
        from_attributes = True


class CourseOutCollection(BaseModel):
    items: List[CourseOut]
    total: int
    page: int
    page_size: int

    class Config:
        from_attributes = True


class CourseSearchFilters(BaseModel):
    q: Optional[str] = Field(default=None, description="Search title and description")
    category: Optional[str] = Field(default=None, description="Exact category match")
    skill_level: Optional[str] = Field(
        default=None,
        description="beginner | intermediate | advanced | expert",
    )
    pricing: Optional[str] = Field(
        default=None,
        description="Free or paid catalogue",
    )
    page: int = Field(default=1, ge=1, le=10_000, description="1-based page")
    page_size: int = Field(
        default=20, ge=1, le=100, description="Rows to return"
    )

    class Config:
        from_attributes = True


class CourseCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=220)
    description: Optional[str] = Field(default=None)
    category: Optional[str] = Field(default=None)
    skill_level: Optional[str] = Field(
        default=None,
        description="beginner | intermediate | advanced | expert",
    )
    language: Optional[str] = Field(default=None, max_length=50)
    estimated_duration_minutes: Optional[int] = Field(default=None, ge=0)
    is_free: bool = Field(default=True)
    price: Optional[float] = Field(default=None, ge=0)
    price_currency: Optional[str] = Field(default=None, max_length=3)
    thumbnail_media_id: Optional[UUID] = Field(default=None)
    visibility: Optional[str] = Field(
        default="public",
        description="public | unlisted",
    )
    status: Optional[str] = Field(
        default="draft",
        description="draft | published",
    )

    class Config:
        from_attributes = True


class CourseUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None)
    category: Optional[str] = Field(default=None)
    skill_level: Optional[str] = Field(
        default=None,
        description="beginner | intermediate | advanced | expert",
    )
    language: Optional[str] = Field(default=None, max_length=50)
    estimated_duration_minutes: Optional[int] = Field(default=None, ge=0)
    is_free: Optional[bool] = Field(default=None)
    price: Optional[float] = Field(default=None, ge=0)
    price_currency: Optional[str] = Field(default=None, max_length=3)
    thumbnail_media_id: Optional[UUID] = Field(default=None)
    visibility: Optional[str] = Field(default=None)
    status: Optional[str] = Field(default=None)

    class Config:
        from_attributes = True
class SectionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None)
    position: int = Field(default=0, ge=0)

    class Config:
        from_attributes = True


class SectionUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None)
    position: Optional[int] = Field(default=None, ge=0)

    class Config:
        from_attributes = True


class LectureCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None)
    section_id: UUID
    position: int = Field(default=0, ge=0)
    source_type: str = Field(
        description="hosted_video | external_video | reading",
        default="hosted_video",
    )
    kind: str = Field(
        description="hosted_video | external_video | reading",
        default="hosted_video",
    )
    external_url: Optional[str] = Field(default=None, max_length=500)
    duration_seconds: Optional[int] = Field(default=None, ge=0)
    is_preview: bool = Field(default=False)
    status: str = Field(default="draft", description="draft | published")
    processing_status: Optional[str] = Field(default=None, max_length=40)
    language: Optional[str] = Field(default=None, max_length=20)
    difficulty: Optional[str] = Field(default=None, max_length=20)
    tags: Optional[List[str]] = Field(default=None)
    thumbnail_media_id: Optional[UUID] = Field(default=None)

    class Config:
        from_attributes = True


class LectureUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None)
    section_id: Optional[UUID] = Field(default=None)
    position: Optional[int] = Field(default=None, ge=0)
    source_type: Optional[str] = Field(default=None)
    kind: Optional[str] = Field(default=None)
    external_url: Optional[str] = Field(default=None, max_length=500)
    duration_seconds: Optional[int] = Field(default=None, ge=0)
    is_preview: Optional[bool] = Field(default=None)
    status: Optional[str] = Field(default=None)
    processing_status: Optional[str] = Field(default=None, max_length=40)
    language: Optional[str] = Field(default=None, max_length=20)
    difficulty: Optional[str] = Field(default=None, max_length=20)
    tags: Optional[List[str]] = Field(default=None)
    thumbnail_media_id: Optional[UUID] = Field(default=None)

    class Config:
        from_attributes = True


class FastApiPage(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int

    class Config:
        from_attributes = True


class FastApiCoursePaginated(BaseModel):
    items: List[CourseOut]
    total: int
    page: int
    page_size: int

    class Config:
        from_attributes = True


class EnrolledCourseOut(BaseModel):
    id: UUID
    title: str
    slug: str
    description: Optional[str] = None
    category: Optional[str] = None
    skill_level: Optional[str] = None
    language: Optional[str] = None
    estimated_duration_minutes: Optional[int] = None
    is_free: bool
    price: Optional[float] = None
    price_currency: Optional[str] = None
    thumbnail_media_id: Optional[UUID] = None
    instructor_name: Optional[str] = None
    created_at: Optional[str] = None
    published_at: Optional[str] = None

    class Config:
        from_attributes = True


class CourseEnrollmentStateOut(BaseModel):
    enrollment_status: str = "active"
    progress_percentage: float = 0.0
    last_accessed: Optional[str] = None

    class Config:
        from_attributes = True


class MyCourseOut(BaseModel):
    id: UUID
    title: str
    slug: str
    description: Optional[str] = None
    category: Optional[str] = None
    skill_level: Optional[str] = None
    language: Optional[str] = None
    estimated_duration_minutes: Optional[int] = None
    is_free: bool
    price: Optional[float] = None
    price_currency: Optional[str] = None
    thumbnail_media_id: Optional[UUID] = None
    instructor_name: Optional[str] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class MyCourseDetailOut(MyCourseOut):
    sections: List[CourseSectionOut] = []
    lectures: List[CourseLectureOut] = []

    class Config:
        from_attributes = True