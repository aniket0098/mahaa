"""Institutions â€” Â§12.3's owner-scoped college workspace.

**One gate, and it answers 404.** Â§12.3 says "every route is ownership-scoped: the
registering contact person owns the institution and anybody else gets ``404``", and the
error-semantics table repeats it â€” "an institution is **owner-scoped** | ``404`` for
anyone else". There is deliberately **no role gate** here, and that is a difference
from :mod:`app.services.companies` rather than an oversight: Â§12.2 has an explicit row
saying "a **candidate** may not use company routes at all | ``403``", and institutions
has no such row. The same table states the rule that settles it â€” "use 403 only where
the *existence* of the resource is already public, and the caller is the wrong
kind of principal - and an institution is never visible to a non-owner.

So a candidate asking for somebody else's institution gets the same 404 an employer
does, and the same 404 as for an id that does not exist. The response reveals nothing
about whether the row is real.

**There is no ``institution_members`` table, by design.** Â§14.9 gives companies a
membership table and institutions only ``owner_id``, because Â§12.3 scopes every
institution route to one contact person. Every method here resolves through
:func:`_require_owned`, and there is no "is this user an admin" check to make because
there is no second role.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError, ErrorCode
from app.models import Institution, MediaAsset, Program, User
from app.models.enums import InstitutionStatus, VerificationStatus
from app.schemas.companies import VerificationRequestResponse
from app.schemas.institutions import (
    Institution as InstitutionOut,
)
from app.schemas.institutions import (
    InstitutionCreate,
    InstitutionUpdate,
    MyInstitutionSummary,
    ProgramCreate,
    ProgramUpdate,
)
from app.schemas.institutions import (
    Program as ProgramOut,
)

#: Â§23: no review process exists in V1, so the honest answer to a verification request
#: is the status plus what actually happens next. The same wording companies use,
#: because Â§12.2 and Â§12.3 describe the identical request-only flow.
_VERIFICATION_NOTE = (
    "We have recorded your request. A human review team is not available yet, so "
    "your institution stays unverified until document review arrives in a later stage."
)


def _not_found(what: str) -> ApiError:
    return ApiError(
        status_code=404, code=ErrorCode.NOT_FOUND, message=f"That {what} was not found."
    )


# --------------------------------------------------------------------------- #
# Slugs â€” same rules as companies, because Â§14.9 makes institutions "as companies"
# --------------------------------------------------------------------------- #


def _slugify(name: str) -> str:
    """ASCII, lowercase, hyphen-joined â€” the shareable handle's alphabet."""
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_only = decomposed.encode("ascii", "ignore").decode("ascii").lower()
    parts = re.split(r"[^a-z0-9]+", ascii_only)
    slug = "-".join(part for part in parts if part)
    return slug[:200] or "institution"


def _unique_slug(session: Session, name: str) -> str:
    """A slug no other institution holds.

    ``institutions.slug`` is UNIQUE, so a collision would surface as a driver error and
    leak into a 500 â€” exactly as it would for companies.
    """
    base = _slugify(name)
    candidate = base
    for _attempt in range(50):
        exists = session.scalar(
            select(Institution.id).where(Institution.slug == candidate)
        )
        if exists is None:
            return candidate
        candidate = f"{base}-{_attempt + 2}"
    return f"{base}-{uuid.uuid4().hex[:8]}"


# --------------------------------------------------------------------------- #
# Serialisation
# --------------------------------------------------------------------------- #


def _logo_url(session: Session, institution: Institution) -> str | None:
    """Â§14.11's relative ``served_at`` path for the logo, or ``None``.

    Never absolute â€” the client joins it onto its configured base. A dangling pointer
    answers ``None`` rather than raising, so a read cannot become a 500.
    """
    if institution.logo_media_id is None:
        return None
    return session.scalar(
        select(MediaAsset.served_at).where(MediaAsset.id == institution.logo_media_id)
    )


def _institution_out(session: Session, institution: Institution) -> InstitutionOut:
    """Build ``Institution``.

    Written out rather than ``from_attributes`` because ``logo_url`` is not a column.
    ``industry``/``company_size`` exist as columns but are absent here â€” see
    ``schemas/institutions.py`` for why they are storage and not contract.
    """
    return InstitutionOut(
        id=institution.id,
        owner_id=institution.owner_id,
        name=institution.name,
        slug=institution.slug,
        website=institution.website,
        location=institution.location,
        description=institution.description,
        logo_url=_logo_url(session, institution),
        verification_status=institution.verification_status,
        status=institution.status,
        created_at=institution.created_at,
        updated_at=institution.updated_at,
    )


