"""Opportunities — §12.1's read-only posting feed.

**Two [M] reads, and no writes.** Employer job posting is [F] in V1:
``/employer/jobs/new`` is ``implemented: false`` and an honest notice. Nothing here
creates, edits or removes a posting, so there is no write path to get wrong.

**Who may read.** Any authenticated caller. §12.1 calls this "read-only for
candidates in V1" and states there is no per-viewer ACL, so the gate is
``CurrentUser`` rather than ``CandidateUser`` — the same reasoning ``endpoints/
stories.py`` gives for adding no role gate.

**``is_saved`` and ``my_application_id`` are omitted, not null.** Both belong to
applications and saved-postings, which §12.1 marks [F]. Sending ``null`` would imply
the server has an answer; the client's type has both as optional and nullable, so
omission is the honest shape and is what the schema does.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError, ErrorCode
from app.models import Company, Opportunity, OpportunityRequirement, Skill
from app.models.enums import OpportunityStatus, OpportunityVisibility
from app.schemas.common import FastApiPage, build_fastapi_page
from app.schemas.opportunities import (
    CompanySnapshot,
    OpportunityOut,
    OpportunityRequirementOut,
)

#: §10.1's page window, its own constants rather than ``stories.py``'s — the two
#: envelopes are kept apart per §25.6.
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100

#: §12.1's search runs against title and description.
_SEARCH_COLUMNS = (Opportunity.title, Opportunity.description)


def _not_found() -> ApiError:
    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message="That opportunity was not found.",
    )


def _float_or_none(value: Decimal | float | None) -> float | None:
    """``NUMERIC(12,2)`` arrives as ``Decimal``; the client wants ``number | null``.

    A ``Decimal`` would serialise as the **string** ``"1000.00"`` and the client's
    numeric field would silently become text, so the conversion happens once here
    rather than in every response builder.
    """
    return None if value is None else float(value)


def _base_query() -> Select:  # noqa: UP047
    """Only postings a reader is allowed to see.

    ``published`` is the state §12.1's feed means, and ``public`` visibility is the
    one the column exists for. Both are excluded **in SQL** so neither a draft nor a
    restricted posting can leak through a missed Python-side filter.
    """
    return (
        select(Opportunity)
        .where(
            Opportunity.status == OpportunityStatus.PUBLISHED,
            Opportunity.visibility == OpportunityVisibility.PUBLIC,
        )
        .order_by(
            Opportunity.published_at.desc().nullslast(),
            Opportunity.created_at.desc(),
        )
    )
def _requirement_out(
    row: OpportunityRequirement, skill_name: str
) -> OpportunityRequirementOut:
    """One entry of ``requirements[]``, with the skill name resolved from the join.

    Resolved rather than copied so it cannot go stale against a renamed skill —
    which is why the client type carries both ``skill_id`` and ``skill_name``.
    """
    return OpportunityRequirementOut(
        id=row.id,
        skill_id=row.skill_id,
        skill_name=skill_name,
        kind=row.kind,
        min_level=row.min_level,
        importance=row.importance,
    )


def _to_out(
    opportunity: Opportunity,
    company: Company,
    requirements: list[OpportunityRequirementOut],
) -> OpportunityOut:
    """``OpportunityOut`` — the list item and the detail body are the same shape."""
    return OpportunityOut(
        id=opportunity.id,
        company_id=company.id,
        title=opportunity.title,
        slug=opportunity.slug,
        opportunity_type=opportunity.opportunity_type,
        status=opportunity.status,
        visibility=opportunity.visibility,
        description=opportunity.description,
        responsibilities=opportunity.responsibilities,
        requirements_text=opportunity.requirements_text,
        work_mode=opportunity.work_mode,
        location=opportunity.location,
        employment_type=opportunity.employment_type,
        comp_min=_float_or_none(opportunity.comp_min),
        comp_max=_float_or_none(opportunity.comp_max),
        comp_currency=opportunity.comp_currency,
        comp_period=opportunity.comp_period,
        openings=opportunity.openings,
        deadline=opportunity.deadline,
        start_date=opportunity.start_date,
        company=CompanySnapshot(
            id=company.id,
            name=company.name,
            slug=company.slug,
            industry=company.industry,
            location=company.location,
            website=company.website,
            # A posting card needs a logo; this projection carries no media column,
            # so the client falls back to its placeholder. §12.1 asks for none.
            logo_url=None,
            verification_status=company.verification_status,
        ),
        requirements=requirements,
        published_at=opportunity.published_at,
    )


def _requirements_for(
    session: Session, opportunity_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[OpportunityRequirementOut]]:
    """Requirements for a whole page in **one** query.

    Fetching them per opportunity would be an N+1 on every list request; §12.1's
    list item includes ``requirements[]``, so this has to be a batch.
    """
    if not opportunity_ids:
        return {}
    rows = session.execute(
        select(OpportunityRequirement, Skill.name)
        .join(Skill, Skill.id == OpportunityRequirement.skill_id)
        .where(OpportunityRequirement.opportunity_id.in_(opportunity_ids))
        .order_by(OpportunityRequirement.opportunity_id, Skill.name)
    ).all()
    grouped: dict[uuid.UUID, list[OpportunityRequirementOut]] = {
        opportunity_id: [] for opportunity_id in opportunity_ids
    }
    for requirement, skill_name in rows:
        grouped[requirement.opportunity_id].append(
            _requirement_out(requirement, skill_name)
        )
    return grouped


def list_opportunities(
    session: Session,
    *,
    opportunity_type: str | None = None,
    work_mode: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> FastApiPage[OpportunityOut]:
    """``GET /opportunities`` — §12.1's filtered, paged feed.

    The ``COUNT`` shares the filter predicate, so ``pages`` cannot disagree with the
    rows. Filters are equality or ``ILIKE`` against indexed columns rather than a
    full-text search: §12.1 says "search is ``q`` against title/description" and does
    not promise ranking.
    """
    query = _base_query()
    if opportunity_type:
        query = query.where(Opportunity.opportunity_type == opportunity_type)
    if work_mode:
        query = query.where(Opportunity.work_mode == work_mode)
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        query = query.where(
            or_(*(column.ilike(pattern) for column in _SEARCH_COLUMNS))
        )

    total = session.scalar(
        select(func.count()).select_from(query.order_by(None).subquery())
    )
    rows = (
        session.scalars(query.offset((page - 1) * page_size).limit(page_size)).all()
        if page_size
        else []
    )

    companies: dict[uuid.UUID, Company] = {}
    if rows:
        companies = {
            company.id: company
            for company in session.scalars(
                select(Company).where(
                    Company.id.in_([row.company_id for row in rows])
                )
            ).all()
        }

    requirements = _requirements_for(session, [row.id for row in rows])
    items = [
        _to_out(row, companies[row.company_id], requirements.get(row.id, []))
        for row in rows
        if row.company_id in companies
    ]
    return build_fastapi_page(items, int(total or 0), page, page_size)


def get_opportunity(session: Session, opportunity_id: uuid.UUID) -> OpportunityOut:
    """``GET /opportunities/{id}`` — the same visibility rules as the list.

    A draft, a non-public posting and an id that does not exist all answer **404**:
    the detail route must not become a way to confirm that a restricted posting
    exists.
    """
    opportunity = session.scalar(_base_query().where(Opportunity.id == opportunity_id))
    if opportunity is None:
        raise _not_found() from None
    company = session.get(Company, opportunity.company_id)
    if company is None:
        # A RESTRICT FK makes this unreachable; a 404 is the honest answer if a row
        # ever disappears, rather than a 500 from building the projection.
        raise _not_found() from None
    requirements = _requirements_for(session, [opportunity.id]).get(opportunity.id, [])
    return _to_out(opportunity, company, requirements)
