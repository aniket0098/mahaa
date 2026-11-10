"""Upload Pydantic schemas for the Learn service."""

from __future__ import annotations

from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field


class UploadSessionCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=100)
    total_size_bytes: int = Field(ge=1)


class UploadSessionOut(BaseModel):
    id: UUID
    upload_id: str
    session_id: str
    expires_at: str
    status: str
    parts_uploaded: int = 0


class UploadPartRequest(BaseModel):
    part_number: int = Field(ge=1, le=1000)
    etag: str = Field(min_length=1, max_length=64)
    size_bytes: int = Field(ge=1)


class UploadPartResponse(BaseModel):
    part_number: int
    etag: str
    size_bytes: int


class UploadComplete(BaseModel):
    upload_id: str
    object_key: str
    size_bytes: int


class UploadStatusOut(BaseModel):
    upload_id: str
    status: str
    parts_completed: int
    total_parts: int
    finished_at: Optional[str] = None


class UploadError(BaseModel):
    detail: str
    upload_id: Optional[str] = None