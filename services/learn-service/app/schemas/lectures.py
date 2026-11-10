"""Lecture Pydantic schemas for the Learn service."""

from __future__ import annotations

from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field


class LectureProgressCreate(BaseModel):
    position_seconds: int = Field(default=0, ge=0)
    completed: bool = False


class LectureProgressOut(BaseModel):
    id: UUID
    user_id: UUID
    lecture_id: UUID
    position_seconds: int
    completed: bool
    watched_at: str

    class Config:
        from_attributes = True


class LectureViewCreate(BaseModel):
    position_seconds: int = Field(default=0, ge=0)


class LectureViewOut(BaseModel):
    id: UUID
    user_id: UUID
    lecture_id: UUID
    position_seconds: int
    completed: bool
    watched_at: str

    class Config:
        from_attributes = True


class LectureLikeCreate(BaseModel):
    pass


class LectureLikeOut(BaseModel):
    id: UUID
    user_id: UUID
    lecture_id: UUID

    class Config:
        from_attributes = True


class LectureCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    parent_id: Optional[UUID] = None


class LectureCommentOut(BaseModel):
    id: UUID
    lecture_id: UUID
    user_id: UUID
    parent_id: Optional[UUID] = None
    body: str
    is_removed: bool
    created_at: str

    class Config:
        from_attributes = True


class LectureCommentThreadOut(BaseModel):
    comment: LectureCommentOut
    replies: List[LectureCommentOut] = []

    class Config:
        from_attributes = True


class LectureEngagementFilters(BaseModel):
    lecture_id: Optional[UUID] = None
    parent_id: Optional[UUID] = None
    only_replies: Optional[bool] = None
    page: int = 1
    page_size: int = 20


class LectureSaveCreate(BaseModel):
    lecture_id: UUID


class LectureSaveOut(BaseModel):
    saved: bool


class LectureListParams(BaseModel):
    q: Optional[str] = None
    course_id: Optional[UUID] = None
    section_id: Optional[UUID] = None
    page: int = 1
    page_size: int = 20

    class Config:
        from_attributes = True


class LectureOut(BaseModel):
    id: UUID
    course_id: UUID
    section_id: UUID
    title: str
    description: Optional[str] = None
    kind: str
    media_id: Optional[UUID] = None
    external_url: Optional[str] = None
    duration_seconds: Optional[int] = None
    is_preview: bool = False
    status: str
    processing_status: Optional[str] = None
    source_type: Optional[str] = None
    language: Optional[str] = None
    difficulty: Optional[str] = None
    tags: Optional[list[str]] = None
    thumbnail_media_id: Optional[UUID] = None
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True