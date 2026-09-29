"""The v1 API router.

One place that decides what ``/api/v1`` serves. Feature modules are included
here and nowhere else, so the surface can be read in a single file.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.endpoints import health

api_router = APIRouter()
api_router.include_router(health.router)
