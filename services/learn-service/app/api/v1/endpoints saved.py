"""Saved items endpoints for the Learn service.

Handles saving and unsaving courses and lectures, and listing saved items.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.api.deps import CurrentUser, DbSession
from app.models.enums import MediaKind
from app.schemas.saved import SavedItemCreate, SavedItemOut, SavedItemUpdate
from app.services import saved as svc
from app.services.ownership import parse_id

router = APIRouter(prefix="/saved", tags=["saved"])


@router.get("", response_model=list[SavedItemOut])
def list_saved_endpoint(
    db: DbSession,
    principal: CurrentUser,
) -> list[SavedItemOut]:
    """``GET /saved`` — list the candidate's saved items.

    An empty catalogue is an empty list.
    """
    return svc.list_saved(db, principal)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=SavedItemOut)
def save_endpoint(
    db: DbSession,
    principal: CurrentUser,
    data: SavedItemCreate,
) -> SavedItemOut:
    """``POST /saved`` — save a course or lecture for the candidate.

    Idempotent: if already saved, the existing saved item is returned.
    """
    from uuid import UUID

    resource_uuid = UUID(data.resource_id) if data.resource_id else None

    # Idempotent: return existing row if present.
    existing = db.execute(
        svc.models.SavedItem.__table__.select()
        .where(svc.models.SavedItem.c.user_id == principal.id)
        .where(svc.models.SavedItem.c.resource_type == data.resource_type)
        .where(svc.models.SavedItem.c.resource_id == resource_uuid)
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
        from sql import insert

        row = db.execute(
            insert(svc.models.SavedItem).values(
                user_id=principal.id,
                resource_type=data.resource_type,
                resource_id=resource_uuid,
            )
        )
        db.commit()
        return SavedItemOut(
            id=str(row.inserted_primary_key[0]),
            resource_type=data.resource_type,
            resource_id=data.resource_id,
            created_at="",
        )
    except Exception:
        db.rollback()
        existing = db.execute(
            svc.models.SavedItem.__table__.select()
            .where(svc.models.SavedItem.c.user_id == principal.id)
            .where(svc.models.SavedItem.c.resource_type == data.resource_type)
            .where(svc.models.SavedItem.c.resource_id == resource_uuid)
        ).scalar_one_or_none()

        if existing is None:
            raise

        return SavedItemOut(
            id=str(existing.id),
            resource_type=existing.resource_type,
            resource_id=str(existing.resource_id),
            created_at=existing.created_at.isoformat() if existing.created_at else "",
        )


@router.delete("/{saved_item_id}", status_code=status.HTTP_204_NO_CONTENT)
def unsave_endpoint(
    db: DbSession,
    principal: CurrentUser,
    saved_item_id: str,
) -> None:
    """``DELETE /saved/{id}`` — unsave a course or lecture (owner only)."""
    from uuid import UUID

    try:
        sid = UUID(saved_item_id)
    except (ValueError, TypeError):
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "Saved item was not found."}},
        )

    row = db.execute(
        svc.models.SavedItem.__table__.select()
        .where(svc.models.SavedItem.c.id == sid)
        .where(svc.models.SavedItem.c.user_id == principal.id)
    ).scalar_one_or_none()

    if row is None:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "Saved item was not found."}},
        )

    db.execute(
        svc.models.SavedItem.__table__.delete().where(svc.models.SavedItem.c.id == sid)
    )
    db.commit()