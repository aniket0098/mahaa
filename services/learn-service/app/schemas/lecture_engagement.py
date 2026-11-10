"""Lecture engagement Pydantic schemas for the Learn service."""

from __future__ import annotations

from typing import Optional, List

from uuid import UUID

from pydantic import BaseModel, Field


class ProgressUpdate(BaseModel):
    position_seconds: int = Field(default=0, ge=0)
    completed: bool = False


class ProgressRead(BaseModel):
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

    class Config:
        from_attributes = True


class LectureSaveCreate(BaseModel):
    lecture_id: UUID


class LectureSaveOut(BaseModel):
    saved: bool

    class Config:
        from_attributes = True