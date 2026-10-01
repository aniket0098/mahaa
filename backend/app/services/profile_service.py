"""The profile aggregate and the per-section read/write helpers.

Two jobs:

* build the one-round-trip ``GET /profile`` the profile screen uses (spec Â§5.1);
* turn model rows into the read models, in one place per section, so the
  aggregate and the individual list endpoints cannot disagree about a field.

Everything here is scoped to one user. The aggregate reads exclusively by
``user_id`` and the section helpers all route through
:mod:`app.services.ownership`, so there is no code path that can return another
account's row.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Achievement,
    Certification,
    Education,
    Experience,
    Profile,
    ProfileLink,
    ProfilePreferences,
    ProfilePrivacy,
    Project,
    ProjectSkill,
    User,
    UserSkill,
)
from app.schemas.profile import (
    AchievementRead,
    CandidateSkillRead,
    CertificationRead,
    EducationRead,
    ExperienceRead,
    IdentityRead,
    LinkRead,
    PreferencesRead,
    PrivacyRead,
    ProfileAggregate,
    ProjectRead,
    ProjectSkillRef,
)
from app.services.completeness import completeness_for

#: How many rows the aggregate carries per section.
#
#: Deliberately a ceiling rather than "everything". The profile screen shows a
#: handful; a user with 500 education entries should not have all of them
#: serialised into one phone-sized response. The paged section endpoints are the
#: way to read past this.
AGGREGATE_SECTION_LIMIT = 50


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _years(years: Decimal | None) -> float | None:
    """``Numeric(4,1)`` reads back as a Decimal; the client wants a number.

    ``float()`` rather than ``str()`` because the mobile type is ``number | null``
    and a decimal in JSON would not satisfy it.
    """

    return float(years) if years is not None else None


def get_or_create_profile(session: Session, user_id) -> Profile:
    """The profile row, created empty on first access.

    Created lazily rather than at signup so a signup that is abandoned before
    touching the profile leaves no half-built row behind. The defaults come from
    the column defaults, so an untouched profile reads as "all empty", which is
    the honest state for it.
    """

    profile = session.get(Profile, user_id)
    if profile is None:
        profile = Profile(user_id=user_id)
        session.add(profile)
        session.commit()
        session.refresh(profile)
    return profile


def get_or_create_privacy(session: Session, user_id) -> ProfilePrivacy:
    """The privacy row, created with the documented defaults.

    ``private`` / not discoverable / messages allowed / contact details hidden â€”
    the column defaults. A missing row would otherwise have to be interpreted,
    and an interpreted "unknown" is how a private profile leaks.
    """

    privacy = session.get(ProfilePrivacy, user_id)
    if privacy is None:
        privacy = ProfilePrivacy(user_id=user_id)
        session.add(privacy)
        session.commit()
        session.refresh(privacy)
    return privacy
def identity_read(user: User, profile: Profile) -> IdentityRead:
    """The identity half of the aggregate.

    ``profile_updated_at`` is the *profile's* own timestamp, not the user's, so
    editing a headline moves it and editing an unrelated account field does not.
    """

    return IdentityRead(
        user_id=str(user.id),
        public_id=user.public_id,
        name=user.name,
        email=user.email,
        phone=user.phone,
        avatar_url=None,  # media phase; avatar_media_id has no row to resolve yet
        headline=profile.headline,
        summary=profile.summary,
        location=profile.location,
        interests=list(profile.interests or []),
        profile_updated_at=_iso(profile.updated_at) or "",
    )


def privacy_read(privacy: ProfilePrivacy) -> PrivacyRead:
    return PrivacyRead(
        profile_visibility=privacy.profile_visibility,
        discoverable=privacy.discoverable,
        allow_messages=privacy.allow_messages,
        show_email=privacy.show_email,
        show_phone=privacy.show_phone,
        updated_at=_iso(privacy.updated_at) or "",
    )


def preferences_read(preferences: ProfilePreferences | None) -> PreferencesRead | None:
    """``None`` when never set â€” distinct from "set to nothing".

    The client types the aggregate's field as ``PreferencesRead | null`` and reads
    it with ``profile.preferences?.work_modes``, so returning an empty object for
    an unset account would make "never configured" indistinguishable from
    "configured with nothing in it".
    """

    if preferences is None:
        return None
    return PreferencesRead(
        work_modes=list(preferences.work_modes or []),
        employment_types=list(preferences.employment_types or []),
        preferred_locations=list(preferences.preferred_locations or []),
        salary_min=preferences.salary_min,
        salary_max=preferences.salary_max,
        currency=preferences.currency,
        availability_date=_iso(preferences.availability_date),
        willing_to_relocate=preferences.willing_to_relocate,
        updated_at=_iso(preferences.updated_at) or "",
    )


def candidate_skill_read(row: UserSkill) -> CandidateSkillRead:
    """The join row plus the catalogue name, resolved in one pass.

    ``name`` and ``category`` come from the related ``Skill``, which the list
    query eager-loads â€” otherwise each row would trigger its own SELECT.
    """

    return CandidateSkillRead(
        id=str(row.id),
        skill_id=str(row.skill_id),
        name=row.skill.name,
        category=row.skill.category,
        level=row.level.value,
        years=_years(row.years),
        verified=row.verified,
        source=row.source,
        created_at=_iso(row.created_at) or "",
        updated_at=_iso(row.updated_at) or "",
    )


def education_read(row: Education) -> EducationRead:
    return EducationRead(
        id=str(row.id),
        institution=row.institution,
        degree=row.degree,
        field_of_study=row.field_of_study,
        level=row.level.value if row.level else None,
        start_date=_iso(row.start_date),
        end_date=_iso(row.end_date),
        current=row.current,
        grade=row.grade,
        description=row.description,
        created_at=_iso(row.created_at) or "",
        updated_at=_iso(row.updated_at) or "",
    )


def experience_read(row: Experience) -> ExperienceRead:
    return ExperienceRead(
        id=str(row.id),
        title=row.title,
        company_name=row.company_name,
        location=row.location,
        work_mode=row.work_mode.value if row.work_mode else None,
        start_date=_iso(row.start_date),
        end_date=_iso(row.end_date),
        current=row.current,
        description=row.description,
        created_at=_iso(row.created_at) or "",
        updated_at=_iso(row.updated_at) or "",
    )


def project_read(row: Project) -> ProjectRead:
    return ProjectRead(
        id=str(row.id),
        title=row.title,
        description=row.description,
        role=row.role,
        start_date=_iso(row.start_date),
        end_date=_iso(row.end_date),
        source_url=row.source_url,
        live_url=row.live_url,
        skills=[
            ProjectSkillRef(skill_id=str(link.skill_id), name=link.skill.name)
            for link in row.skills
        ],
        created_at=_iso(row.created_at) or "",
        updated_at=_iso(row.updated_at) or "",
    )


def certification_read(row: Certification) -> CertificationRead:
    return CertificationRead(
        id=str(row.id),
        title=row.title,
        issuer=row.issuer,
        issued_on=_iso(row.issued_on),
        expires_on=_iso(row.expires_on),
        credential_id=row.credential_id,
        verification_url=row.verification_url,
        created_at=_iso(row.created_at) or "",
        updated_at=_iso(row.updated_at) or "",
    )


def achievement_read(row: Achievement) -> AchievementRead:
    return AchievementRead(
        id=str(row.id),
        title=row.title,
        category=row.category.value,
        issuer=row.issuer,
        achieved_on=_iso(row.achieved_on),
        description=row.description,
        created_at=_iso(row.created_at) or "",
        updated_at=_iso(row.updated_at) or "",
    )


def link_read(row: ProfileLink) -> LinkRead:
    return LinkRead(
        id=str(row.id),
        kind=row.kind,
        label=row.label,
        url=row.url,
        created_at=_iso(row.created_at) or "",
        updated_at=_iso(row.updated_at) or "",
    )

def _limited(session: Session, model, user_id, order_by, limit: int) -> list:
    """The newest ``limit`` rows for one user, with a stable order.

    ``order_by`` includes a tiebreaker on the primary key: two education entries
    created in the same transaction would otherwise come back in an arbitrary
    order, and a list that reshuffles between two identical requests is a bug
    the client cannot defend against.
    """

    statement = (
        select(model)
        .where(model.user_id == user_id)
        .order_by(*order_by)
        .limit(limit)
    )
    return list(session.scalars(statement))


def _nulls_last(column):
    """Sort one column descending, with NULLs at the end.

    A row with no start date has no date, not the oldest date, and putting it at
    the top of a timeline would misrepresent it.

    Takes the **bare column**, not a pre-wrapped ``.desc()`` expression: calling
    ``.asc()`` on an already-descending expression produces ``ASC (x DESC)``,
    which is valid SQLAlchemy and invalid SQL.
    """

    return column.desc().nulls_last()


def build_aggregate(session: Session, user: User) -> ProfileAggregate:
    """Assemble ``GET /profile`` in a single round trip.

    Every query is scoped to ``user.id``. The relationship loads below are
    eager (``selectinload``) so the per-row ``name`` and ``skills`` lookups do not
    turn this into an N+1 query storm.
    """

    profile = get_or_create_profile(session, user.id)
    privacy = get_or_create_privacy(session, user.id)
    preferences = session.get(ProfilePreferences, user.id)

    skills = list(
        session.scalars(
            select(UserSkill)
            .options(selectinload(UserSkill.skill))
            .where(UserSkill.user_id == user.id)
            .order_by(UserSkill.created_at.desc(), UserSkill.id)
            .limit(AGGREGATE_SECTION_LIMIT)
        )
    )
    projects = list(
        session.scalars(
            select(Project)
            .options(selectinload(Project.skills).selectinload(ProjectSkill.skill))
            .where(Project.user_id == user.id)
            .order_by(_nulls_last(Project.start_date), Project.id)
            .limit(AGGREGATE_SECTION_LIMIT)
        )
    )

    return ProfileAggregate(
        identity=identity_read(user, profile),
        privacy=privacy_read(privacy),
        completeness=completeness_for(session, user.id),
        education=[
            education_read(row)
            for row in _limited(
                session,
                Education,
                user.id,
                (_nulls_last(Education.start_date), Education.id),
                AGGREGATE_SECTION_LIMIT,
            )
        ],
        experience=[
            experience_read(row)
            for row in _limited(
                session,
                Experience,
                user.id,
                (_nulls_last(Experience.start_date), Experience.id),
                AGGREGATE_SECTION_LIMIT,
            )
        ],
        projects=[project_read(row) for row in projects],
        certifications=[
            certification_read(row)
            for row in _limited(
                session,
                Certification,
                user.id,
                (_nulls_last(Certification.issued_on), Certification.id),
                AGGREGATE_SECTION_LIMIT,
            )
        ],
        achievements=[
            achievement_read(row)
            for row in _limited(
                session,
                Achievement,
                user.id,
                (_nulls_last(Achievement.achieved_on), Achievement.id),
                AGGREGATE_SECTION_LIMIT,
            )
        ],
        links=[
            link_read(row)
            for row in _limited(
                session, ProfileLink, user.id, (ProfileLink.created_at, ProfileLink.id),
                AGGREGATE_SECTION_LIMIT,
            )
        ],
        skills=[candidate_skill_read(row) for row in skills],
        preferences=preferences_read(preferences),
    )


def count_owned(session: Session, model, user_id) -> int:
    """Row count for one user â€” the ``total`` half of a page envelope."""

    return int(
        session.scalar(
            select(func.count()).select_from(model).where(model.user_id == user_id)
        )
        or 0
    )
