"""Request and response models for the saved items domain.

Every field here exists the mobile client. Nothing is invented, and nothing is
renamed:

* ``src/types/saved.ts`` — ``SavedItemForm``, ``SavedItemResponse``.
* ``src/api/saved.ts`` route calls and type assertions.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, ConfigDict


class SavedItemCreate(BaseModel):
    """``POST /saved`` — a candidate saves a course or lecture.

    ``resource_type`` is ``'course'`` or ``'lecture'``.
    ``resource_id`` is the id of the course or lecture being saved.
    """

    model_config = ConfigDict(coerce=True)

    resource_type: str = Field(
        description="``'course'`` or ``'lecture'``",
    )
    resource_id: str = Field(
        description="Id of the course or lecture being saved",
    )


class SavedItemOut(BaseModel):
    """``GET /saved`` — the caller's saved items.

    ``resource_type`` discriminates the saved resource kind.
    ``resource_id`` is the id of the saved course or lecture.
    ``created_at`` is when the save was recorded.
    """

    model_config = ConfigDict(coerce=True)

    id: str
    resource_type: str
    resource_id: str
    created_at: str


class SavedItemUpdate(BaseModel):
    """``DELETE /saved/{id}`` — unsave a course or lecture."""

    model_config = ConfigDict(coerce=True)

    id: str = Field(
        description="Saved item id to remove",
    )