"""Wire schemas for ``/companies`` — §12.2, field for field with `src/types/company.ts`.

**Every field name here is one the client already parses.** `src/types/company.ts`
declares `CompanyRead`, `MyCompanySummary`, `CompanyMemberRead`, `CompanyCreate`,
`CompanyUpdate`, `MemberInvite`, `MemberUpdate` and `VerificationRequestResponse`, and
the mobile integration suite exercises all of them against a live server. A renamed or
extra field is therefore a contract break, not a preference.

**``slug`` and ``verification_status`` are read-only, and that is structural.**
§12.2 calls both "**server-owned**", so neither appears in a write schema — and
``extra="forbid"`` means a client that tried would get a 422 rather than a silent drop.
``slug`` is the shareable handle: a client able to rewrite it could break a link
somebody had already shared.

**``CompanyUpdate`` is not ``CompanyCreate``.** Every field in it is *optional*, so a
patch can omit one. Reusing the create model would make ``PATCH {"name": "New"}`` clear
the website and the description, which is not what a patch means.

**The member envelope never carries an email.** §12.2's member list is the one place a
company could enumerate its staff, and ``MemberUserRead`` is ``{user_id, name,
public_id}`` — the same public identity handle used everywhere else. Contact details are
not the company's to redistribute.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import (
    CompanyMemberRole,
    CompanyMemberStatus,
    CompanySize,
    VerificationStatus,
)

MAX_NAME_CHARS = 200
MAX_DESCRIPTION_CHARS = 5000


class CompanyRead(BaseModel):
    """``CompanyRead`` — §12.2's ``GET /companies/{id}`` body.

    Built explicitly rather than ``from_attributes`` because ``logo_url`` is not a
    column: it is the ``served_at`` path of the asset ``logo_media_id`` points at.
    """

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    name: str
    slug: str
    website: str | None
    industry: str | None
    company_size: str | None
    location: str | None
    description: str | None
    #: §14.11's relative path, or null. Never absolute — the client joins it onto the
    #: configured base URL.
    logo_url: str | None
    #: Server-owned. See the module docstring.
    verification_status: str
    status: str
    created_at: datetime
    updated_at: datetime


class MyCompanySummary(BaseModel):
    """``MyCompanySummary`` — ``GET /companies/mine``, and the create result.

    The client treats this as a wrapper on purpose (`src/api/company.ts`: "the company
    plus the caller's membership"), because the caller's *role* is half of what that
    screen shows and it is not a company column.
    """

    model_config = ConfigDict(frozen=True)

    company: CompanyRead
    role: CompanyMemberRole
    #: The membership's own status, which is not the company's — an ``invited``
    #: membership belongs to an active company.
    membership_status: CompanyMemberStatus


class MemberUserRead(BaseModel):
    """Minimal identity for a member row. No email — see the module docstring."""

    model_config = ConfigDict(frozen=True)

    user_id: uuid.UUID
    name: str
    public_id: str


class CompanyMemberRead(BaseModel):
    """``CompanyMemberRead`` — §12.2's bare-array member list, and every member write.

    The invite, update and accept routes all answer with this same shape, so the client
    can replace one row in its list with the response rather than refetching.
    """

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    user: MemberUserRead
    role: CompanyMemberRole
    status: CompanyMemberStatus
    created_at: datetime
    updated_at: datetime


class CompanyCreate(BaseModel):
    """``POST /companies``.

    No ``owner``, no ``slug``, no ``verification_status``: §12.2 says the creator
    "becomes ``owner`` **server-side, atomically**", and the other two are server-owned.
    ``extra="forbid"`` makes a client-supplied ``owner_id`` a 422 instead of a silently
    dropped field — the same rule posts and stories apply.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_NAME_CHARS)
    website: str | None = Field(default=None, max_length=500)
    industry: str | None = Field(default=None, max_length=120)
    company_size: CompanySize | None = None
    location: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_CHARS)


class CompanyUpdate(BaseModel):
    """``PATCH /companies/{id}`` — every field optional.

    ``slug`` and ``verification_status`` are **absent by design**, and
    ``extra="forbid"``
    turns an attempt to set either into a 422. That is stronger than silently ignoring
    them: a client that believes it renamed a company's slug would render a link that
    does not work.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME_CHARS)
    website: str | None = Field(default=None, max_length=500)
    industry: str | None = Field(default=None, max_length=120)
    company_size: CompanySize | None = None
    location: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_CHARS)


description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_CHARS)


class MemberInvite(BaseModel):
    """``POST /companies/{id}/members`` — §12.2's invite.

    The target is an **existing** employer account, resolved by email; §12.2 does not
    create accounts from an invite.

    ``role`` is typed as the full member enum rather than a narrower ``InvitableRole``
    alias, because §14.9 is explicit about where the rule lives: "**The service layer
    must reject an invite that names `owner`** — the table must still be able to
    *represent* an owner, so the prohibition is not a table CHECK." A narrower enum here
    would reject ``owner`` with a 422 shaped like a type error and would make it
    impossible to *promote* somebody through the same schema in future. The service
    check is `services/companies.py::_assert_invitable_role`, and it names the field.
    """

    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320)
    role: CompanyMemberRole


class MemberUpdate(BaseModel):
    """``PATCH /companies/{id}/members/{member_id}`` — role and/or status.

    ``status`` excludes ``invited``: an invite is accepted by the invitee through
    ``.../me/accept``, never set by the company. Letting a company mark somebody
    invited would create a membership with nobody to accept it.
    """

    model_config = ConfigDict(extra="forbid")

    role: CompanyMemberRole | None = None
    status: CompanyMemberStatus | None = None


class VerificationRequestResponse(BaseModel):
    """``POST /companies/{id}/verification-request`` — §12.2, "Request-only in V1".

    ``note`` is the **server's** sentence, not the client's. §23 records that no review
    process exists, so the honest response is a status plus an explanation of what
    actually happens next. Returning the company with a status and no note would leave
    the UI implying a queue that does not exist.
    """

    model_config = ConfigDict(frozen=True)

    verification_status: VerificationStatus
    note: str
