"""The ``/profile`` router â€” the candidate's own profile.

Every route here is **candidate-only** (``CandidateUser``), because the profile
sections are a candidate record: an employer has no education timeline or skill
list, and the integration suite asserts a 403 when an employer asks for it.

Every route is also **self-only**: they read and write ``current_user.id`` and
never accept a user id from the client. There is no route in this file that can
be pointed at another account, which is a stronger guarantee than checking
ownership on each one.

Section ordering matches the client's expectation: most recent first, with a
primary-key tiebreaker so a list cannot reshuffle between identical requests.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import CandidateUser, DbSession
from app.core.errors import ApiError, ErrorCode
from app.models import (
    Achievement,
    Certification,
    Education,
    Experience,
    ProfilePreferences,
    Project,
    ProjectSkill,
    Skill,
    UserSkill,
)
from app.schemas.common import Page, build_page, page_params
from app.schemas.profile import (
    AchievementCreate,
    AchievementRead,
    AchievementUpdate,
    CandidateSkillCreate,
    CandidateSkillRead,
    CandidateSkillUpdate,
    CertificationCreate,
    CertificationRead,
    CertificationUpdate,
    Completeness,
    EducationCreate,
    EducationRead,
    EducationUpdate,
    ExperienceCreate,
    ExperienceRead,
    ExperienceUpdate,
    PreferencesRead,
    PreferencesUpdate,
    PrivacyRead,
    PrivacyUpdate,
    ProfileAggregate,
    ProfileIdentityUpdate,
    ProjectCreate,
    ProjectRead,
    ProjectUpdate,
)
from app.services import profile_service as svc
from app.services.completeness import completeness_for
from app.services.ownership import get_owned, parse_id

router = APIRouter(tags=["profile"])
@router.get(
    "/profile",
    response_model=ProfileAggregate,
    summary="The whole profile in one round trip",
)
def read_profile(current_user: CandidateUser, session: DbSession) -> ProfileAggregate:
    """The aggregate the profile screen uses (spec Â§5.1).

    Creates the empty profile and privacy rows on first read, so a brand new
    account gets a valid, complete-shaped response rather than a 404 â€” the
    columns carry their own defaults, so "all empty" is the honest description
    of a profile nobody has filled in.
    """

    return svc.build_aggregate(session, current_user)


@router.get(
    "/profile/completeness",
    response_model=Completeness,
    summary="Server-derived completion",
)
def read_completeness(current_user: CandidateUser, session: DbSession) -> Completeness:
    """The same value the aggregate carries, on its own.

    The Home screen needs only the number. The integration suite asserts these
    two endpoints agree, which is why both call the one function rather than
    reimplementing the weighting.
    """

    return completeness_for(session, current_user.id)


@router.patch(
    "/profile", response_model=svc.IdentityRead, summary="Update identity text"
)
def update_identity(
    payload: ProfileIdentityUpdate,
    current_user: CandidateUser,
    session: DbSession,
) -> svc.IdentityRead:
    """Patch the four identity fields.

    ``exclude_unset`` means an absent field is left alone and an explicit
    ``null`` clears it â€” the distinction a PATCH needs.
    """

    profile = svc.get_or_create_profile(session, current_user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, field, value)
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return svc.identity_read(current_user, profile, session)


# --- privacy ----------------------------------------------------------------


@router.get(
    "/profile/privacy", response_model=PrivacyRead, summary="Read privacy settings"
)
def read_privacy(current_user: CandidateUser, session: DbSession) -> PrivacyRead:
    return svc.privacy_read(svc.get_or_create_privacy(session, current_user.id))


@router.put(
    "/profile/privacy",
    response_model=PrivacyRead,
    summary="Replace privacy settings",
)
def replace_privacy(
    payload: PrivacyUpdate,
    current_user: CandidateUser,
    session: DbSession,
) -> PrivacyRead:
    """Full state, not a patch.

    All five fields are required by the schema, so a caller cannot send a
    partial body and have the absent flags silently reset to their defaults.
    """

    privacy = svc.get_or_create_privacy(session, current_user.id)
    for field, value in payload.model_dump().items():
        setattr(privacy, field, value)
    session.add(privacy)
    session.commit()
    session.refresh(privacy)
    return svc.privacy_read(privacy)


# --- preferences ------------------------------------------------------------


@router.get(
    "/profile/preferences",
    response_model=PreferencesRead,
    summary="Read preferences",
)
def read_preferences(
    current_user: CandidateUser, session: DbSession
) -> PreferencesRead:
    """Read before writing â€” ``PUT`` here is full state, so an unconfigured
    account is ``null`` rather than an empty object, and the client is told to
    read first so it does not erase a real list."""

    preferences = session.get(ProfilePreferences, current_user.id)
    result = svc.preferences_read(preferences)
    if result is None:
        raise ApiError(
            status_code=404,
            code=ErrorCode.NOT_FOUND,
            message="You have not set your preferences yet.",
        )
    return result


@router.put(
    "/profile/preferences",
    response_model=PreferencesRead,
    summary="Replace preferences",
)
def replace_preferences(
    payload: PreferencesUpdate,
    current_user: CandidateUser,
    session: DbSession,
) -> PreferencesRead:
    """Full state, same rule as privacy. Creates the row on first write.

    The salary range was already validated by the schema, so this is only the
    write.
    """

    preferences = session.get(ProfilePreferences, current_user.id)
    if preferences is None:
        preferences = ProfilePreferences(user_id=current_user.id)
        session.add(preferences)

    for field, value in payload.model_dump().items():
        setattr(preferences, field, value)
    session.add(preferences)
    session.commit()
    session.refresh(preferences)
    return svc.preferences_read(preferences)


# --- skills -----------------------------------------------------------------


@router.get(
    "/profile/skills",
    response_model=Page[CandidateSkillRead],
    summary="List my skills",
)
def list_skills(
    current_user: CandidateUser,
    session: DbSession,
    paging: tuple[int, int] = Depends(page_params),
) -> Page[CandidateSkillRead]:
    limit, offset = paging
    total = svc.count_owned(session, UserSkill, current_user.id)
    rows = session.scalars(
        select(UserSkill)
        .options(selectinload(UserSkill.skill))
        .where(UserSkill.user_id == current_user.id)
        .order_by(UserSkill.created_at.desc(), UserSkill.id)
        .limit(limit)
        .offset(offset)
    )
    return build_page(
        [svc.candidate_skill_read(row) for row in rows], total, limit, offset
    )


@router.post(
    "/profile/skills",
    response_model=CandidateSkillRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add a catalogue skill",
)
def add_skill(
    payload: CandidateSkillCreate,
    current_user: CandidateUser,
    session: DbSession,
) -> CandidateSkillRead:
    """Attach a catalogue skill to my profile.

    The skill must already exist: the client picks it from ``/skills/catalog``, and
    a skill is a row with its own identity rather than free text, so a new name is
    not created here.

    Adding the same skill twice is a **409**, not a silent success. The database
    has ``UNIQUE (user_id, skill_id)``, and a 201 for a duplicate would leave the
    client showing a row that is not there.
    """

    skill_id = parse_id(payload.skill_id, "skill")
    skill = session.get(Skill, skill_id)
    if skill is None:
        raise ApiError(
            status_code=404,
            code=ErrorCode.NOT_FOUND,
            message="That skill is not in the catalogue.",
        )

    existing = session.scalar(
        select(UserSkill).where(
            UserSkill.user_id == current_user.id, UserSkill.skill_id == skill_id
        )
    )
    if existing is not None:
        raise ApiError(
            status_code=409,
            code=ErrorCode.CONFLICT,
            message="You have already added that skill.",
        )

    row = UserSkill(
        user_id=current_user.id,
        skill_id=skill_id,
        level=payload.level,
        years=payload.years,
        source=payload.source,
    )
    session.add(row)
    try:
        session.commit()
    except IntegrityError as exc:
        # Two taps in quick succession: the unique index is the real guard.
        session.rollback()
        raise ApiError(
            status_code=409,
            code=ErrorCode.CONFLICT,
            message="You have already added that skill.",
        ) from exc
    session.refresh(row)
    return svc.candidate_skill_read(row)


@router.patch(
    "/profile/skills/{skill_row_id}",
    response_model=CandidateSkillRead,
    summary="Update a skill level",
)
def update_skill(
    skill_row_id: str,
    payload: CandidateSkillUpdate,
    current_user: CandidateUser,
    session: DbSession,
) -> CandidateSkillRead:
    """Patch level and years.

    The id in the path is the **user_skills row**, not the catalogue skill â€” the
    mobile code passes back the `id` it received from the create response.
    """

    row_id = parse_id(skill_row_id, "skill")
    row = get_owned(session, UserSkill, row_id, current_user.id, "skill")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    session.add(row)
    session.commit()
    session.refresh(row)
    return svc.candidate_skill_read(row)


@router.delete(
    "/profile/skills/{skill_row_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a skill",
)
def remove_skill(
    skill_row_id: str, current_user: CandidateUser, session: DbSession
) -> Response:
    row_id = parse_id(skill_row_id, "skill")
    row = get_owned(session, UserSkill, row_id, current_user.id, "skill")
    session.delete(row)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- the four uniform sections ---------------------------------------------
#
# education, experience, certifications and achievements are the same contract:
# a paged list, a create, a patch and a delete, all scoped to the caller. They are
# generated from one factory rather than written four times, because four copies
# is four places for an ownership check to be forgotten. The mobile client
# generates its side of the same four the same way (`sectionApi` in
# `src/api/profile.ts`), so this is a mirror rather than an invention.
#
# Projects is NOT generated here: it carries `skill_ids[]`, so its create and
# patch are genuinely different and are written out below.


def _register_section(
    *,
    path: str,
    model,
    create_model,
    update_model,
    read_model,
    read,
    what: str,
    order_columns,
) -> None:
    """Attach list/create/patch/delete for one uniform section."""

    def _list(
        current_user: CandidateUser,
        session: DbSession,
        paging: tuple[int, int] = Depends(page_params),
    ):
        limit, offset = paging
        total = svc.count_owned(session, model, current_user.id)
        rows = session.scalars(
            select(model)
            .where(model.user_id == current_user.id)
            .order_by(*order_columns)
            .limit(limit)
            .offset(offset)
        )
        return build_page([read(row) for row in rows], total, limit, offset)

    def _create(
        payload,
        current_user: CandidateUser,
        session: DbSession,
    ):
        # The schema already checked the date rules; this is where a valid
        # payload becomes a row owned by the caller.
        row = model(user_id=current_user.id, **payload.model_dump())
        session.add(row)
        session.commit()
        session.refresh(row)
        return read(row)

    def _update(
        record_id: str,
        payload,
        current_user: CandidateUser,
        session: DbSession,
    ):
        row_id = parse_id(record_id, what)
        row = get_owned(session, model, row_id, current_user.id, what)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(row, field, value)
        session.add(row)
        session.commit()
        session.refresh(row)
        return read(row)

    def _delete(
        record_id: str, current_user: CandidateUser, session: DbSession
    ) -> Response:
        row_id = parse_id(record_id, what)
        row = get_owned(session, model, row_id, current_user.id, what)
        session.delete(row)
        session.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    # This module uses `from __future__ import annotations`, so annotations on the
    # closures above would be *strings* — and `create_model`, `update_model` and
    # `read_model` are local variables that do not exist when FastAPI later
    # evaluates those strings to work out the body model and the response schema.
    # Assigning the real classes onto `__annotations__` here is what lets the same
    # factory serve four sections; without it every generated route is a
    # `NameError` at import time.
    #
    # The *alias* objects (`CandidateUser`, `DbSession`) are used rather than the
    # bare `User`/`Session` classes on purpose: the aliases carry the `Depends(...)`
    # inside them, so this is what actually wires authentication and the database
    # session into every generated route.
    _list.__annotations__ = {
        "current_user": CandidateUser,
        "session": DbSession,
        "paging": tuple[int, int],
        "return": Page[read_model],
    }
    _create.__annotations__ = {
        "payload": create_model,
        "current_user": CandidateUser,
        "session": DbSession,
        "return": read_model,
    }
    _update.__annotations__ = {
        "record_id": str,
        "payload": update_model,
        "current_user": CandidateUser,
        "session": DbSession,
        "return": read_model,
    }
    _delete.__annotations__ = {
        "record_id": str,
        "current_user": CandidateUser,
        "session": DbSession,
        "return": Response,
    }
    # The dependency wiring (`Depends(...)` inside the `Annotated` aliases, and the
    # `paging` default) is already on the function objects; only the annotations —
    # which `from __future__ import annotations` turned into strings — needed
    # fixing.

    router.add_api_route(
        f"/profile/{path}",
        _list,
        methods=["GET"],
        response_model=Page[read_model],
        name=f"list_{path}",
        summary=f"List my {path}",
    )
    router.add_api_route(
        f"/profile/{path}",
        _create,
        methods=["POST"],
        response_model=read_model,
        status_code=status.HTTP_201_CREATED,
        name=f"create_{path}",
        summary=f"Add a {what} entry",
    )
    router.add_api_route(
        f"/profile/{path}/{{record_id}}",
        _update,
        methods=["PATCH"],
        response_model=read_model,
        name=f"update_{path}",
        summary=f"Update a {what} entry",
    )
    router.add_api_route(
        f"/profile/{path}/{{record_id}}",
        _delete,
        methods=["DELETE"],
        status_code=status.HTTP_204_NO_CONTENT,
        name=f"delete_{path}",
        summary=f"Delete a {what} entry",
    )


_register_section(
    path="education",
    model=Education,
    create_model=EducationCreate,
    update_model=EducationUpdate,
    read_model=EducationRead,
    read=svc.education_read,
    what="education",
    order_columns=(svc._nulls_last(Education.start_date), Education.id),
)
_register_section(
    path="experience",
    model=Experience,
    create_model=ExperienceCreate,
    update_model=ExperienceUpdate,
    read_model=ExperienceRead,
    read=svc.experience_read,
    what="experience",
    order_columns=(svc._nulls_last(Experience.start_date), Experience.id),
)
_register_section(
    path="certifications",
    model=Certification,
    create_model=CertificationCreate,
    update_model=CertificationUpdate,
    read_model=CertificationRead,
    read=svc.certification_read,
    what="certification",
    order_columns=(
        svc._nulls_last(Certification.issued_on),
        Certification.id,
    ),
)
_register_section(
    path="achievements",
    model=Achievement,
    create_model=AchievementCreate,
    update_model=AchievementUpdate,
    read_model=AchievementRead,
    read=svc.achievement_read,
    what="achievement",
    order_columns=(svc._nulls_last(Achievement.achieved_on), Achievement.id),
)


# --- projects ---------------------------------------------------------------
#
# Written out rather than generated, because projects carry `skill_ids[]`: the
# skill set has to be resolved against the catalogue and rewritten, which the
# uniform factory above has no notion of.


def _resolve_project_skill_ids(session: DbSession, skill_ids: list[str]) -> list[UUID]:
    """Prove every catalogue id exists, or answer 404. Writes nothing.

    Split out from the write so it can run *before* a project is created: an
    unknown id must not leave a half-created row behind. Duplicates are collapsed
    here too, because the composite primary key on ``project_skills`` would
    otherwise turn a client that sent the same id twice into a 500.
    """

    unique_ids = list(dict.fromkeys(parse_id(raw, "skill") for raw in skill_ids))
    if not unique_ids:
        return []

    found = set(session.scalars(select(Skill.id).where(Skill.id.in_(unique_ids))))
    missing = [raw for raw in unique_ids if raw not in found]
    if missing:
        raise ApiError(
            status_code=404,
            code=ErrorCode.NOT_FOUND,
            message="One of those skills is not in the catalogue.",
        )
    return unique_ids


def _set_project_skills(project: Project, skill_ids: list[UUID]) -> None:
    """Replace a project's skill links with the given catalogue ids.

    The *collection* is edited rather than the rows deleted by hand, because
    ``Project.skills`` is ``delete-orphan`` — the collection is the authority on
    what exists. Deleting rows behind its back leaves stale instances loaded in
    it, and the next ``session.add(project)`` re-saves one SQLAlchemy has already
    deleted. Editing the collection is also the only version where an empty list
    actually clears the project instead of being read as "nothing to do".
    """

    project.skills.clear()
    for skill_id in skill_ids:
        project.skills.append(ProjectSkill(skill_id=skill_id))


@router.get(
    "/profile/projects",
    response_model=Page[ProjectRead],
    summary="List my projects",
)
def list_projects(
    current_user: CandidateUser,
    session: DbSession,
    paging: tuple[int, int] = Depends(page_params),
) -> Page[ProjectRead]:
    limit, offset = paging
    total = svc.count_owned(session, Project, current_user.id)
    rows = session.scalars(
        select(Project)
        .options(selectinload(Project.skills).selectinload(ProjectSkill.skill))
        .where(Project.user_id == current_user.id)
        .order_by(svc._nulls_last(Project.start_date), Project.id)
        .limit(limit)
        .offset(offset)
    )
    return build_page(
        [svc.project_read(row) for row in rows], total, limit, offset
    )


@router.post(
    "/profile/projects",
    response_model=ProjectRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add a project",
)
def create_project(
    payload: ProjectCreate,
    current_user: CandidateUser,
    session: DbSession,
) -> ProjectRead:
    """Create a project, optionally tagged with catalogue skills.

    The date rule already ran as a schema validator, so an inverted range arrived
    as a 422 before reaching this function.
    """

    data = payload.model_dump()
    skill_ids = data.pop("skill_ids", [])
    # Prove the catalogue ids before anything is written, so a bad one leaves no
    # half-created project behind for the list to report.
    resolved = _resolve_project_skill_ids(session, skill_ids)

    project = Project(user_id=current_user.id, **data)
    session.add(project)
    session.flush()  # assign the id before the join rows reference it
    _set_project_skills(project, resolved)
    session.commit()
    session.refresh(project)
    return svc.project_read(project)


@router.patch(
    "/profile/projects/{project_id}",
    response_model=ProjectRead,
    summary="Update a project",
)
def update_project(
    project_id: str,
    payload: ProjectUpdate,
    current_user: CandidateUser,
    session: DbSession,
) -> ProjectRead:
    """Patch a project.

    ``skill_ids`` is replaced wholesale when present and left alone when absent,
    which is the ``exclude_unset`` rule applied to a collection.
    """

    row_id = parse_id(project_id, "project")
    project = get_owned(session, Project, row_id, current_user.id, "project")

    changes = payload.model_dump(exclude_unset=True)
    skill_ids = changes.pop("skill_ids", None)
    # Resolve before touching the row: a bad catalogue id must leave it exactly
    # as it was rather than half-applied.
    resolved = (
        None
        if skill_ids is None
        else _resolve_project_skill_ids(session, skill_ids)
    )

    for field, value in changes.items():
        setattr(project, field, value)
    if resolved is not None:
        _set_project_skills(project, resolved)

    session.add(project)
    session.commit()
    session.refresh(project)
    return svc.project_read(project)


@router.delete(
    "/profile/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a project",
)
def delete_project(
    project_id: str, current_user: CandidateUser, session: DbSession
) -> Response:
    """Delete a project and its skill links.

    ``project_skills`` is ``ON DELETE CASCADE``, so no join row is left pointing
    at a project that no longer exists.
    """

    row_id = parse_id(project_id, "project")
    project = get_owned(session, Project, row_id, current_user.id, "project")
    session.delete(project)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
