"""Wire schemas for ``/opportunities`` — §12.1, field for field with the client.

**Every field here is one `src/types/opportunity.ts` parses.** §12.1 is explicit that
the client's type "is fully specified ... including `is_saved?` and
`my_application_id?` as **optional and nullable** — so the server may omit them
entirely. They are omitted below rather than sent as null, because both belong to
applications and saved-postings, which §12.1 marks [F]: `/applications` and `/saved`
are both `StageScreen`. Emitting `null` would imply the server has an answer.

**``comp_min``/``comp_max`` are floats, not ``Decimal``.** The column is
``NUMERIC(12,2)``, so SQLAlchemy hands the service a ``Decimal``; a ``Decimal`` would
serialise as a **string** and the client's `number | null` would receive `"1000.00"`.
The service converts once, here, rather than in every response builder.

**``requirements`` is a list of objects, not names.** §14.9 is explicit that a
``text[]`` cannot carry "a skill **name** and a `kind`", which is why
``opportunity_requirements` is a table and why this list exists at all.

**``CompanySnapshot`` is a public projection, not ``CompanyRead``.** It deliberately
has no ``description``, no ``created_at``, and no membership of any kind: a posting card
needs a name, a logo and a slug, and a job listing is the least appropriate place to
expose a company's full record to every authenticated reader.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import (
    CompanyMemberRole,
    CompanyMemberStatus,
    CompanySize,
    CompanyStatus,
    CompPeriod,
    EmploymentType,
    OpportunityStatus,
    OpportunityType,
    OpportunityVisibility,
    RequirementKind,
    VerificationStatus,
    WorkMode,
)


class CompanySnapshot(BaseModel):
    """The company as a posting card shows it — §12.1's ``company``.

    A projection rather than ``CompanyRead``: no description, no timestamps, and
    nothing membership-shaped. See the module docstring.
    """

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    name: str
    slug: str
    industry: str | None
    location: str | None
    website: str | None
    #: §14.11's relative ``served_at`` path, or null.
    logo_url: str | None
    verification_status: VerificationStatus


class OpportunityRequirementOut(BaseModel):
    """One entry of §12.1's ``requirements[]``."""

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    skill_id: uuid.UUID
    #: Resolved from the joined catalogue row, so it cannot go stale against the skill.
    skill_name: str
    kind: RequirementKind
    #: Free text — §14.9 says "``min_level`` text NULL", not a level enum.
    min_level: str | None
    importance: str


class OpportunityOut(BaseModel):
    """``Opportunity`` — §12.1's list item and detail body.

    ``is_saved`` and ``my_application_id`` are **absent**, per the module docstring.
    """

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    company_id: uuid.UUID
    title: str
    slug: str
    opportunity_type: OpportunityType
    status: OpportunityStatus
    visibility: OpportunityVisibility
    description: str | None
    responsibilities: str | None
    requirements_text: str | None
    work_mode: WorkMode | None
    location: str | None
    employment_type: EmploymentType | None
    #: Float, not Decimal — see the module docstring.
    comp_min: float | None
    comp_max: float | None
    comp_currency: str | None
    comp_period: CompPeriod | None
    openings: int | None
    deadline: date | None
    start_date: date | None
    company: CompanySnapshot
    requirements: list[OpportunityRequirementOut]
    published_at: datetime | None


#: Re-exported so `endpoints/companies.py` needs one import for the company vocabulary.
__all__ = [
    "CompanyMemberRole",
    "CompanyMemberStatus",
    "CompanySize",
    "CompanyStatus",
    "OpportunityOut",
    "OpportunityRequirementOut",
    "CompanySnapshot",
]
