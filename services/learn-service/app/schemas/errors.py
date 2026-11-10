"""Error response schemas for the Learn service."""

from __future__ import annotations

from typing import Optional, List, Dict, Any
from uuid import UUID

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    error: str = Field(description="Error code identifier")
    message: str = Field(description="Human-readable error message")
    path: Optional[str] = Field(default=None, description="Request path where error occurred")
    timestamp: str = Field(description="ISO 8601 timestamp")

    class Config:
        from_attributes = True


class ValidationErrorResponse(ErrorResponse):
    errors: Dict[str, List[str]] = Field(
        description="Dictionary of field-level validation errors"
    )


class NotFoundErrorResponse(ErrorResponse):
    detail: str = Field(description="Resource not found detail")

    class Config:
        from_attributes = True


class UnauthorizedErrorResponse(ErrorResponse):
    detail: str = Field(description="Authentication or authorization detail")

    class Config:
        from_attributes = True


class ForbiddenErrorResponse(ErrorResponse):
    detail: str = Field(description="Permission denied detail")

    class Config:
        from_attributes = True


class ConflictErrorResponse(ErrorResponse):
    detail: str = Field(description="Resource conflict detail")

    class Config:
        from_attributes = True


class PaginationMeta(BaseModel):
    total: int
    page: int
    page_size: int
    pages: int


class ApiErrorEnvelope(BaseModel):
    success: bool = Field(default=False)
    error: str
    message: str
    path: Optional[str] = None
    timestamp: str