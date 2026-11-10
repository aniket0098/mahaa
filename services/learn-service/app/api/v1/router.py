"""The v1 API router.

One place that decides what ``/api/v1`` serves. Feature modules are included
here and nowhere else, so the surface can be read in a single file.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.endpoints import health, courses, lectures, lecture_engagement, media, saved, uploads


api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(courses.router)
api_router.include_router(lectures.router)
api_router.include_router(lecture_engagement.router)
api_router.include_router(media.router)
api_router.include_router(saved.router)
api_router.include_router(uploads.router)