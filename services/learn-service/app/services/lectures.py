"""Lecture service layer for the Learn microservice.

Read-only published-lecture queries backed by the shared database tables.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.models import CourseLecture
from app.schemas.lectures import LectureOut, LectureListParams


def _lecture_out(row: CourseLecture) -> LectureOut:
    return LectureOut(
        id=row.id,
        course_id=row.course_id,
        section_id=row.section_id,
        title=row.title,
        description=row.description,
        kind=row.kind,
        media_id=row.media_id,
        external_url=row.external_url,
        duration_seconds=row.duration_seconds,
        is_preview=row.is_preview,
        status=row.status,
        processing_status=row.processing_status,
        source_type=row.source_type,
        language=row.language,
        difficulty=row.difficulty,
        tags=row.tags,
        thumbnail_media_id=row.thumbnail_media_id,
        created_at=row.created_at.isoformat() if row.created_at else "",
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


def list_published_lectures(db, params: LectureListParams) -> list[LectureOut]:
    """``GET /lectures`` — published lectures, optionally filtered and paged."""
    stmt = select(CourseLecture).where(CourseLecture.status == "published")
    if params.course_id:
        stmt = stmt.where(CourseLecture.course_id == params.course_id)
    if params.section_id:
        stmt = stmt.where(CourseLecture.section_id == params.section_id)
    rows = db.execute(
        stmt.offset((params.page - 1) * params.page_size).limit(params.page_size)
    ).scalars().all()
    return [_lecture_out(row) for row in rows]


def get_lecture(db, lecture_id: str) -> LectureOut | None:
    """``GET /lectures/{id}`` — one lecture by id, or None when not found."""
    try:
        lid = uuid.UUID(lecture_id)
    except (ValueError, TypeError):
        return None
    row = db.get(CourseLecture, lid)
    if row is None:
        return None
    return _lecture_out(row)
