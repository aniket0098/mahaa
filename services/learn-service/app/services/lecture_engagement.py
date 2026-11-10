"""Lecture engagement service layer for the Learn microservice.

Like/unlike, comments, and save/unsave operations enforced against the
authenticated principal (ownership checks are row-level on ``user_id``).
"""

from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import select

from app.core.errors import ApiError, ErrorCode
from app.models import CourseLecture, LectureComment, LectureLike, SavedItem
from app.schemas.lecture_engagement import (
    LectureCommentOut,
    LectureCommentThreadOut,
    LectureLikeOut,
    LectureSaveOut,
)


def _parse_uid(value: str) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(value)
    except (ValueError, TypeError):
        return None


def _lecture_exists(db, lecture_id: uuid.UUID) -> bool:
    return db.get(CourseLecture, lecture_id) is not None


def _comment_out(row: LectureComment) -> LectureCommentOut:
    return LectureCommentOut(
        id=row.id,
        lecture_id=row.lecture_id,
        user_id=row.user_id,
        parent_id=row.parent_id,
        body=row.body,
        is_removed=row.is_removed,
        created_at=row.created_at.isoformat() if row.created_at else "",
    )


def toggle_lecture_like(db, lecture_id: str, principal) -> LectureLikeOut:
    """Toggle like on a lecture. Idempotent — a second call removes the like."""
    lid = _parse_uid(lecture_id)
    if lid is None or not _lecture_exists(db, lid):
        raise ApiError(status_code=404, code=ErrorCode.NOT_FOUND, message="Lecture not found.")

    existing = db.execute(
        select(LectureLike).where(
            LectureLike.user_id == principal.id,
            LectureLike.lecture_id == lid,
        )
    ).scalar_one_or_none()

    if existing is not None:
        db.delete(existing)
        db.commit()
        return LectureLikeOut(id=existing.id, user_id=principal.id, lecture_id=lid)

    like = LectureLike(user_id=principal.id, lecture_id=lid)
    db.add(like)
    db.commit()
    db.refresh(like)


def create_lecture_comment(db, lecture_id: str, body: str, principal, parent_id: str | None = None) -> LectureCommentOut:
    """Create a top-level comment or reply on a lecture."""
    lid = _parse_uid(lecture_id)
    if lid is None or not _lecture_exists(db, lid):
        raise ApiError(status_code=404, code=ErrorCode.NOT_FOUND, message="Lecture not found.")

    pid: Optional[uuid.UUID] = None
    if parent_id is not None:
        pid = _parse_uid(parent_id)
        if pid is None:
            raise ApiError(status_code=400, code=ErrorCode.BAD_REQUEST, message="Invalid parent comment id.")
        parent = db.get(LectureComment, pid)
        if parent is None or parent.lecture_id != lid:
            raise ApiError(status_code=404, code=ErrorCode.NOT_FOUND, message="Parent comment not found.")

    comment = LectureComment(
        lecture_id=lid,
        user_id=principal.id,
        parent_id=pid,
        body=body,
        is_removed=False,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return _comment_out(comment)


def update_lecture_comment(db, comment_id: str, body: str, principal) -> LectureCommentOut:
    """Edit own comment. Staff can edit any comment."""
    cid = _parse_uid(comment_id)
    if cid is None:
        raise ApiError(status_code=404, code=ErrorCode.NOT_FOUND, message="Comment not found.")
    comment = db.get(LectureComment, cid)
    if comment is None:
        raise ApiError(status_code=404, code=ErrorCode.NOT_FOUND, message="Comment not found.")
    if comment.user_id != principal.id:
        raise ApiError(status_code=403, code=ErrorCode.FORBIDDEN, message="This comment is not yours.")
    comment.body = body
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return _comment_out(comment)


def delete_lecture_comment(db, comment_id: str, principal) -> None:
    """Soft-delete own comment. Staff can delete any."""
    cid = _parse_uid(comment_id)
    if cid is None:
        raise ApiError(status_code=404, code=ErrorCode.NOT_FOUND, message="Comment not found.")
    comment = db.get(LectureComment, cid)
    if comment is None:
        raise ApiError(status_code=404, code=ErrorCode.NOT_FOUND, message="Comment not found.")
    if comment.user_id != principal.id:
        raise ApiError(status_code=403, code=ErrorCode.FORBIDDEN, message="This comment is not yours.")
    comment.is_removed = True
    db.add(comment)
    db.commit()


def save_lecture(db, lecture_id: str, user_id: uuid.UUID) -> LectureSaveOut:
    """Save a lecture for later (owner-scoped)."""
    lid = _parse_uid(lecture_id)
    if lid is None or not _lecture_exists(db, lid):
        raise ApiError(status_code=404, code=ErrorCode.NOT_FOUND, message="Lecture not found.")
    existing = db.execute(
        select(SavedItem).where(
            SavedItem.user_id == user_id,
            SavedItem.resource_type == "lecture",
            SavedItem.resource_id == lid,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return LectureSaveOut(saved=True)
    saved_item = SavedItem(user_id=user_id, resource_type="lecture", resource_id=lid)
    db.add(saved_item)
    db.commit()
    return LectureSaveOut(saved=True)


def unsave_lecture(db, lecture_id: str, user_id: uuid.UUID) -> LectureSaveOut:
    """Remove a saved lecture (owner-scoped; idempotent)."""
    lid = _parse_uid(lecture_id)
    existing = db.execute(
        select(SavedItem).where(
            SavedItem.user_id == user_id,
            SavedItem.resource_type == "lecture",
            SavedItem.resource_id == lid,
        )
    ).scalar_one_or_none()
    if existing is not None:
        db.delete(existing)
        db.commit()
    return LectureSaveOut(saved=False)


def list_saved(db, user_id: uuid.UUID):
    """List a user's saved items."""
    rows = db.execute(
        select(SavedItem).where(SavedItem.user_id == user_id)
    ).scalars().all()
    return rows

    return LectureLikeOut(id=like.id, user_id=principal.id, lecture_id=like.lecture_id)


def list_lecture_comments(db, lecture_id: str, filters, principal) -> LectureCommentThreadOut:
    """Return top-level comments for a lecture."""
    lid = _parse_uid(lecture_id)
    if lid is None or not _lecture_exists(db, lid):
        raise ApiError(status_code=404, code=ErrorCode.NOT_FOUND, message="Lecture not found.")

    stmt = select(LectureComment).where(
        LectureComment.lecture_id == lid,
        LectureComment.is_removed == False,  # noqa: E712
        LectureComment.parent_id.is_(None),
    )
    rows = db.execute(stmt).scalars().all()
    out = [_comment_out(row) for row in rows]
    if out:
        return LectureCommentThreadOut(comment=out[0], replies=out[1:])
    return LectureCommentThreadOut(comment=out[0], replies=[])
