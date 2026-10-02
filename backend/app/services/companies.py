"""Companies — §12.2's membership-scoped workspace.

**Two gates, answering two different questions, and never collapsed.**

* **Role** is a dependency (``EmployerUser``): a candidate on a company route is a
  real, nameable refusal, so §12.2 says **403**. It lives in ``api/deps.py`` so the
  answer is uniform across all ten routes.
* **Membership** is here, and it answers **404**. A non-member must not be able to
  learn that a company id exists, and 403 would confirm it. The same 404 is returned
  for "no such company" and "not yours", so the response carries no information —
  the rule ``ownership.py`` already states for user-owned rows.

**Ownership is a row, not a column.** There is no ``companies.owner_id``; the owner
is the ``company_members`` row whose ``role`` is ``owner`` (§14.9). That is what lets a
company have an owner *and* other members.

**An invite can never mint an owner.** §12.2's first hard constraint: the column must
be able to *represent* an owner, so the prohibition is a service rule
(:func:`_assert_invitable_role`) and not a table CHECK. Ownership changes only by
patching an existing member's role.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError, ErrorCode, error_detail
from app.models import Company, CompanyMember, CompanyStatus, MediaAsset, User
from app.models.enums import (
    CompanyMemberRole,
    CompanyMemberStatus,
    UserRole,
    VerificationStatus,
)
from app.schemas.companies import (
    CompanyCreate,
    CompanyMemberRead,
    CompanyRead,
    CompanyUpdate,
    MemberInvite,
    MemberUpdate,
    MemberUserRead,
    MyCompanySummary,
    VerificationRequestResponse,
)

#: Roles permitted to administer membership. ``owner`` and ``admin`` only — a
#: recruiter or viewer can read the member list but not change it.
_ADMIN_ROLES = frozenset({CompanyMemberRole.OWNER, CompanyMemberRole.ADMIN})

#: §23: no review process exists in V1, so the honest answer to a verification
#: request is the status plus what actually happens next.
_VERIFICATION_NOTE = (
    "We have recorded your request. A human review team is not available yet, so "
    "your company stays unverified until document review arrives in a later stage."
)


# --------------------------------------------------------------------------- #
# Errors
# --------------------------------------------------------------------------- #


def _not_found(what: str) -> ApiError:
    return ApiError(
        status_code=404, code=ErrorCode.NOT_FOUND, message=f"That {what} was not found."
    )


def _forbidden(message: str) -> ApiError:
    return ApiError(status_code=403, code=ErrorCode.FORBIDDEN, message=message)


def _conflict(message: str, field: str | None = None) -> ApiError:
    return ApiError(
        status_code=409,
        code=ErrorCode.CONFLICT,
        message=message,
        details=[error_detail(field, message, "value_error")] if field else None,
    )


def _unprocessable(message: str, field: str) -> ApiError:
    return ApiError(
        status_code=422,
        code=ErrorCode.VALIDATION_ERROR,
        message=message,
        details=[error_detail(field, message, "value_error")],
    )
# --------------------------------------------------------------------------- #
# Slugs
# --------------------------------------------------------------------------- #


def _slugify(name: str) -> str:
    """ASCII, lowercase, hyphen-joined — the shareable handle's alphabet.

    Non-ASCII letters are transliterated rather than dropped, so "Café Ventures"
    does not collapse to an empty slug. A name with no usable characters falls back
    to ``"company"``, which the uniqueness suffix then disambiguates.
    """
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_only = decomposed.encode("ascii", "ignore").decode("ascii").lower()
    parts = re.split(r"[^a-z0-9]+", ascii_only)
    slug = "-".join(part for part in parts if part)
    return slug[:200] or "company"


def _unique_slug(session: Session, name: str) -> str:
    """A slug no other company holds.

    ``companies.slug`` is UNIQUE, so a collision would surface as a driver error and
    leak into a 500. The suffix is a counter, and the loop is bounded: a company
    would have to already own 50 slugs derived from one name to exhaust it.
    """
    base = _slugify(name)
    candidate = base
    for attempt in range(50):
        exists = session.scalar(select(Company.id).where(Company.slug == candidate))
        if exists is None:
            return candidate
        candidate = f"{base}-{attempt + 2}"
    return f"{base}-{uuid.uuid4().hex[:8]}"


# --------------------------------------------------------------------------- #
# Serialisation
# --------------------------------------------------------------------------- #


def _logo_url(session: Session, company: Company) -> str | None:
    """§14.11's relative ``served_at`` path for the logo, or ``None``.

    Never absolute — the client joins it onto its configured base. A dangling
    pointer answers ``None`` rather than raising, so a profile read cannot become a
    500 because an asset vanished under a loaded ORM object.
    """
    if company.logo_media_id is None:
        return None
    return session.scalar(
        select(MediaAsset.served_at).where(MediaAsset.id == company.logo_media_id)
    )


def _company_read(session: Session, company: Company) -> CompanyRead:
    """Build ``CompanyRead``.

    Written out rather than ``from_attributes`` because ``logo_url`` is not a column
    — it is resolved through ``logo_media_id``.
    """
    return CompanyRead(
        id=company.id,
        name=company.name,
        slug=company.slug,
        website=company.website,
        industry=company.industry,
        company_size=company.company_size.value if company.company_size else None,
        location=company.location,
        description=company.description,
        logo_url=_logo_url(session, company),
        verification_status=company.verification_status.value,
        status=company.status.value,
        created_at=company.created_at,
        updated_at=company.updated_at,
    )


def _member_read(
    session: Session, company_id: uuid.UUID, membership: CompanyMember
) -> CompanyMemberRead:
    """Build ``CompanyMemberRead`` — the envelope carries **no email**.

    The member list is the one place a company could enumerate its staff, and contact
    details are not the company's to redistribute, so the nested user is
    ``{user_id, name, public_id}`` only.
    """
    user = session.get(User, membership.user_id)
    return CompanyMemberRead(
        id=membership.id,
        company_id=company_id,
        role=membership.role,
        status=membership.status,
        user=MemberUserRead(
            user_id=membership.user_id,
            name=user.name if user else "",
            public_id=user.public_id if user else "",
        ),
        created_at=membership.created_at,
        updated_at=membership.updated_at,
    )


# --------------------------------------------------------------------------- #
# Membership resolution
# --------------------------------------------------------------------------- #


def _membership_query(company_id: uuid.UUID, user_id: uuid.UUID) -> Select:  # noqa: UP047
    return select(CompanyMember).where(
        CompanyMember.company_id == company_id,
        CompanyMember.user_id == user_id,
    )


def _require_membership(
    session: Session, company_id: uuid.UUID, user: User
) -> tuple[Company, CompanyMember]:
    """Resolve the caller's membership, or 404.

    Scoped in the query rather than fetched-then-checked, so a row belonging to
    somebody else is never loaded at all.
    """
    membership = session.scalar(_membership_query(company_id, user.id))
    if membership is None:
        raise _not_found("company") from None
    company = session.get(Company, company_id)
    if company is None:
        raise _not_found("company") from None
    return company, membership


def _require_admin(
    session: Session, company_id: uuid.UUID, user: User
) -> tuple[Company, CompanyMember]:
    """As :func:`_require_membership`, plus an administrative role.

    Still a **404** for a non-member — membership is not enumerable — but a member
    who is merely a viewer gets a **403**, because they demonstrably can see the
    company and are being refused the operation.
    """
    company, membership = _require_membership(session, company_id, user)
    if membership.role not in _ADMIN_ROLES:
        raise _forbidden("Only an owner or admin can manage company members.")
    return company, membership


def _assert_invitable_role(role: CompanyMemberRole) -> None:
    """Reject an invite that names ``owner`` — §12.2's first hard constraint.

    A **422**, not a 403 or a 409: the request is well-formed but names a role this
    operation cannot grant. The detail names ``role`` so the client can attach the
    message to that field.
    """
    if role is CompanyMemberRole.OWNER:
        raise _unprocessable(
            "An invitation cannot grant ownership. Change an existing member's role "
            "instead.",
            "role",
        )


def _assert_no_second_owner(
    session: Session, company_id: uuid.UUID, current_role: CompanyMemberRole
) -> None:
    """Refuse a role change that would give the company a second owner.

    §14.9 puts a **partial unique index** on exactly this: at most one ``owner`` row
    per company. Without a guard here the second promotion would reach the database
    and come back as an ``IntegrityError`` — a 500 with a driver message, on a request
    that is really just a client mistake.

    Every company has an owner from the moment it is created, so in practice this
    always refuses: V1 has no ownership *transfer*, because §12.2 does not specify one
    and the index does not allow two owners to exist at once.
    """
    if current_role is not CompanyMemberRole.OWNER:
        raise _conflict(
            "A company has exactly one owner. Ownership transfer is not available "
            "yet.",
            "role",
        ) from None


def _assert_keeps_an_owner(
    membership: CompanyMember,
    next_role: CompanyMemberRole,
    next_status: CompanyMemberStatus,
) -> None:
    """Refuse demoting, suspending or otherwise disabling the company's owner.

    With at most one owner per company, the owner row is the only one that can
    administer it — so changing it away from ``owner``/``active`` would leave a
    company nobody could manage, and deleting it would do the same.
    """
    if membership.role is CompanyMemberRole.OWNER and (
        next_role is not CompanyMemberRole.OWNER
        or next_status is not CompanyMemberStatus.ACTIVE
    ):
        raise _conflict(
            "This is the company's only owner, so the role and status cannot be "
            "changed.",
            "role",
        )


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #


def list_my_companies(session: Session, user: User) -> list[MyCompanySummary]:
    """``GET /companies/mine`` — bare array, membership-scoped by construction.

    Join-filtered on the caller's own memberships, so a company they do not belong to
    cannot appear even if the row were visible in some other query.
    """
    rows = session.execute(
        select(Company, CompanyMember)
        .join(CompanyMember, CompanyMember.company_id == Company.id)
        .where(CompanyMember.user_id == user.id)
        .order_by(Company.created_at)
    ).all()
    return [
        MyCompanySummary(
            company=_company_read(session, company),
            role=membership.role,
            membership_status=membership.status,
        )
        for company, membership in rows
    ]


def create_company(
    session: Session, user: User, payload: CompanyCreate
) -> MyCompanySummary:
    """``POST /companies`` — the creator becomes ``owner``, atomically.

    Both rows are written in one transaction so a company can never exist without its
    owner. The role gate has already proved this is an employer account.
    """
    company = Company(
        name=payload.name.strip(),
        slug=_unique_slug(session, payload.name),
        website=payload.website,
        industry=payload.industry,
        company_size=payload.company_size,
        location=payload.location,
        description=payload.description,
        verification_status=VerificationStatus.UNVERIFIED,
        status=CompanyStatus.ACTIVE,
    )
    session.add(company)
    session.flush()  # assigns the id the membership points at

    membership = CompanyMember(
        company_id=company.id,
        user_id=user.id,
        role=CompanyMemberRole.OWNER,
        status=CompanyMemberStatus.ACTIVE,
    )
    session.add(membership)
    session.commit()
    session.refresh(company)
    session.refresh(membership)
    return MyCompanySummary(
        company=_company_read(session, company),
        role=membership.role,
        membership_status=membership.status,
    )


def get_company(session: Session, user: User, company_id: uuid.UUID) -> CompanyRead:
    """``GET /companies/{id}`` — members only; a non-member gets 404."""
    company, _ = _require_membership(session, company_id, user)
    return _company_read(session, company)


def update_company(
    session: Session, user: User, company_id: uuid.UUID, payload: CompanyUpdate
) -> CompanyRead:
    """``PATCH /companies/{id}`` — every field optional; owner or admin only.

    ``slug`` and ``verification_status`` cannot be set: they are absent from
    ``CompanyUpdate`` and that model forbids extras, so an attempt is a 422 before it
    reaches this function.
    """
    company, _ = _require_admin(session, company_id, user)

    if payload.name is not None:
        company.name = payload.name.strip()
    for field in ("website", "industry", "company_size", "location", "description"):
        value: Any = getattr(payload, field)
        if value is not None:
            setattr(company, field, value)
    session.commit()
    session.refresh(company)
    return _company_read(session, company)


def request_verification(
    session: Session, user: User, company_id: uuid.UUID
) -> VerificationRequestResponse:
    """``POST /companies/{id}/verification-request`` — the only status transition.

    ``unverified → pending``. §23 records that no review process exists, so this
    never sets ``verified``: claiming verification would be a false credential
    statement. A second request is **idempotent** — the status is already ``pending``,
    and the same note comes back rather than an error, because the client's intent
    ("I have asked") is already satisfied.
    """
    company, _ = _require_admin(session, company_id, user)

    if company.verification_status is VerificationStatus.UNVERIFIED:
        company.verification_status = VerificationStatus.PENDING
        session.commit()
        session.refresh(company)

    return VerificationRequestResponse(
        verification_status=company.verification_status, note=_VERIFICATION_NOTE
    )


def list_members(
    session: Session, user: User, company_id: uuid.UUID
) -> list[CompanyMemberRead]:
    """``GET /companies/{id}/members`` — bare array, always including the owner."""
    _require_membership(session, company_id, user)
    rows = session.scalars(
        select(CompanyMember)
        .where(CompanyMember.company_id == company_id)
        .order_by(CompanyMember.created_at)
    ).all()
    return [_member_read(session, company_id, row) for row in rows]


def invite_member(
    session: Session, user: User, company_id: uuid.UUID, payload: MemberInvite
) -> CompanyMemberRead:
    """``POST /companies/{id}/members`` — invite an **existing** employer account.

    The target is resolved by email and must already exist: §12.2 does not create
    accounts from an invite, and minting an account here would mean inventing a
    password over a channel this app does not have.

    * Unknown email → **404**: this route does not confirm or deny who has an account.
    * A **candidate** at that address → **422** naming ``email``: the person exists
      and is wrong for a staff seat, so 403 would be misleading and 404 a lie.
    * Already a member → **409** naming ``email``.
    * ``role=owner`` → **422** via :func:`_assert_invitable_role`.
    """
    company, _ = _require_admin(session, company_id, user)
    _assert_invitable_role(payload.role)

    email = payload.email.strip().lower()
    invitee = session.scalar(select(User).where(func.lower(User.email) == email))
    if invitee is None:
        raise _not_found("account") from None
    if invitee.role is not UserRole.EMPLOYER:
        raise _unprocessable(
            "Only employer accounts can be invited to a company.", "email"
        )

    existing = session.scalar(_membership_query(company_id, invitee.id))
    if existing is not None:
        raise _conflict("That person is already a member of this company.", "email")

    membership = CompanyMember(
        company_id=company.id,
        user_id=invitee.id,
        role=payload.role,
        # No email is sent in V1 (§12.2), so the row starts as `invited` and the
        # invitee accepts while signed in. The UI must not say "invitation sent".
        status=CompanyMemberStatus.INVITED,
    )
    session.add(membership)
    session.commit()
    session.refresh(membership)
    return _member_read(session, company_id, membership)


def update_member(
    session: Session,
    user: User,
    company_id: uuid.UUID,
    member_id: uuid.UUID,
    payload: MemberUpdate,
) -> CompanyMemberRead:
    """``PATCH /companies/{id}/members/{member_id}`` — role and/or status.

    This is the **only** way an owner role is granted. Three guards make it safe:

    * The last remaining owner cannot be demoted or suspended, which would leave a
      company no one can administer.
    * A plain **admin** cannot promote anybody to ``owner`` — only an owner can, so
      an admin cannot mint a peer who outranks them.

    ``status`` cannot be set to ``invited`` (it is absent from ``MemberUpdate``): an
    invite is accepted by the invitee, never granted by the company.
    """
    company, actor = _require_admin(session, company_id, user)
    membership = session.get(CompanyMember, member_id)
    if membership is None or membership.company_id != company.id:
        raise _not_found("member") from None

    # ``MemberUpdate`` is typed as the full ``CompanyMemberStatus`` so it can express
    # *active* and *suspended*, but its docstring is explicit that ``invited`` is not
    # the company's to set: an invite is accepted by the invitee through
    # ``.../me/accept``. Accepting it here would create a membership with nobody left
    # to accept it. Enforced in the service so the rule holds however the schema is
    # typed.
    if payload.status is CompanyMemberStatus.INVITED:
        raise _unprocessable(
            "An invitation is accepted by the person invited, not set here.", "status"
        )

    if (
        payload.role is CompanyMemberRole.OWNER
        and actor.role is not CompanyMemberRole.OWNER
    ):
        raise _forbidden("Only an owner can grant ownership.")

    if payload.role is CompanyMemberRole.OWNER:
        # §14.9's partial unique index allows one owner row per company, and the
        # company already has one. Refusing here keeps the constraint as a
        # last-resort backstop instead of the thing the client normally hits.
        _assert_no_second_owner(session, company_id, membership.role)

    next_role = payload.role if payload.role is not None else membership.role
    next_status = payload.status if payload.status is not None else membership.status

    _assert_keeps_an_owner(membership, next_role, next_status)

    membership.role = next_role
    membership.status = next_status
    session.commit()
    session.refresh(membership)
    return _member_read(session, company_id, membership)

    if company.verification_status is VerificationStatus.UNVERIFIED:
        company.verification_status = VerificationStatus.PENDING
def remove_member(
    session: Session, user: User, company_id: uuid.UUID, member_id: uuid.UUID
) -> None:
    """``DELETE /companies/{id}/members/{member_id}`` — idempotent for non-members.

    A membership that is already gone answers **204**, so a client retrying after a
    dropped response does not see an error for work that is already done. The last
    owner cannot be removed, on the same rule as :func:`update_member`.
    """
    company, _ = _require_admin(session, company_id, user)
    membership = session.get(CompanyMember, member_id)
    if membership is None or membership.company_id != company.id:
        return
    if membership.role is CompanyMemberRole.OWNER:
        # Exactly one owner per company (§14.9's partial unique index), so deleting
        # this row would leave the company with nobody able to administer it.
        raise _conflict(
            "The company's owner cannot be removed.", "member_id"
        )
    session.delete(membership)
    session.commit()


def accept_invitation(
    session: Session, user: User, company_id: uuid.UUID
) -> CompanyMemberRead:
    """``POST /companies/{id}/members/me/accept`` — accept your own invitation.

    Deliberately **does not** use ``_require_membership``: an invitee is not yet a
    member, so the membership they are accepting is exactly the row being gated on.
    The company is resolved separately, and a caller with no invitation at all gets
    the same 404 as a caller who guessed the id.
    """
    company = session.get(Company, company_id)
    if company is None:
        raise _not_found("company") from None

    membership = session.scalar(_membership_query(company_id, user.id))
    if membership is None or membership.status is not CompanyMemberStatus.INVITED:
        raise _not_found("invitation") from None

    membership.status = CompanyMemberStatus.ACTIVE
    session.commit()
    session.refresh(membership)
    return _member_read(session, company_id, membership)
