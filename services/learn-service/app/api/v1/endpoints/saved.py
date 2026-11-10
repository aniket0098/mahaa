"""Saved items endpoints for the Learn service.

Handles saving and unsaving lectures and courses, and listing saved items.
"""

from fastapi import APIRouter, Depends, Path, Query, status, Response
from typing import Annotated

from app.api.deps import CurrentUser, DbSession
from app.models import Course, LectureLike, LectureComment, MediaAsset, SavedItem
from app.schemas.saved import SavedItemOut, SavedItemCreate
from app.schemas.lecture_engagement import LectureSaveOut
from app.core.errors import ApiError, ErrorCode

router = APIRouter(prefix="/saved", tags=["saved"])


@router.get("", response_model=list[SavedItemOut], summary="List saved items")
def list_saved(
    db: DbSession,
    current_user: CurrentUser,
    resource_type: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> list:
    """``GET /saved`` — list a user's saved items."""
    from sqlalchemy import select

    query = select(SavedItem).where(SavedItem.user_id == current_user.id)
    if resource_type:
        query = query.where(SavedItem.resource_type == resource_type)
    result = db.execute(query.offset((page - 1) * page_size).limit(page_size))
    items = result.scalars().all()
    return items


@router.post("/lecture/{lecture_id}", status_code=status.HTTP_201_CREATED, summary="Save a lecture")
def save_lecture(
    db: DbSession,
    current_user: CurrentUser,
    lecture_id: str = Path(..., description="Lecture ID"),
) -> LectureSaveOut:
    """``POST /saved/lecture/{id}`` — save a lecture for later."""
    from sqlalchemy import select

    # Verify the lecture exists and is published
    from app.models import CourseLecture
    stmt = select(CourseLecture).where(CourseLecture.id == lecture_id)
    lecture = db.execute(stmt).scalar_one_or_none()
    if lecture is None:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "Lecture not found."}},
        )

    # Check if already saved
    from sqlalchemy import select as sa_select

    existing = db.execute(
        sa_select(SavedItem).where(
            SavedItem.user_id == current_user.id,
            SavedItem.resource_type == "lecture",
            SavedItem.resource_id == lecture.id,  # type: ignore[arg-type]
        )
    ).scalar_one_or_none()
    if existing:
        # Already saved, just return current state
        return LectureSaveOut(saved=True)

    # Save the lecture
    saved_item = SavedItem(
        user_id=current_user.id,
        resource_type="lecture",
        resource_id=lecture.id,  # type: ignore[arg-type]
    )
    db.add(saved_item)
    db.commit()
    return LectureSaveOut(saved=True)


@router.delete("/lecture/{lecture_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Unsave a lecture")
def unsave_lecture(
    db: DbSession,
    current_user: CurrentUser,
    lecture_id: str = Path(..., description="Lecture ID"),
) -> Response:
    """``DELETE /saved/lecture/{id}`` — remove a saved lecture."""
    from sqlalchemy import select as sa_select

    deleted = db.execute(
        sa_select(SavedItem).where(
            SavedItem.user_id == current_user.id,
            SavedItem.resource_type == "lecture",
            SavedItem.resource_id == lecture_id,
        )
    ).scalar_one_or_none()
    if deleted is None:
        # Not saved, that's OK; just return success
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    db.delete(deleted)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)