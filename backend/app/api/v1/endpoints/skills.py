"""``GET /skills/catalog`` — the database-backed catalogue.

Deliberately **not** under ``/profile``: the catalogue is shared reference data,
and a skill is a row with its own identity. The client's comment says the search
is "the database-backed catalogue, never a local list", which is what this is.

Any authenticated account may read it. It is read-only reference data with no
account-specific content, so restricting it to candidates would be an arbitrary
rule rather than a real boundary.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select

from app.api.deps import CurrentUser, DbSession
from app.models import Skill
from app.schemas.common import Page, build_page, page_params
from app.schemas.profile import SkillCatalogItem

router = APIRouter(tags=["skills"])


@router.get(
    "/skills/catalog",
    response_model=Page[SkillCatalogItem],
    summary="Search the skill catalogue",
)
def search_catalog(
    current_user: CurrentUser,
    session: DbSession,
    paging: tuple[int, int] = Depends(page_params),
    q: str = "",
) -> Page[SkillCatalogItem]:
    """Search skills by name or category.

    An empty ``q`` lists the whole catalogue, which is what the picker does before
    anybody types. The match is a prefix-or-substring ``ILIKE`` rather than a
    full-text index: the catalogue is a few thousand rows at most, and adding a
    PostgreSQL text-search index for it would be a speculative optimisation the
    Phase 1 brief warns against.

    The pattern is escaped so a ``%`` typed into the search box searches for a
    literal ``%`` instead of matching every row.
    """

    limit, offset = paging
    pattern = f"%{_escape_like(q.strip())}%" if q.strip() else None

    statement = select(Skill)
    counter = select(func.count()).select_from(Skill)
    if pattern:
        condition = or_(
            Skill.name.ilike(pattern, escape="\\"),
            Skill.category.ilike(pattern, escape="\\"),
        )
        statement = statement.where(condition)
        counter = counter.where(condition)

    total = int(session.scalar(counter) or 0)
    rows = session.scalars(
        statement.order_by(Skill.name, Skill.id).limit(limit).offset(offset)
    )
    return build_page(
        [
            SkillCatalogItem(id=str(row.id), name=row.name, category=row.category)
            for row in rows
        ],
        total,
        limit,
        offset,
    )


def _escape_like(value: str) -> str:
    """Escape LIKE wildcards in user input.

    Without this, a search for ``%`` matches every skill in the catalogue — a
    small correctness bug, and a way to pull the whole table in one page.
    """

    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
