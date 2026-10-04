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
from app.models.enums import ProfileVisibility, UserRole
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
    PublicProfile,
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
def identity_read(user: User, profile: Profile, session: Session) -> IdentityRead:
    """The identity half of the aggregate.

    ``profile_updated_at`` is the *profile's* own timestamp, not the user's, so
    editing a headline moves it and editing an unrelated account field does not.

    **``avatar_url`` is resolved, not hardcoded.** This used to return ``None``
    with a "media phase" note while ``GET /users/me`` and ``GET /users/{id}``
    already resolved the very same pointer. The result was that a candidate who
    saved a photo saw it on the account screen and on their public profile but not
    on their own Profile page, because the aggregate carried a null. It is now
    resolved through the one helper every other surface uses, so the profile
    screen, the account screen and a post card cannot disagree about the same
    avatar.
    """

    from app.services.media import avatar_url_for

    return IdentityRead(
        user_id=str(user.id),
        public_id=user.public_id,
        name=user.name,
        email=user.email,
        phone=user.phone,
        # §14.11's relative `served_at` path, identical to `GET /users/me`.
        avatar_url=avatar_url_for(user, session),
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
        identity=identity_read(user, profile, session),
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


# --- public profile (GET /users/{public_id}) ------------------------------------
#
# Deliberately NOT built by filtering the owner's own aggregate. Two fields in that
# aggregate -- `privacy` and `preferences` -- are the owner's settings, and a
# public profile that carried them would hand a viewer the owner's visibility
# configuration and their job-search preferences. The sections are re-read through
# the same helpers the aggregate uses, so the two cannot disagree about a row.


def _privacy_or_private(session: Session, user_id) -> ProfilePrivacy | None:
    """The owner's privacy row, or ``None``.

    Read-only, unlike :func:`get_or_create_privacy`. A GET that created rows would
    be a write triggered by somebody *else* looking at a profile, and an absent
    row must mean "no permissions granted" rather than being created with defaults.
    That is the same conservative reading :func:`app.services.lookup.find_users`
    applies to `discoverable`.
    """
    return session.get(ProfilePrivacy, user_id)


def may_view_profile(
    privacy: ProfilePrivacy | None, *, is_owner: bool, viewer_role: UserRole
) -> bool:
    """Whether ``viewer_role`` may see past a profile's identity fields.

    Three states, and the gate is deliberately the narrowest reading of each:

    * ``private`` — the owner only. Nobody else, whatever role they hold.
    * ``employers`` — the owner, and accounts whose role is ``employer``. Read
      literally, because a privacy setting that quietly widened itself to other
      roles would be a leak the owner never agreed to. A college account is
      therefore not covered by ``employers``; if that is wanted it should be a
      named rule rather than an accident of which roles happen to be checked.
    * ``public`` — any authenticated account.

    An absent row is treated as ``private``: the conservative answer, matching the
    `discoverable` default of false.
    """
    if is_owner:
        return True
    if privacy is None:
        return False
    if privacy.profile_visibility is ProfileVisibility.PUBLIC:
        return True
    if privacy.profile_visibility is ProfileVisibility.EMPLOYERS:
        return viewer_role is UserRole.EMPLOYER
    return False


def public_profile_read(
    session: Session, viewer: User, owner: User
) -> PublicProfile:
    """§5.3's privacy-filtered profile of ``owner``, as ``viewer`` may see it.

    Built by passing **only** the fields this viewer is entitled to, so the route's
    ``response_model_exclude_unset`` leaves everything else absent rather than
    null — the distinction §5.3 is built on. Contact details carry a second gate:
    ``show_email`` / ``show_phone`` apply even to somebody who passed the
    visibility check, because publishing a profile is not the same decision as
    publishing an address.
    """
    from app.schemas.profile import PublicProfile as _PublicProfile  # noqa: F401
    from app.services.media import avatar_url_for

    is_owner = viewer.id == owner.id
    privacy = _privacy_or_private(session, owner.id)

    published: dict[str, object] = {
        "user_id": str(owner.id),
        "public_id": owner.public_id,
        "username": owner.username,
        "name": owner.name,
        "role": owner.role.value,
        "avatar_url": avatar_url_for(owner, session),
        "is_owner": is_owner,
        "visibility": (
            privacy.profile_visibility.value if privacy is not None else "private"
        ),
    }

    # Nothing below runs for a viewer who failed the gate, so a private profile
    # costs one privacy lookup and no section reads at all.
    if not may_view_profile(privacy, is_owner=is_owner, viewer_role=viewer.role):
        return _PublicProfile(**published)

    profile = session.get(Profile, owner.id)
    published["designation"] = owner.designation
    published["headline"] = profile.headline if profile is not None else None
    published["summary"] = profile.summary if profile is not None else None
    published["location"] = profile.location if profile is not None else None
    published["interests"] = (
        list(profile.interests or []) if profile is not None else []
    )

    # Second gate: a visible profile is not a published address.
    if privacy is None or privacy.show_email:
        published["email"] = owner.email
    if privacy is None or privacy.show_phone:
        published["phone"] = owner.phone

    skill_count = int(
        session.scalar(
            select(func.count())
            .select_from(UserSkill)
            .where(UserSkill.user_id == owner.id)
        )
        or 0
    )
    published["skill_count"] = skill_count

    projects = list(
        session.scalars(
            select(Project)
            .options(selectinload(Project.skills).selectinload(ProjectSkill.skill))
            .where(Project.user_id == owner.id)
            .order_by(_nulls_last(Project.start_date), Project.id)
            .limit(AGGREGATE_SECTION_LIMIT)
        )
    )
    published["sections"] = {
        "education": [
            _dump(education_read(row))
            for row in _limited(
                session,
                Education,
                owner.id,
                (_nulls_last(Education.start_date), Education.id),
                AGGREGATE_SECTION_LIMIT,
            )
        ],
        "experience": [
            _dump(experience_read(row))
            for row in _limited(
                session,
                Experience,
                owner.id,
                (_nulls_last(Experience.start_date), Experience.id),
                AGGREGATE_SECTION_LIMIT,
            )
        ],
        "projects": [_dump(project_read(row)) for row in projects],
        "certifications": [
            _dump(certification_read(row))
            for row in _limited(
                session,
                Certification,
                owner.id,
                (_nulls_last(Certification.issued_on), Certification.id),
                AGGREGATE_SECTION_LIMIT,
            )
        ],
        "achievements": [
            _dump(achievement_read(row))
            for row in _limited(
                session,
                Achievement,
                owner.id,
                (_nulls_last(Achievement.achieved_on), Achievement.id),
                AGGREGATE_SECTION_LIMIT,
            )
        ],
        "links": [
            _dump(link_read(row))
            for row in _limited(
                session,
                ProfileLink,
                owner.id,
                (ProfileLink.created_at, ProfileLink.id),
                AGGREGATE_SECTION_LIMIT,
            )
        ],
    }
    return _PublicProfile(**published)


def _dump(model) -> dict[str, object]:
    """One read model as plain JSON-able data for ``sections``.

    ``exclude_unset`` is the same reasoning as the model's own optional fields:
    a field the reader never populated is absent from the section too, rather than
    a ``null`` that reads as "this person has no such entry".
    """
    return model.model_dump(mode="json", exclude_unset=True)
