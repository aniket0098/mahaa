"""Saved items Pydantic schemas for the Learn service."""

from __future__ import annotations

from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field


class SavedItemOut(BaseModel):
    id: UUID
    user_id: UUID
    resource_type: str
    resource_id: UUID
    saved_at: str

    class Config:
        from_attributes = True


class SavedItemCreate(BaseModel):
    resource_type: str = Field(min_length=1, max_length=50)
    resource_id: UUID


class SavedItemList(BaseModel):
    items: List[SavedItemOut]
    total: int
    page: int
    page_size: int