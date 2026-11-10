"""Media Pydantic schemas for the Learn service."""

from __future__ import annotations

from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field


class MediaLimits(BaseModel):
    max_upload_size_mb: int = Field(default=100, ge=1)
    max_parts: int = Field(default=5, ge=1)
    max_part_size_mb: int = Field(default=20, ge=1)
    allowed_mime_types: List[str] = Field(
        default=[
            "video/mp4",
            "video/webm",
            "video/quicktime",
            "audio/mpeg",
            "audio/wav",
            "audio/ogg",
            "image/jpeg",
            "image/png",
        ]
    )


class MediaRead(BaseModel):
    id: UUID
    owner_id: UUID
    kind: str
    mime_type: str
    size_bytes: int
    width: Optional[int] = None
    height: Optional[int] = None
    duration_ms: Optional[int] = None
    storage_kind: str
    storage_key: str
    served_at: Optional[str] = None
    data: Optional[bytes] = None

    class Config:
        from_attributes = True


class MediaUploadSessionCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=100)
    total_size_bytes: int = Field(ge=1)
    chunk_size_bytes: Optional[int] = Field(default=None, ge=1)


class MediaUploadSessionOut(BaseModel):
    id: UUID
    upload_id: str
    session_id: str
    expires_at: str
    parts_uploaded: int = 0
    total_parts: int
    status: str


class MediaPartInfo(BaseModel):
    part_number: int
    etag: str
    size_bytes: int


class MediaStreamToken(BaseModel):
    token: str
    expires_at: str
    can_seek: bool = True
    can_pause: bool = True


class MediaDeleteResponse(BaseModel):
    id: UUID
    deleted: bool