def _program_out(program: Program) -> ProgramOut:
    return ProgramOut(
        id=program.id,
        institution_id=program.institution_id,
        name=program.name,
        level=program.level,
        description=program.description,
        created_at=program.created_at,
        updated_at=program.updated_at,
    )


def _program_counts(
    session: Session, institution_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """A real ``COUNT`` per institution, in one grouped query.

    Â§14.9: "``program_count`` is a live ``COUNT``, not a column". Counting per
    institution in Python would be an N+1 on ``/institutions/mine``, and a stored
    counter would drift the moment a program changed anywhere but one screen.
    """
    if not institution_ids:
        return {}
    rows = session.execute(
        select(Program.institution_id, func.count())
        .where(Program.institution_id.in_(institution_ids))
        .group_by(Program.institution_id)
    ).all()
    return {institution_id: int(count) for institution_id, count in rows}


def _require_owned(
    session: Session, institution_id: uuid.UUID, user: User
) -> Institution:
    """Resolve the institution, proving the caller owns it. Else 404.

    The ownership test is **part of the lookup**, not a check afterwards: there is no
    window in which somebody else's row has been loaded, and a non-owner cannot even
    confirm the row exists.

    Scoped in the query rather than fetched-then-checked for the same reason
    ``ownership.py`` does it that way.
    """
    institution = session.scalar(
        select(Institution).where(
            Institution.id == institution_id, Institution.owner_id == user.id
        )
    )
    if institution is None:
        raise _not_found("institution") from None
    return institution


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #


def list_my_institutions(
    session: Session, user: User
) -> list[MyInstitutionSummary]:
    """``GET /institutions/mine`` â€” bare array, scoped to the caller's own rows.

    Filtered on ``owner_id`` in the query, so an institution somebody else owns cannot
    appear even if a later filter were forgotten. Â§17 lists this as a bare-array
    endpoint: an empty result is ``[]``, not an envelope.
    """
    institutions = session.scalars(
        select(Institution)
        .where(Institution.owner_id == user.id)
        .order_by(Institution.created_at)
    ).all()
    counts = _program_counts(session, [row.id for row in institutions])
    return [
        MyInstitutionSummary(
            institution=_institution_out(session, row),
            program_count=counts.get(row.id, 0),
        )
        for row in institutions
    ]


def create_institution(
    session: Session, user: User, payload: InstitutionCreate
) -> MyInstitutionSummary:
    """``POST /institutions`` â€” the caller becomes ``owner``, server-side.

    ``owner_id`` comes from the token and never from the body; Â§12.3 makes the owner
    the registering contact person, and the schema forbids the field so a client that
    sends it gets a 422 rather than a silently ignored attempt to plant an owner.
    """
    institution = Institution(
        name=payload.name.strip(),
        slug=_unique_slug(session, payload.name),
        website=payload.website,
        location=payload.location,
        description=payload.description,
        verification_status=VerificationStatus.UNVERIFIED,
        status=InstitutionStatus.ACTIVE,
        owner_id=user.id,
    )
    session.add(institution)
    session.commit()
    session.refresh(institution)
    # A newly created institution has no programs, so the count is 0 â€” a real COUNT
    # that happens to be zero, not a hardcoded field.
    return MyInstitutionSummary(
        institution=_institution_out(session, institution), program_count=0
    )


def get_institution(
    session: Session, user: User, institution_id: uuid.UUID
) -> InstitutionOut:
    """``GET /institutions/{id}`` â€” the owner only; anybody else gets 404."""
    return _institution_out(session, _require_owned(session, institution_id, user))


def update_institution(
    session: Session,
    user: User,
    institution_id: uuid.UUID,
    payload: InstitutionUpdate,
) -> InstitutionOut:
    """``PATCH /institutions/{id}`` â€” every field optional.

    ``owner_id``, ``slug`` and ``verification_status`` cannot be set: they are absent
    from ``InstitutionUpdate`` and that model forbids extras, so an attempt is a 422
    before it reaches here.
    """
    institution = _require_owned(session, institution_id, user)

    if payload.name is not None:
        institution.name = payload.name.strip()
    for field in ("website", "location", "description"):
        value: Any = getattr(payload, field)
        if value is not None:
            setattr(institution, field, value)
    session.commit()
    session.refresh(institution)
    return _institution_out(session, institution)

def list_programs(
    session: Session, user: User, institution_id: uuid.UUID
) -> list[ProgramOut]:
    """``GET /institutions/{id}/programs`` â€” bare array, owner only.

    Ordered by creation with a tie-break on id: two programs created in the same
    transaction can share a timestamp, and an unstable order would make the list
    reshuffle between identical requests.
    """
    _require_owned(session, institution_id, user)
    programs = session.scalars(
        select(Program)
        .where(Program.institution_id == institution_id)
        .order_by(Program.created_at, Program.id)
    ).all()
    return [_program_out(row) for row in programs]


def create_program(
    session: Session, user: User, institution_id: uuid.UUID, payload: ProgramCreate
) -> ProgramOut:
    """``POST /institutions/{id}/programs`` â€” ``{name, level?, description?}``.

    **No duplicate-name rule.** Â§14.9 declares no unique constraint on
    ``(institution_id, name)``, so a college may legitimately offer the same name
    twice (a certificate and a degree, say). Inventing a 409 here would refuse
    something the specification permits.
    """
    institution = _require_owned(session, institution_id, user)

    program = Program(
        institution_id=institution.id,
        name=payload.name.strip(),
        level=payload.level.strip() if payload.level else payload.level,
        description=(
            payload.description.strip() if payload.description else payload.description
        ),
    )
    session.add(program)
    session.commit()
    session.refresh(program)
    return _program_out(program)


def _require_own_program(
    session: Session, institution_id: uuid.UUID, program_id: uuid.UUID
) -> Program:
    """Fetch a program **and** prove it belongs to this institution.

    Both predicates in one query, so a program belonging to somebody else's
    institution is a 404 rather than an edit reached through the wrong path.
    """
    program = session.scalar(
        select(Program).where(
            Program.id == program_id, Program.institution_id == institution_id
        )
    )
    if program is None:
        raise _not_found("program") from None
    return program


def update_program(
    session: Session,
    user: User,
    institution_id: uuid.UUID,
    program_id: uuid.UUID,
    payload: ProgramUpdate,
) -> ProgramOut:
    """``PATCH .../programs/{program_id}`` - ownership first, then existence."""
    _require_owned(session, institution_id, user)
    program = _require_own_program(session, institution_id, program_id)

    if payload.name is not None:
        program.name = payload.name.strip()
    for field in ("level", "description"):
        value: Any = getattr(payload, field)
        if value is not None:
            setattr(program, field, value.strip() if isinstance(value, str) else value)
    session.commit()
    session.refresh(program)
    return _program_out(program)


def delete_program(
    session: Session, user: User, institution_id: uuid.UUID, program_id: uuid.UUID
) -> None:
    """``DELETE .../programs/{program_id}`` — 204, and idempotent.

    A program that is already gone answers **204**, so a client retrying after a
    dropped response does not see an error for work that is already done.
    """
    _require_owned(session, institution_id, user)
    program = session.scalar(
        select(Program).where(
            Program.id == program_id, Program.institution_id == institution_id
        )
    )
    if program is None:
        return
    session.delete(program)
    session.commit()

def request_verification(
    session: Session, user: User, institution_id: uuid.UUID
) -> VerificationRequestResponse:
    """``POST .../verification-request`` - the only status transition.

    ``unverified -> pending``. Section 23 records that no review process exists, so
    this never sets ``verified``: a client that renders a verified badge from this
    response would be making a false credential claim.

    **Idempotent**, matching companies: the status is already ``pending`` and the same
    note comes back, because the client's intent ("I have asked") is already satisfied.
    """
    institution = _require_owned(session, institution_id, user)

    if institution.verification_status is VerificationStatus.UNVERIFIED:
        institution.verification_status = VerificationStatus.PENDING
        session.commit()
        session.refresh(institution)

    return VerificationRequestResponse(
        verification_status=institution.verification_status, note=_VERIFICATION_NOTE
    )
