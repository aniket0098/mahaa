"""Phase 1 database foundation â€” model and constraint tests.

These assert the behaviour the *database* promises, not the behaviour the ORM
hopes for. Where a test is about a constraint it asserts that the write is
refused, because that is the guarantee a later phase will rely on when two
requests race.

Rejections go through ``assert_rejected`` / ``assert_delete_rejected`` from
``conftest`` rather than a bare ``pytest.raises``: a savepoint rollback undoes
the row but leaves the object pending, so without discarding it the next flush
retries the same bad write and fails outside the assertion.

No API endpoint is tested here; that belongs to the later phases.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, UTC

from sqlalchemy.orm import Session

from app.models import (
    Achievement,
    AchievementCategory,
    Certification,
    Education,
    EducationLevel,
    Experience,
    Profile,
    ProfileLink,
    ProfilePreferences,
    ProfilePrivacy,
    ProfileVisibility,
    Project,
    ProjectSkill,
    Skill,
    SkillLevel,
    User,
    UserRole,
    UserSkill,
    WorkMode,
)
from conftest import assert_delete_rejected, assert_rejected

# ---------------------------------------------------------------------------
# users
# ---------------------------------------------------------------------------


def test_user_is_persisted_with_defaults(db_session: Session, user_factory) -> None:
    """A user round-trips, and the database supplies the unspecified fields."""

    user = user_factory()
    db_session.commit()

    stored = db_session.get(User, user.id)
    assert stored is not None
    assert stored.email == user.email
    assert stored.role == UserRole.CANDIDATE
    assert stored.status == "active"
    assert stored.phone is None
    assert stored.designation is None
    assert stored.avatar_media_id is None


def test_user_id_is_a_generated_uuid(db_session: Session, user_factory) -> None:
    """The primary key is a UUID minted by the application, never an integer."""

    user = user_factory()

    assert isinstance(user.id, uuid.UUID)
    assert user.id.version == 4
    assert user_factory().id != user.id


def test_user_timestamps_are_timezone_aware(db_session: Session, user_factory) -> None:
    """``timestamptz``, not a naive timestamp.

    A naive value silently means different instants in different sessions, which
    is why the schema forbids it rather than trusting callers.

    The offset is *aware*, not necessarily UTC: psycopg renders a ``timestamptz``
    in the session's own zone, and the instant is the same either way. What would
    be wrong is ``tzinfo is None``, the case where the instant is ambiguous.
    """

    user = user_factory()
    db_session.commit()
    db_session.refresh(user)

    assert isinstance(user.created_at, datetime)
    assert user.created_at.tzinfo is not None
    assert user.created_at.utcoffset() is not None
    assert isinstance(user.updated_at, datetime)
    assert user.updated_at.tzinfo is not None


def test_email_uniqueness_is_case_insensitive(db_session: Session) -> None:
    """``citext`` is why this is a database guarantee and not a convention.

    ``Alice@example.test`` and ``alice@example.test`` are one account. An
    application-level check would only be correct for whichever casing it
    happened to receive.
    """

    db_session.add(
        User(
            public_id="MJ-CASE0001",
            username="case_user",
            email="Alice@Example.test",
            name="Alice",
            password_hash="x",
        )
    )
    db_session.commit()

    assert_rejected(
        db_session,
        User(
            public_id="MJ-CASE0002",
            username="case_user_2",
            email="alice@example.test",
            name="Alice Again",
            password_hash="x",
        ),
    )


def test_public_id_is_unique(db_session: Session) -> None:
    """The permanent public handle is unique, and no endpoint may change it."""

    db_session.add(
        User(
            public_id="MJ-DUP00001",
            username="dup_user",
            email="dup1@example.test",
            name="First",
            password_hash="x",
        )
    )
    db_session.commit()

    assert_rejected(
        db_session,
        User(
            public_id="MJ-DUP00001",
            username="dup_user_other",
            email="dup2@example.test",
            name="Second",
            password_hash="x",
        ),
    )


def test_username_is_unique(db_session: Session) -> None:
    """The searchable handle is unique.

    Split from the ``public_id`` test on purpose: a session that has just seen a
    rejected write is in a "pending rollback" state, so a second expected
    rejection in the same test cannot be attempted without rolling back the
    first. One rejection per test keeps each assertion honest.
    """

    db_session.add(
        User(
            public_id="MJ-DUP00011",
            username="dup_handle",
            email="dup3@example.test",
            name="First",
            password_hash="x",
        )
    )
    db_session.commit()

    assert_rejected(
        db_session,
        User(
            public_id="MJ-DUP00012",
            username="dup_handle",
            email="dup4@example.test",
            name="Second",
            password_hash="x",
        ),
    )


def test_invalid_role_is_rejected(db_session: Session) -> None:
    """The role vocabulary is closed, not a convention."""

    assert_rejected(
        db_session,
        User(
            public_id="MJ-BADROLE1",
            username="bad_role",
            email="bad_role@example.test",
            name="Bad Role",
            password_hash="x",
            role="superuser",
        ),
    )


def test_invalid_status_is_rejected(db_session: Session, user_factory) -> None:
    user = user_factory()
    user.status = "hibernating"
    assert_rejected(db_session, user)


# ---------------------------------------------------------------------------
# profiles
# ---------------------------------------------------------------------------


def test_profile_belongs_to_a_user_one_to_one(
    db_session: Session, user_factory
) -> None:
    user = user_factory()
    db_session.add(Profile(user_id=user.id, headline="Backend engineer"))
    db_session.commit()

    assert db_session.get(Profile, user.id) is not None
    assert user.profile is not None
    assert user.profile.headline == "Backend engineer"
    assert user.profile.user is user


def test_a_second_profile_for_one_user_is_impossible(
    db_session: Session, user_factory
) -> None:
    """``user_id`` is the primary key, so this cannot be expressed twice."""

    user = user_factory()
    db_session.add(Profile(user_id=user.id, headline="First"))
    db_session.commit()

    assert_rejected(db_session, Profile(user_id=user.id, headline="Second"))


def test_profile_privacy_defaults_to_private_and_not_discoverable(
    db_session: Session, user_factory
) -> None:
    """A new account is private by default, and every flag is non-null.

    A nullable privacy flag is NULL on the first read and every service then has
    to guess what "unknown" means â€” which is how a private profile leaks.
    """

    user = user_factory()
    db_session.add(ProfilePrivacy(user_id=user.id))
    db_session.commit()

    stored = db_session.get(ProfilePrivacy, user.id)
    assert stored is not None
    assert stored.profile_visibility == ProfileVisibility.PRIVATE
    assert stored.discoverable is False
    assert stored.allow_messages is True
    assert stored.show_email is False
    assert stored.show_phone is False


def test_invalid_profile_visibility_is_rejected(
    db_session: Session, user_factory
) -> None:
    user = user_factory()
    assert_rejected(
        db_session,
        ProfilePrivacy(user_id=user.id, profile_visibility="everyone"),
    )


def test_profile_preferences_absent_means_never_set(
    db_session: Session, user_factory
) -> None:
    """No preferences row is a valid state, distinct from an empty one.

    The mobile aggregate types preferences as ``| null`` for exactly this.
    """

    user = user_factory()
    db_session.commit()

    assert db_session.get(ProfilePreferences, user.id) is None

    db_session.add(
        ProfilePreferences(
            user_id=user.id,
            work_modes=[WorkMode.REMOTE.value],
            preferred_locations=["Bengaluru"],
            salary_min=500000,
            salary_max=900000,
        )
    )
    db_session.commit()
    assert db_session.get(ProfilePreferences, user.id) is not None


def test_salary_range_must_be_ordered(db_session: Session, user_factory) -> None:
    user = user_factory()
    assert_rejected(
        db_session,
        ProfilePreferences(user_id=user.id, salary_min=900000, salary_max=500000),
    )


def test_profile_link_belongs_to_a_user(db_session: Session, user_factory) -> None:
    """A user may hold one link per network, and several networks."""

    user = user_factory()
    db_session.add_all(
        [
            ProfileLink(user_id=user.id, kind="github", label="gh", url="https://gh/x"),
            ProfileLink(
                user_id=user.id, kind="linkedin", label="in", url="https://in/x"
            ),
        ]
    )
    db_session.commit()

    assert user.links[0].url == "https://gh/x"
    assert len(user.links) == 2


def test_profile_link_is_unique_per_network(db_session: Session, user_factory) -> None:
    """The client edits a link rather than listing five GitHub URLs."""

    user = user_factory()
    db_session.add(
        ProfileLink(user_id=user.id, kind="github", label="gh", url="https://gh/x")
    )
    db_session.commit()

    assert_rejected(
        db_session,
        ProfileLink(user_id=user.id, kind="github", label="gh2", url="https://gh/y"),
    )


# ---------------------------------------------------------------------------
# skills
# ---------------------------------------------------------------------------


def test_skill_catalogue_name_is_unique(db_session: Session) -> None:
    db_session.add(Skill(name="Python", category="language"))
    db_session.commit()

    assert_rejected(db_session, Skill(name="Python", category="language"))


def test_user_skill_association_and_duplicate_is_rejected(
    db_session: Session, user_factory
) -> None:
    user = user_factory()
    skill = Skill(name="Python", category="language")
    db_session.add(skill)
    db_session.flush()

    db_session.add(
        UserSkill(
            user_id=user.id,
            skill_id=skill.id,
            level=SkillLevel.ADVANCED,
            source="self",
        )
    )
    db_session.commit()

    assert user.skills[0].skill is skill
    assert user.skills[0].verified is False
    assert user.skills[0].years is None

    # The same skill cannot be claimed twice by one user.
    assert_rejected(
        db_session,
        UserSkill(
            user_id=user.id,
            skill_id=skill.id,
            level=SkillLevel.BEGINNER,
            source="self",
        ),
    )


def test_the_same_skill_may_be_claimed_by_two_users(
    db_session: Session, user_factory
) -> None:
    """Uniqueness is per pair, not per skill."""

    skill = Skill(name="SQL")
    db_session.add(skill)
    db_session.flush()

    first, second = user_factory(), user_factory()
    db_session.add_all(
        [
            UserSkill(
                user_id=first.id,
                skill_id=skill.id,
                level=SkillLevel.INTERMEDIATE,
                source="self",
            ),
            UserSkill(
                user_id=second.id,
                skill_id=skill.id,
                level=SkillLevel.EXPERT,
                source="self",
            ),
        ]
    )
    db_session.commit()
    assert len(db_session.query(UserSkill).all()) == 2


def test_invalid_skill_level_is_rejected(db_session: Session, user_factory) -> None:
    user = user_factory()
    skill = Skill(name="Rust")
    db_session.add(skill)
    db_session.flush()

    assert_rejected(
        db_session,
        UserSkill(user_id=user.id, skill_id=skill.id, level="wizard", source="self"),
    )


# ---------------------------------------------------------------------------
# education
# ---------------------------------------------------------------------------


def test_education_belongs_to_a_user(db_session: Session, user_factory) -> None:
    user = user_factory()
    db_session.add(
        Education(
            user_id=user.id,
            institution="IIT Madras",
            degree="B.Tech",
            level=EducationLevel.UNDERGRADUATE,
            start_date=date(2019, 8, 1),
            current=True,
        )
    )
    db_session.commit()

    assert user.education[0].institution == "IIT Madras"
    assert user.education[0].level == EducationLevel.UNDERGRADUATE


def test_education_dates_must_be_ordered(db_session: Session, user_factory) -> None:
    user = user_factory()
    assert_rejected(
        db_session,
        Education(
            user_id=user.id,
            institution="Bad",
            start_date=date(2023, 1, 1),
            end_date=date(2020, 1, 1),
        ),
    )


def test_current_education_must_be_open_ended(
    db_session: Session, user_factory
) -> None:
    """``current = true`` with a past end date is always an entry mistake."""

    user = user_factory()
    assert_rejected(
        db_session,
        Education(
            user_id=user.id,
            institution="Done",
            start_date=date(2015, 1, 1),
            end_date=date(2019, 1, 1),
            current=True,
        ),
    )


# ---------------------------------------------------------------------------
# experience
# ---------------------------------------------------------------------------


def test_experience_belongs_to_a_user(db_session: Session, user_factory) -> None:
    user = user_factory()
    db_session.add(
        Experience(
            user_id=user.id,
            title="Engineer",
            company_name="Acme",
            work_mode=WorkMode.HYBRID,
            start_date=date(2021, 6, 1),
            current=True,
        )
    )
    db_session.commit()

    assert user.experience[0].company_name == "Acme"
    assert user.experience[0].work_mode == WorkMode.HYBRID


def test_experience_dates_must_be_ordered(db_session: Session, user_factory) -> None:
    user = user_factory()
    assert_rejected(
        db_session,
        Experience(
            user_id=user.id,
            title="Engineer",
            company_name="Acme",
            start_date=date(2023, 1, 1),
            end_date=date(2021, 1, 1),
        ),
    )


# ---------------------------------------------------------------------------
# projects
# ---------------------------------------------------------------------------


def test_project_belongs_to_a_user(db_session: Session, user_factory) -> None:
    user = user_factory()
    db_session.add(
        Project(
            user_id=user.id,
            title="Mahaa",
            description="The platform",
            role="Author",
        )
    )
    db_session.commit()

    assert user.projects[0].title == "Mahaa"


def test_project_skills_carry_the_skill_name(db_session: Session, user_factory) -> None:
    """The join table exists so a project can return ``{skill_id, name}``.

    This is the reason ``project_skills`` is a table and not a ``text[]`` column.
    """

    user = user_factory()
    python = Skill(name="Python")
    fastapi = Skill(name="FastAPI")
    db_session.add_all([python, fastapi])
    db_session.flush()

    project = Project(user_id=user.id, title="Mahaa")
    db_session.add(project)
    db_session.flush()
    db_session.add_all(
        [
            ProjectSkill(project_id=project.id, skill_id=python.id),
            ProjectSkill(project_id=project.id, skill_id=fastapi.id),
        ]
    )
    db_session.commit()
    db_session.refresh(project)

    names = {link.skill.name for link in project.skills}
    assert names == {"Python", "FastAPI"}


def test_a_project_cannot_list_the_same_skill_twice(
    db_session: Session, user_factory
) -> None:
    user = user_factory()
    skill = Skill(name="Go")
    db_session.add(skill)
    db_session.flush()

    project = Project(user_id=user.id, title="Dup")
    db_session.add(project)
    db_session.flush()
    db_session.add(ProjectSkill(project_id=project.id, skill_id=skill.id))
    db_session.commit()

    assert_rejected(db_session, ProjectSkill(project_id=project.id, skill_id=skill.id))


# ---------------------------------------------------------------------------
# certifications
# ---------------------------------------------------------------------------


def test_certification_belongs_to_a_user(db_session: Session, user_factory) -> None:
    user = user_factory()
    db_session.add(
        Certification(
            user_id=user.id,
            title="AWS Solutions Architect",
            issuer="Amazon",
            issued_on=date(2022, 3, 1),
        )
    )
    db_session.commit()

    assert user.certifications[0].issuer == "Amazon"


def test_a_certificate_cannot_expire_before_it_was_issued(
    db_session: Session, user_factory
) -> None:
    user = user_factory()
    assert_rejected(
        db_session,
        Certification(
            user_id=user.id,
            title="Impossible",
            issuer="Nobody",
            issued_on=date(2022, 1, 1),
            expires_on=date(2021, 1, 1),
        ),
    )


# ---------------------------------------------------------------------------
# achievements
# ---------------------------------------------------------------------------


def test_achievement_belongs_to_a_user(db_session: Session, user_factory) -> None:
    user = user_factory()
    db_session.add(
        Achievement(
            user_id=user.id,
            title="Smart India Hackathon - winner",
            category=AchievementCategory.HACKATHON,
        )
    )
    db_session.commit()

    assert user.achievements[0].category == AchievementCategory.HACKATHON


def test_achievement_category_is_required(db_session: Session, user_factory) -> None:
    """The mobile contract requires one of six values on create."""

    user = user_factory()
    assert_rejected(db_session, Achievement(user_id=user.id, title="No category"))


def test_invalid_achievement_category_is_rejected(
    db_session: Session, user_factory
) -> None:
    user = user_factory()
    assert_rejected(
        db_session,
        Achievement(user_id=user.id, title="Odd", category="participation"),
    )


# ---------------------------------------------------------------------------
# ownership, cascade and round-trips
# ---------------------------------------------------------------------------


def test_sections_cannot_outlive_their_user(db_session: Session) -> None:
    """A profile row pointing at nobody is rejected by the foreign key."""

    assert_rejected(db_session, Education(user_id=uuid.uuid4(), institution="Orphan"))


def test_deleting_a_user_removes_their_profile_sections(
    db_session: Session, user_factory
) -> None:
    """CASCADE is for true children, and these are true children.

    Deleting a *user* is never cascaded towards other users; this is only the
    owned section rows following their owner.
    """

    user = user_factory()
    db_session.add_all(
        [
            Profile(user_id=user.id, headline="Temp"),
            Education(user_id=user.id, institution="Temp"),
            Experience(user_id=user.id, title="Temp", company_name="Temp"),
        ]
    )
    db_session.commit()

    db_session.delete(user)
    db_session.commit()

    assert db_session.query(Education).filter_by(user_id=user.id).count() == 0
    assert db_session.query(Profile).filter_by(user_id=user.id).count() == 0


def test_a_claimed_skill_cannot_be_deleted(db_session: Session, user_factory) -> None:
    """``RESTRICT`` on the skill FK: a referenced catalogue entry stays put."""

    user = user_factory()
    skill = Skill(name="Kubernetes")
    db_session.add(skill)
    db_session.flush()
    db_session.add(
        UserSkill(
            user_id=user.id,
            skill_id=skill.id,
            level=SkillLevel.INTERMEDIATE,
            source="self",
        )
    )
    db_session.commit()

    assert_delete_rejected(db_session, skill)


def test_timestamps_survive_a_raw_round_trip(db_session: Session, user_factory) -> None:
    """A timestamp read back keeps an aware offset, not a naive local time.

    ``timestamptz`` is rendered in the session's zone, so the assertion is that
    the value is offset-aware and denotes an instant at or before now â€” not that
    it is pinned to UTC.
    """

    user = user_factory()
    db_session.commit()

    row = db_session.execute(
        User.__table__.select().where(User.__table__.c.id == user.id)
    ).one()
    created = row.created_at
    assert created.tzinfo is not None
    assert created.utcoffset() is not None
    assert created <= datetime.now(UTC)
