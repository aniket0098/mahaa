"""Lecture engagement endpoints for the Learn service — like/unlike and comments.

Handles likes, unlike, comments, comment editing/deletion, and save/unsave.
"""

from __future__ import annotations

from fastapi import APIRouter, Path, Query, Body, Depends, status

from app.api.deps import CurrentUser, DbSession
from app.models import CourseLecture, LectureLike, LectureComment
from app.models.enums import LectureStatus
from app.schemas.lecture_engagement import (
    LectureLikeOut,
    LectureCommentOut,
    LectureCommentThreadOut,
    ProgressUpdate,
    ProgressRead,
    LectureSaveOut,
    LectureEngagementFilters,
)
from app.services.lecture_engagement import (
    toggle_lecture_like,
    list_lecture_comments,
    create_lecture_comment,
    update_lecture_comment,
    delete_lecture_comment,
    save_lecture,
    unsave_lecture,
    list_saved,
)

router = APIRouter(prefix="/lectures", tags=["lecture engagement"])

# Like / Unlike

@router.post("/{lecture_id}/like", response_model=LectureLikeOut, summary="Like or unlike a lecture")
def like_lecture(
    db: DbSession,
    principal: CurrentUser,
    lecture_id: str = Path(..., description="Lecture ID"),
) -> LectureLikeOut:
    """Toggle like on a lecture. Idempotent — second call removes the like."""
    try:
        result = toggle_lecture_like(db, lecture_id, principal)
        return result
    except Exception:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "Lecture not found."}},
        )


# Comments

@router.get("/{lecture_id}/comments", response_model=LectureCommentThreadOut, summary="List lecture comments (threaded)")
def get_lecture_comments(
    db: DbSession,
    principal: CurrentUser,
    lecture_id: str = Path(..., description="Lecture ID"),
    filters: LectureEngagementFilters = Query(),
) -> LectureCommentThreadOut:
    """Return top-level comments and reply count for a lecture."""
    try:
        result = list_lecture_comments(db, lecture_id, filters, principal)
        return result
    except Exception:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "Lecture not found."}},
        )


@router.post("/{lecture_id}/comments", response_model=LectureCommentOut, summary="Create a comment or reply on a lecture")
def create_comment(
    db: DbSession,
    principal: CurrentUser,
    lecture_id: str = Path(..., description="Lecture ID"),
    body: str = Body(..., min_length=1, max_length=2000),
    parent_id: str | None = Body(default=None, description="Comment ID to reply to"),
) -> LectureCommentOut:
    """Create a top-level comment or reply."""
    try:
        result = create_lecture_comment(db, lecture_id, body, principal, parent_id)
        return result
    except Exception:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "Lecture not found."}},
        )


@router.put("/{lecture_id}/comments/{comment_id}", response_model=LectureCommentOut, summary="Edit own comment (author or staff)")
def edit_comment(
    db: DbSession,
    principal: CurrentUser,
    lecture_id: str = Path(..., description="Lecture ID"),
    comment_id: str = Path(..., description="Comment ID"),
    body: str = Body(..., min_length=1, max_length=2000),
) -> LectureCommentOut:
    """Edit own comment. Staff can edit any comment."""
    try:
        result = update_lecture_comment(db, comment_id, body, principal)
        return result
    except Exception:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "Comment not found."}},
        )


@router.delete("/{lecture_id}/comments/{comment_id}", summary="Delete own comment (author or staff)")
def delete_comment(
    db: DbSession,
    principal: CurrentUser,
    lecture_id: str = Path(..., description="Lecture ID"),
    comment_id: str = Path(..., description="Comment ID"),
) -> dict[str, str]:
    """Soft-delete own comment. Staff can delete any."""
    try:
        result = delete_lecture_comment(db, comment_id, principal)
        return {"status": "ok"}
    except Exception:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "Comment not found."}},
        )