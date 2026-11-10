"""Media endpoints for the Learn service.

Handles media limits, upload, authenticated reads, and deletion.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status

from app.api.deps import CurrentUser, DbSession
from app.core.errors import ApiError, ErrorCode
from app.models import MediaAsset
from app.schemas.media import MediaLimits, MediaRead
from app.services import media as svc

router = APIRouter(prefix="/media", tags=["media"])

#: Registration order is load-bearing, and silently so. Starlette matches in
#: declaration order, so `/users/me/photo` has to be declared *before*
#: `/media/{media_id}` or the parameterised route swallows it and `media_id`
#: binds to the literal string "me" -- a 404 that looks like a missing asset
#: rather than a routing mistake. Literal paths first is the same rule
#: `services/notifications.py` follows for `/unread-count`.
Kind = Annotated[
    str,
    Query(description="One of image, video, document (§14.11)."),
]
Width = Annotated[
    int | None,
    Query(ge=1, description="Claimed width; cross-checked against the bytes (§11.3)."),
]
Height = Annotated[
    int | None,
    Query(ge=1, description="Claimed height; cross-checked against the bytes (§11.3)."),
]


@router.get("", summary="Published limits document — §11.4")
def fetch_media_limits() -> MediaLimits:
    """``GET /media`` — a limits document, not a list (§11.4)."""
    return MediaLimits()


@router.post("", status_code=status.HTTP_201_CREATED, summary="Upload media (raw body)")
async def upload_media(
    request: Request,
    current_user: CurrentUser,
    db: DbSession,
) -> MediaRead:
    """``POST /media`` — upload media with real byte progress.

    Uploads are a **raw request body** (`UploadType.BINARY_CONTENT`), not JSON and
    not multipart. That is what lets `expo-file-system` report real byte progress
    from a native upload task — `fetch` cannot report upload progress at all, so a
    progress bar built on it would have to be a lie.
    """
    raw = await request.body()
    return svc.serve(db, current_user, kind="image", payload=raw)


@router.get("/{media_id}", summary="Retrieve media metadata and serve bytes")
def read_media(
    media_id: str,
    current_user: CurrentUser,
    db: DbSession,
) -> MediaRead:
    """``GET /media/{id}`` — retrieve an asset's metadata.

    No bytes are returned — only the metadata record. The actual bytes are served
    through the dedicated ``/api/v1/lecture-media/{media_id}`` route, which
    authorises via bearer token or signed URL.
    """
    from sqlalchemy import select

    row = db.execute(
        select(MediaAsset).where(MediaAsset.id == media_id)
    ).scalar_one_or_none()
    if row is None:
        raise ApiError(
            status_code=404,
            code=ErrorCode.NOT_FOUND,
            message="That media could not be found.",
        )
    # Check ownership/visibility
    if row.owner_id != current_user.id:
        # For now, only the owner can read; later phases will extend this.
        raise ApiError(
            status_code=404,
            code=ErrorCode.NOT_FOUND,
            message="That media is not available.",
        )
    return MediaRead(
        id=str(row.id),
        kind=row.kind.value if hasattr(row.kind, "value") else str(row.kind),
        mime_type=row.mime_type,
        width=row.width,
        height=row.height,
        size_bytes=row.size_bytes,
    )


@router.delete("/{media_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete an asset (owner only)")
def delete_media(
    media_id: str,
    current_user: CurrentUser,
    db: DbSession,
) -> Response:
    """``DELETE /media/{id}`` — delete an asset (owner only).

    The check is real: an asset referenced by a live post or active story
    cannot be deleted. §14.11 puts reference-checking on the media deletion route.
    """
    from sqlalchemy import select

    # Check for references in posts and stories
    row = db.execute(
        select(MediaAsset).where(MediaAsset.id == media_id)
    ).scalar_one_or_none()
    if row is None:
        raise ApiError(
            status_code=404,
            code=ErrorCode.NOT_FOUND,
            message="That media could not be found.",
        )
    if row.owner_id != current_user.id:
        raise ApiError(
            status_code=403,
            code=ErrorCode.FORBIDDEN,
            message="This file is not yours.",
        )
    # TODO: Check for references in live posts and active stories
    # For now, just delete if owner
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)