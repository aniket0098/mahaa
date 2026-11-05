"""``/saved`` router — candidate's saved items.

**Exactly one write: ``POST /saved``.** Creator publishing, uploads, progress
and payments belong to later stages; a ``POST /saved`` that returned 201 today
would contradict the honest "arrives in a later stage" screens, so the router
deliberately has no create-then-delete pattern rather than one nobody calls.

**The gate is ``CurrentUser``**, not ``CandidateUser``. The saved items domain
is signed-in only.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, status

from app.api.deps import CurrentUser, DbSession
from app.models.enums import MediaKind
from app.schemas.saved import SavedItemCreate, SavedItemOut, SavedItemUpdate
from app.services import saved as svc
from app.services.ownership import parse_id

router = APIRouter(prefix="/saved", tags=["saved"])


SavedItemPath = Annotated[
    str,
    Path(
        description="A saved item id. A malformed id answers 404, not 422.",
    ),
]


@router.get(
    "",
    response_model=list[SavedItemOut],
    summary="List the candidate's saved items",
)
def list_saved_endpoint(
    db: DbSession,
    principal: CurrentUser,
) -> list[SavedItemOut]:
    """``GET /saved`` — list the candidate's saved items.

    An empty catalogue is an empty list.
    """
    return svc.list_saved(db, principal)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=SavedItemOut,
    summary="Save a course or lecture",
)
def save_endpoint(
    db: DbSession,
    principal: CurrentUser,
    data: SavedItemCreate,
) -> SavedItemOut:
    """``POST /saved`` — save a course or lecture for the candidate.

    Idempotent: if already saved, the existing saved item is returned.
    """
    return svc.save(db, principal, data.resource_type, data.resource_id)


@router.delete(
    "/{saved_item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unsave a course or lecture",
)
def unsave_endpoint(
    db: DbSession,
    principal: CurrentUser,
    saved_item_id: SavedItemPath,
) -> None:
    """``DELETE /saved/{id}`` — unsave a course or lecture (owner only)."""
    svc.unsave(db, principal, saved_item_id)