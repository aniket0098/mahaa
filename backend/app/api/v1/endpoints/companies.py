"""``/companies`` — §12.2's ten membership-scoped routes.

**Two authentication questions, answered in two places, on purpose.**

* **Role** is :data:`EmployerUser`, so a candidate gets **403** — a real, nameable
  refusal on a route that exists. Applied once, here, so the answer is uniform
  across all ten routes rather than re-derived in each service call.
* **Membership** is the service layer's job and answers **404**, so company
  existence is not enumerable.

**Every id is a ``str``, never a ``UUID``.** ``services.ownership.parse_id`` turns a
malformed one into a 404 rather than a 422 — the project's settled rule, so these
routes cannot become a UUID-format oracle. Annotating the path as ``UUID`` would let
FastAPI reject the shape before the route ran.

**Route order is load-bearing for ``/companies/mine`` and
``/companies/{id}/members/me/accept``.** Both share a prefix with a literal path
that would otherwise be captured by a ``{...}`` segment; they are declared before
their wildcard siblings so they resolve first, and both use a distinct segment
count so FastAPI cannot confuse them regardless.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Response, status

from app.api.deps import DbSession, EmployerUser
from app.schemas.companies import (
    CompanyCreate,
    CompanyMemberRead,
    CompanyRead,
    CompanyUpdate,
    MemberInvite,
    MemberUpdate,
    MyCompanySummary,
    VerificationRequestResponse,
)
from app.services import companies as svc
from app.services.ownership import parse_id

router = APIRouter(prefix="/companies", tags=["companies"])


def _company_id(raw: str) -> uuid.UUID:
    """A malformed company id answers 404, not 422 — see the module docstring."""
    return parse_id(raw, "company")


def _member_id(raw: str) -> uuid.UUID:
    return parse_id(raw, "member")


CompanyPath = Annotated[
    str, Path(description="A company id. A malformed id answers 404, not 422.")
]
MemberPath = Annotated[
    str, Path(description="A membership id. A malformed id answers 404, not 422.")
]


@router.get("/mine", response_model=list[MyCompanySummary])
def my_companies(db: DbSession, principal: EmployerUser) -> list[MyCompanySummary]:
    """``GET /companies/mine`` — the caller's companies with their membership role.

    Declared before ``/{company_id}`` so the literal path is matched first.
    """
    return svc.list_my_companies(db, principal)


@router.post(
    "", response_model=MyCompanySummary, status_code=status.HTTP_201_CREATED
)
def create_company(
    body: CompanyCreate, db: DbSession, principal: EmployerUser
) -> MyCompanySummary:
    """``POST /companies`` — the creator becomes ``owner``, server-side."""
    return svc.create_company(db, principal, body)


@router.get("/{company_id}", response_model=CompanyRead)
def read_company(
    company_id: CompanyPath, db: DbSession, principal: EmployerUser
) -> CompanyRead:
    """``GET /companies/{id}`` — members only; a non-member gets 404, not 403."""
    return svc.get_company(db, principal, _company_id(company_id))


@router.patch("/{company_id}", response_model=CompanyRead)
def patch_company(
    company_id: CompanyPath,
    body: CompanyUpdate,
    db: DbSession,
    principal: EmployerUser,
) -> CompanyRead:
    """``PATCH /companies/{id}`` — every field optional.

    ``slug`` and ``verification_status`` are server-owned; ``CompanyUpdate`` forbids
    extras, so attempting either is a 422 rather than a silent drop.
    """
    return svc.update_company(db, principal, _company_id(company_id), body)


@router.get("/{company_id}/members", response_model=list[CompanyMemberRead])
def list_members(
    company_id: CompanyPath, db: DbSession, principal: EmployerUser
) -> list[CompanyMemberRead]:
    """``GET /companies/{id}/members`` — bare array, owner included.

    Every member is visible to every member of the company; the envelope carries no
    email, so the list cannot be used to harvest contact details.
    """
    return svc.list_members(db, principal, _company_id(company_id))


@router.post(
    "/{company_id}/members",
    response_model=CompanyMemberRead,
    status_code=status.HTTP_201_CREATED,
)
def invite_member(
    company_id: CompanyPath,
    body: MemberInvite,
    db: DbSession,
    principal: EmployerUser,
) -> CompanyMemberRead:
    """``POST /companies/{id}/members`` — invite an existing employer account.

    ``role=owner`` is a **422**: an invite can never mint an owner. No email is sent
    in V1, so the membership is created ``invited`` and the invitee accepts while
    signed in.
    """
    return svc.invite_member(db, principal, _company_id(company_id), body)


@router.patch(
    "/{company_id}/members/{member_id}", response_model=CompanyMemberRead
)
def patch_member(
    company_id: CompanyPath,
    member_id: MemberPath,
    body: MemberUpdate,
    db: DbSession,
    principal: EmployerUser,
) -> CompanyMemberRead:
    """``PATCH /companies/{id}/members/{member_id}`` — role and/or status.

    The only path to an ``owner`` role, and only an owner may grant it. The last
    active owner cannot be demoted, suspended or removed.
    """
    return svc.update_member(
        db, principal, _company_id(company_id), _member_id(member_id), body
    )


@router.delete(
    "/{company_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_member(
    company_id: CompanyPath,
    member_id: MemberPath,
    db: DbSession,
    principal: EmployerUser,
) -> Response:
    """``DELETE /companies/{id}/members/{member_id}`` — 204, and idempotent.

    Already-removed answers 204 too, so a client retrying after a dropped response
    does not see an error for work that is already done.
    """
    svc.remove_member(db, principal, _company_id(company_id), _member_id(member_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{company_id}/members/me/accept", response_model=CompanyMemberRead)
def accept_invitation(
    company_id: CompanyPath, db: DbSession, principal: EmployerUser
) -> CompanyMemberRead:
    """``POST /companies/{id}/members/me/accept`` — accept your own invitation.

    Declared after the ``{member_id}`` routes on purpose: ``me`` is a literal segment
    that must not be parsed as a membership id, and ``parse_id`` would answer 404 for
    it. FastAPI matches the literal first because it is a distinct path shape.
    """
    return svc.accept_invitation(db, principal, _company_id(company_id))


@router.post(
    "/{company_id}/verification-request", response_model=VerificationRequestResponse
)
def request_verification(
    company_id: CompanyPath, db: DbSession, principal: EmployerUser
) -> VerificationRequestResponse:
    """``POST /companies/{id}/verification-request`` — request-only in V1.

    Moves the status to ``pending`` and returns the server's own note. It never sets
    ``verified``: §23 records that no review process exists, so a claim of
    verification would be false.
    """
    return svc.request_verification(db, principal, _company_id(company_id))
