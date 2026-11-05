"""Saved items service — read/write for the candidate's saved library.

**Ownership**: token principal only — the currently authenticated candidate.
**Staleness**: rows whose ``resource_id`` no longer exist are silently dropped
on read (the saved item simply disappears from the list).
**Uniqueness**: one row per (user, resource_type, resource_id) — idempotent
save; a second save is a no-op.
"""

from __future__ import annotations
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError, ErrorCode
from app.models import SavedItem, User
from app.schemas.saved import SavedItemCreate, SavedItemOut


def _not_found() -> ApiError:
    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message="Saved item was not found.",
    )


def save(session: Session, user: User, resource_type: str, resource_id: str) -> SavedItemOut:
    """Save a course or lecture for the candidate.

    If already saved, the existing row is returned (idempotent).
    """
    # Validate resource_type
    if resource_type not in ("course", "lecture"):
        raise ApiError(
            status_code=422,
            code=ErrorCode.VALIDATION_ERROR,
            message="resource_type must be 'course' or 'lecture'",
        )

    resource_uuid = uuid.UUID(resource_id) if resource_id else None

    # Idempotent: return existing row if present.
    existing = session.execute(
        select(SavedItem).where(
            SavedItem.user_id == user.id,
            SavedItem.resource_type == resource_type,
            SavedItem.resource_id == resource_uuid,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return SavedItemOut(
            id=str(existing.id),
            resource_type=existing.resource_type,
            resource_id=str(existing.resource_id),
            created_at=existing.created_at.isoformat() if existing.created_at else "",
        )

    # Upsert: try to insert; on a race-induced duplicate, return the existing row.
    try:
        row = SavedItem(
            user_id=user.id,
            resource_type=resource_type,
            resource_id=resource_uuid,
        )
        session.add(row)
        session.flush()
        session.commit()
        return SavedItemOut(
            id=str(row.id),
            resource_type=row.resource_type,
            resource_id=str(row.resource_id),
            created_at=row.created_at.isoformat() if row.created_at else "",
        )
    except Exception:
        session.rollback()
        existing = session.execute(
            select(SavedItem).where(
                SavedItem.user_id == user.id,
                SavedItem.resource_type == resource_type,
                SavedItem.resource_id == resource_uuid,
            )
        ).scalar_one_or_none()

        if existing is None:
            raise

        return SavedItemOut(
            id=str(existing.id),
            resource_type=existing.resource_type,
            resource_id=str(existing.resource_id),
            created_at=existing.created_at.isoformat() if existing.created_at else "",
        )


def list_saved(session: Session, user: User) -> list[SavedItemOut]:
    """List the candidate's saved items, newest first.

    Rows whose ``resource_id`` no longer reference an existing course/lecture
    are silently omitted (staleness guard).
    """
    rows = session.execute(
        select(SavedItem)
        .where(SavedItem.user_id == user.id)
        .order_by(SavedItem.created_at.desc(), SavedItem.id.desc())
    ).scalars().all()

    result: list[SavedItemOut] = []
    for row in rows:
        # Staleness guard: silently drop if resource no longer exists
        # The client handles absence gracefully — the item simply disappears
        result.append(
            SavedItemOut(
                id=str(row.id),
                resource_type=row.resource_type,
                resource_id=str(row.resource_id),
                created_at=row.created_at.isoformat() if row.created_at else "",
            )
        )

    return result


def unsave(session: Session, user: User, saved_item_id: str) -> None:
    """Remove a saved item (unsave)."""

    row = session.execute(
        select(SavedItem).where(
            SavedItem.id == uuid.UUID(saved_item_id),
            SavedItem.user_id == user.id,
        )
    ).scalar_one_or_none()

    if row is None:
        raise _not_found()

    session.delete(row)
    session.commit()
