"""``/institutions`` — §12.3's nine [M] routes, and one that is deliberately absent.

**``GET /institutions`` (the public directory) is not implemented.** §12.3 classifies
it [F] and records "no mobile caller". §16 has a standing rule that a route with no
caller is an honest notice rather than a speculative endpoint, and every institution
here is owner-scoped anyway — a public directory would need its own privacy argument
that the specification does not make.

**The gate is ``CurrentUser``, not a role gate.** This is the deliberate difference
from ``endpoints/companies.py``, which uses ``EmployerUser``. §12.3 says "every route
is ownership-scoped … anybody else gets ``404``", and the error-semantics table gives
institutions exactly one row — "an institution is **owner-scoped** | ``404`` for anyone
else" — where companies has two, including an explicit "a **candidate** may not use
company routes at all | ``403``". Adding a college role gate here would answer **403**
where the specification says **404**, on the one route family whose whole privacy
argument is "an institution is never visible to a non-owner".

**Every id is a ``str``, never a ``UUID``.** ``parse_id`` answers 404 for a malformed
one, the project's settled rule, so these routes cannot become a UUID-format oracle.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Response, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.companies import VerificationRequestResponse
from app.schemas.institutions import (
    Institution,
    InstitutionCreate,
    InstitutionUpdate,
    MyInstitutionSummary,
    Program,
    ProgramCreate,
    ProgramUpdate,
)
from app.services import institutions as svc
from app.services.ownership import parse_id

router = APIRouter(prefix="/institutions", tags=["institutions"])

InstitutionPath = Annotated[
    str, Path(description="An institution id. A malformed id answers 404, not 422.")
]
ProgramPath = Annotated[
    str, Path(description="A program id. A malformed id answers 404, not 422.")
]


@router.get("/mine", response_model=list[MyInstitutionSummary])
def my_institutions(
    db: DbSession, principal: CurrentUser
) -> list[MyInstitutionSummary]:
    """``GET /institutions/mine`` — the caller's institutions with real counts."""
    return svc.list_my_institutions(db, principal)


@router.post(
    "", response_model=MyInstitutionSummary, status_code=status.HTTP_201_CREATED
)
def create_institution(
    body: InstitutionCreate, db: DbSession, principal: CurrentUser
) -> MyInstitutionSummary:
    """``POST /institutions`` — the caller becomes owner, server-side.

    ``owner_id`` is not accepted; sending it is a 422 rather than a silently ignored
    attempt to set somebody else's institution as yours.
    """
    return svc.create_institution(db, principal, body)


@router.get("/{institution_id}", response_model=Institution)
def read_institution(
    institution_id: InstitutionPath, db: DbSession, principal: CurrentUser
) -> Institution:
    """``GET /institutions/{id}`` — the owner only; anybody else gets 404."""
    return svc.get_institution(db, principal, parse_id(institution_id, "institution"))


@router.patch("/{institution_id}", response_model=Institution)
def patch_institution(
    institution_id: InstitutionPath,
    body: InstitutionUpdate,
    db: DbSession,
    principal: CurrentUser,
) -> Institution:
    """``PATCH /institutions/{id}`` — every field optional.

    ``owner_id``, ``slug`` and ``verification_status`` are server-owned; the schema
    forbids extras, so attempting any of them is a 422.
    """
    return svc.update_institution(
        db, principal, parse_id(institution_id, "institution"), body
    )


@router.post(
    "/{institution_id}/verification-request", response_model=VerificationRequestResponse
)
def request_verification(
    institution_id: InstitutionPath, db: DbSession, principal: CurrentUser
) -> VerificationRequestResponse:
    """``POST /institutions/{id}/verification-request`` — request-only in V1.

    Moves the status to ``pending`` and returns the server's own note. It never sets
    ``verified``: §23 records that no review process exists, so a claim of verification
    would be false.
    """
    return svc.request_verification(
        db, principal, parse_id(institution_id, "institution")
    )
@router.get("/{institution_id}/programs", response_model=list[Program])
def list_programs(
    institution_id: InstitutionPath, db: DbSession, principal: CurrentUser
) -> list[Program]:
    """``GET /institutions/{id}/programs`` — bare array, owner only."""
    return svc.list_programs(db, principal, parse_id(institution_id, "institution"))


@router.post(
    "/{institution_id}/programs",
    response_model=Program,
    status_code=status.HTTP_201_CREATED,
)
def create_program(
    institution_id: InstitutionPath,
    body: ProgramCreate,
    db: DbSession,
    principal: CurrentUser,
) -> Program:
    """``POST /institutions/{id}/programs`` — ``{name, level?, description?}``."""
    return svc.create_program(
        db, principal, parse_id(institution_id, "institution"), body
    )


@router.patch("/{institution_id}/programs/{program_id}", response_model=Program)
def patch_program(
    institution_id: InstitutionPath,
    program_id: ProgramPath,
    body: ProgramUpdate,
    db: DbSession,
    principal: CurrentUser,
) -> Program:
    """``PATCH /institutions/{id}/programs/{program_id}`` — ownership, then existence.

    A program belonging to another institution answers 404, not 403: the program is
    only reachable through an institution the caller owns.
    """
    return svc.update_program(
        db,
        principal,
        parse_id(institution_id, "institution"),
        parse_id(program_id, "program"),
        body,
    )


@router.delete(
    "/{institution_id}/programs/{program_id}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_program(
    institution_id: InstitutionPath,
    program_id: ProgramPath,
    db: DbSession,
    principal: CurrentUser,
) -> Response:
    """``DELETE /institutions/{id}/programs/{program_id}`` — 204, and idempotent.

    Already-removed answers 204 too, so a client retrying after a dropped response does
    not see an error for work that is already done.
    """
    svc.delete_program(
        db,
        principal,
        parse_id(institution_id, "institution"),
        parse_id(program_id, "program"),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
