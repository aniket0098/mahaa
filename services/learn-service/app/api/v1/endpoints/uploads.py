"""Lecture video upload endpoints for the Learn service.

Handles resumable, chunked lecture-video uploads via PUT/POST chunks and
POST completion. Enforces the 1 GB ceiling at every layer.
"""

from __future__ import annotations

from typing import Any, Annotated

from fastapi import APIRouter, Path, Request, status

from app.api.deps import CurrentUser, DbSession, require_roles
from app.core.errors import ApiError, ErrorCode
from app.models import LectureUpload
from app.models.enums import UserRole
from app.schemas.upload import (
    UploadSessionCreate,
    UploadSessionOut,
    UploadComplete,
    UploadStatusOut,
)
from app.services import upload as svc

router = APIRouter(prefix="/lecture-uploads", tags=["lecture uploads"])

UploadId = Annotated[
    str,
    Path(description="An upload session id. A malformed id answers 404."),
]
PartNumber = Annotated[
    int,
    Path(ge=1, description="One-based chunk number."),
]
Uploader = Annotated[
    Any,
    #: Staff roles may upload lectures; candidates may not.
    require_roles(UserRole.ADMIN, UserRole.COLLEGE),
]


@router.post("", response_model=UploadSessionOut, status_code=status.HTTP_201_CREATED, summary="Start a resumable lecture-video upload session")
async def create_upload_session(
    data: UploadSessionCreate,
    current_user: Uploader,
    db: DbSession,
) -> UploadSessionOut:
    """``POST /lecture-uploads`` — reserve an upload session.

    Rejects a file over 1 GB or a non-video MIME type before any bytes are sent.
    Returns the session id, the chunk size the client should use, and the
    session's expiry.
    """
    result = svc.create_session(
        db,
        current_user,
        original_filename=data.original_filename,
        mime_type=data.mime_type,
        total_size=data.total_size,
    )
    return UploadSessionOut(**result)


@router.put("/{upload_id}/parts/{part_number}", status_code=status.HTTP_200_OK, summary="Upload one chunk of a lecture video")
async def upload_part(
    upload_id: UploadId,
    part_number: PartNumber,
    request: Request,
    current_user: Uploader,
    db: DbSession,
) -> None:
    """``PUT /lecture-uploads/{id}/parts/{n}`` — stream one chunk.

    The body is read in bounded chunks and written to storage; an oversized
    chunk is rejected without being buffered whole.
    """
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > svc.MAX_VIDEO_BYTES:
            raise ApiError(
                status_code=413,
                code=ErrorCode.UNPROCESSABLE,
                message="That chunk is too large.",
            )
    svc.write_part(db, current_user, upload_id, part_number, body)


@router.post("/{upload_id}/complete", status_code=status.HTTP_201_CREATED, summary="Finish an upload and create the lecture record")
def complete_upload(
    upload_id: UploadId,
    data: UploadComplete,
    current_user: Uploader,
    db: DbSession,
) -> dict:
    """``POST /lecture-uploads/{id}/complete`` — assemble and verify.

    Creates the lecture as a draft with ``processing_status = processing`` and
    starts background processing. Returns the lecture id once the object is
    assembled and verified.
    """
    return svc.complete_upload(
        db,
        current_user,
        upload_id,
        section_id=data.section_id,
        title=data.title,
        description=data.description,
        position=data.position,
        language=data.language,
        difficulty=data.difficulty,
        tags=data.tags,
        is_preview=data.is_preview,
        total_checksum=data.total_checksum,
    )


@router.get("/{upload_id}", response_model=UploadStatusOut, summary="Get an upload session's status")
def get_upload_status(
    upload_id: UploadId,
    current_user: Uploader,
    db: DbSession,
) -> UploadStatusOut:
    """``GET /lecture-uploads/{id}`` — poll for upload progress/completion."""
    return svc.get_status(db, current_user, upload_id)


@router.delete("/{upload_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Cancel an upload and drop its staged parts")
def cancel_upload(
    upload_id: UploadId,
    current_user: Uploader,
    db: DbSession,
) -> None:
    """``DELETE /lecture-uploads/{id}`` — abandon an in-progress upload."""
    svc.cancel_upload(db, current_user, upload_id)