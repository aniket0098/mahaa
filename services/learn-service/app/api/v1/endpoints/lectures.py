"""Lecture endpoints for the Learn service.

Handles lecture listing, lecture details, and course-specific lectures.

No ``fetch`` here — ``apiClient`` is the only transport.

Also handles the media token endpoint:
  ``POST /lecture-media/{media_id}/token`` — issues a short-lived presigned GET URL
  scoped to a single media object for streamed delivery.
"""

from __future__ import annotations

from uuid import UUID

from typing import Annotated

from fastapi import APIRouter, Path, Query, Body, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.errors import ApiError, ErrorCode
from app.services.storage import get_storage_provider
from app.models.enums import LectureStatus
from app.schemas.lectures import LectureOut, LectureListParams

router = APIRouter(prefix="/lectures", tags=["lectures"])

Id = Annotated[
    str,
    Path(description="A lecture id. A malformed id answers 404, not 422."),
]


@router.get("", response_model=list[LectureOut])
def list_lectures(
    db: DbSession,
    principal: CurrentUser,
    params: LectureListParams = Query(),
) -> list[LectureOut]:
    """``GET /lectures`` — list published lectures.

    One list, two source types: a MAHAJOB self-hosted video (``source_type =
    self_hosted``), a YouTube embed (``youtube``), or an external embed
    (``external_embed``). Published lectures only; drafts and
    ``processing_status != ready`` self-hosted videos never surface.
    """
    from app.services.lectures import list_published_lectures

    return list_published_lectures(db, params)


@router.get("/{lecture_id}", response_model=LectureOut)
def get_lecture(
    lecture_id: Id,
    db: DbSession,
    principal: CurrentUser,
) -> LectureOut:
    """``GET /lectures/{id}`` — read one lecture.

    Return the lecture if it is visible to this viewer. Returns 404 if not found.
    """
    from uuid import UUID

    try:
        lid = UUID(lecture_id)
    except (ValueError, TypeError):
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "Lecture not found."}},
        )

    from app.services.lectures import get_lecture

    result = get_lecture(db, lecture_id=str(lid))
    if result is None:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "Lecture not found."}},
        )
    return result


@router.post("/{media_id}/token", status_code=status.HTTP_200_OK)
def stream_token(
    media_id: str,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    """``POST /lecture-media/{media_id}/token`` — issue a short-lived presigned GET URL.

    Validates the authenticated user, verifies lecture and media relationships,
    verifies course access and ownership rules, and generates a short-lived
    S3/R2 presigned GET URL for authenticated media delivery.

    Returns:
        ``{"media_id": "...", "url": "<presigned-url>", "expires_in": 300}`` —
        the presigned URL the client uses for streamed delivery.
    """
    import asyncio

    from app.core.config import get_settings
    from app.models import CourseLecture, MediaAsset
    from app.models.enums import LectureStatus as LS

    # Validate the media asset exists
    media = db.get(MediaAsset, media_id)
    if media is None:
        raise ApiError(
            status_code=404,
            code=ErrorCode.NOT_FOUND,
            message="That media could not be found.",
        )

    # Verify lecture and media relationship:
    # CourseLecture.media_id is a ForeignKey to MediaAsset.id — resolve via that
    # relationship, never by treating media_id as a lecture primary key.
    stmt = select(CourseLecture).where(CourseLecture.media_id == media_id)
    lecture_row = db.execute(stmt).scalar_one_or_none()
    if lecture_row is None:
        raise ApiError(
            status_code=404,
            code=ErrorCode.NOT_FOUND,
            message="That media is not associated with a lecture.",
        )

    # Verify course access and ownership rules:
    # - The caller may stream their own uploads (media owner), OR
    # - Any lecture in a published course with processing_status == "ready"
    if media.owner_id != current_user.id:
        stmt = select(CourseLecture).where(
            CourseLecture.media_id == media_id,
            CourseLecture.status == LS.PUBLISHED,
            CourseLecture.processing_status == "ready",
        )
        lecture_row = db.execute(stmt).scalar_one_or_none()
        if lecture_row is None:
            raise ApiError(
                status_code=404,
                code=ErrorCode.NOT_FOUND,
                message="That media is not available.",
            )

    settings = get_settings()
    ttl = min(settings.video_stream_url_ttl_seconds, 300)

    # Generate a short-lived S3/R2 presigned GET URL using the configured
    # storage provider. Never return permanent credentials or raw object keys.
    storage = get_storage_provider()
    try:
        presigned_url = asyncio.run(
            storage.presigned_get_url(
                bucket=settings.s3_bucket or "",
                key=media.storage_key,
                expires_in=ttl,
            )
        )
    except Exception as exc:
        raise ApiError(
            status_code=500,
            code=ErrorCode.INTERNAL_ERROR,
            message="Media delivery is temporarily unavailable.",
        ) from exc

    return {"media_id": media_id, "url": presigned_url, "expires_in": ttl}