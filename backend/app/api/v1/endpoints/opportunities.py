"""``/opportunities`` — §12.1's two [M] reads.

**No writes here.** Employer job posting is [F]: ``/employer/jobs/new`` is
``implemented: false`` and renders an honest "arrives in a later stage" notice. A
``POST /opportunities`` that returned 201 would contradict that screen, so the router
deliberately has no create route rather than one nobody calls.

**The gate is ``CurrentUser``, not ``CandidateUser``.** §12.1 describes the feed as
read-only for candidates and states there is no per-viewer ACL, so adding a role gate
would refuse a signed-in employer for a reason the specification does not give — the
same reasoning ``endpoints/stories.py`` records.

**Ids are ``str``, not ``UUID``.** ``parse_id`` answers 404 for a malformed one,
matching the project's rule across Phase 4 to Phase 8 and keeping these routes from
becoming a UUID-format oracle.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query

from app.api.deps import CurrentUser, DbSession
from app.schemas.common import FastApiPage
from app.schemas.opportunities import OpportunityOut
from app.services import opportunities as svc
from app.services.ownership import parse_id

router = APIRouter(prefix="/opportunities", tags=["opportunities"])

OpportunityPath = Annotated[
    str, Path(description="An opportunity id. A malformed id answers 404, not 422.")
]


@router.get("", response_model=FastApiPage[OpportunityOut])
def list_opportunities(
    db: DbSession,
    principal: CurrentUser,
    type_: Annotated[
        str | None, Query(alias="type", description="Opportunity type.")
    ] = None,
    work_mode: Annotated[
        str | None, Query(description="remote | hybrid | onsite.")
    ] = None,
    q: Annotated[str | None, Query(description="Search title and description.")] = None,
    page: Annotated[int, Query(ge=1, le=10_000, description="1-based page.")] = 1,
    page_size: Annotated[
        int, Query(ge=1, le=svc.MAX_PAGE_SIZE, description="Rows to return.")
    ] = svc.DEFAULT_PAGE_SIZE,
) -> FastApiPage[OpportunityOut]:
    """``GET /opportunities`` — the filtered, paged feed.

    Query-parameter names are the client's (``type``, ``work_mode``, ``q``,
    ``page``, ``page_size``) rather than the Python identifiers, so the wire
    contract is exactly what ``src/api/opportunities.ts`` sends.
    """
    return svc.list_opportunities(
        db,
        opportunity_type=type_,
        work_mode=work_mode,
        q=q,
        page=page,
        page_size=page_size,
    )


@router.get("/{opportunity_id}", response_model=OpportunityOut)
def read_opportunity(
    opportunity_id: OpportunityPath, db: DbSession, principal: CurrentUser
) -> OpportunityOut:
    """``GET /opportunities/{id}`` — detail incl. ``requirements[]`` and ``company``.

    A draft, a non-public posting and an unknown id all answer 404, so the route
    cannot be used to confirm a restricted posting exists.
    """
    return svc.get_opportunity(db, parse_id(opportunity_id, "opportunity"))
