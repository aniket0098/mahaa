"""Profile read and write models â€” mirrors ``src/types/profile.ts`` field for field.

Every field here exists in the mobile client and none is invented. The two
conventions that are load-bearing:

* ``extra="forbid"`` on every write model. A client that sends a field the server
  does not understand gets a 422 instead of having it silently dropped, which is
  how "my change had no effect" bugs start.
* ``page=`` is a read model, not a dump of the table. It carries exactly the
  fields ``Me`` declares, so ``password_hash`` has no way to appear: the read
  model cannot express it.

Dates are serialised as ISO-8601 strings rather than ``date`` objects. The client
types them ``string | null`` and does its own formatting, and handing it a JSON
date object would be a shape it does not expect.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from app.models.enums import (
    AchievementCategory,
    EducationLevel,
    ProfileVisibility,
    SkillLevel,
    WorkMode,
)
from app.schemas.auth import MeResponse
from app.schemas.common import Page


def _iso(value: date | datetime | None) -> str | None:
    """ISO-8601, or ``None``.

    Written out rather than relying on Pydantic's date serialisation because the
    client declares these as ``string`` and a bare ``date`` would arrive as
    ``"2024-01-31"`` while a ``datetime`` would carry a time and offset the
    client's formatter does not expect.
    """

    return value.isoformat() if value is not None else None


# --- identity ---------------------------------------------------------------


class IdentityRead(BaseModel):
    """``GET /profile`` â†’ ``identity``."""

    user_id: str
    public_id: str
    name: str
    email: str
    phone: str | None = None
    avatar_url: str | None = None
    headline: str | None = None
    summary: str | None = None
    location: str | None = None
    interests: list[str] = Field(default_factory=list)
    profile_updated_at: str


class ProfileIdentityUpdate(BaseModel):
    """``PATCH /profile`` â€” the four identity text fields, nothing else.

    ``exclude_unset`` is what makes this a PATCH: a field the caller did not send
    is left alone, so a form that submits only ``headline`` does not blank the
    summary. Sending ``null`` explicitly *does* clear the field.
    """

    model_config = ConfigDict(extra="forbid")

    headline: str | None = Field(default=None, max_length=200)
    summary: str | None = Field(default=None, max_length=5000)
    location: str | None = Field(default=None, max_length=200)
    interests: list[str] | None = None

    @field_validator("interests")
    @classmethod
    def _interests_are_bounded(cls, value: list[str] | None) -> list[str] | None:
        """Bounded because it is an unbounded free-text array in the database.

        Without a ceiling a single request could store an arbitrary number of
        entries in one column, and the client renders all of them.
        """

        if value is None:
            return None
        if len(value) > 25:
            raise ValueError("You can list at most 25 interests.")
        cleaned = [item.strip() for item in value if item.strip()]
        if any(len(item) > 80 for item in cleaned):
            raise ValueError("Each interest must be 80 characters or fewer.")
        return cleaned


# --- privacy & preferences --------------------------------------------------


class PrivacyRead(BaseModel):
    """``GET /profile/privacy``.

    ``profile_visibility`` is narrowed to the three-value enum rather than
    ``str``, so a read can be handed straight back to the ``PUT`` with no cast.
    """

    profile_visibility: ProfileVisibility
    discoverable: bool
    allow_messages: bool
    show_email: bool
    show_phone: bool
    updated_at: str


class PrivacyUpdate(BaseModel):
    """``PUT /profile/privacy`` â€” **full state**, never a patch.

    Every field is required, so a caller must state all five rather than have
    absent ones silently reset to a default. The spec calls this out explicitly:
    "read before write or the flags are erased".
    """

    model_config = ConfigDict(extra="forbid")

    profile_visibility: ProfileVisibility
    discoverable: bool
    allow_messages: bool
    show_email: bool
    show_phone: bool


class PreferencesRead(BaseModel):
    """``GET /profile/preferences``."""

    work_modes: list[str] = Field(default_factory=list)
    employment_types: list[str] = Field(default_factory=list)
    preferred_locations: list[str] = Field(default_factory=list)
    salary_min: int | None = None
    salary_max: int | None = None
    currency: str
    availability_date: str | None = None
    willing_to_relocate: bool
    updated_at: str


class PreferencesUpdate(BaseModel):
    """``PUT /profile/preferences`` â€” full state, same reasoning as privacy."""

    model_config = ConfigDict(extra="forbid")

    work_modes: list[WorkMode] = Field(default_factory=list)
    employment_types: list[str] = Field(default_factory=list)
    preferred_locations: list[str] = Field(default_factory=list)
    salary_min: int | None = Field(default=None, ge=0)
    salary_max: int | None = Field(default=None, ge=0)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    availability_date: date | None = None
    willing_to_relocate: bool = False

    @field_validator("currency")
    @classmethod
    def _currency_is_a_code(cls, value: str) -> str:
        # The column is VARCHAR(3); an ISO-4217 code is the only thing that fits,
        # and uppercasing here means "inr" and "INR" are one stored value.
        return value.upper()

    def check_salary_order(self) -> Self:
        """Raise a validation error if the range is inverted.

        The database has the same ``CHECK``; this is the friendly version, and it
        runs as a *validator* so an inverted range arrives as a 422 naming the
        field rather than a 500 from a constraint failure.

        It must return ``self``: a ``model_validator(mode="after")`` that returns
        ``None`` makes ``model_validate`` yield ``None``, which is exactly how a
        valid ``PUT`` body ends up as a 500 inside the route.
        """

        if (
            self.salary_min is not None
            and self.salary_max is not None
            and self.salary_max < self.salary_min
        ):
            raise ValueError(
                "salary_max must be greater than or equal to salary_min."
            )
        return self

    _salary_order = model_validator(mode="after")(check_salary_order)


class CompletenessSection(BaseModel):
    """One weighted section of the completion calculation."""

    key: str
    label: str
    weight: int
    earned: int
    complete: bool
    hint: str


class Completeness(BaseModel):
    """``GET /profile/completeness`` — always server-derived.

    There is no stored percentage anywhere: the number is computed from real
    rows on every read, so it cannot go stale after a profile edit.
    """

    percent: int
    sections: list[CompletenessSection]


# --- skills -----------------------------------------------------------------


class SkillCatalogItem(BaseModel):
    """``GET /skills/catalog`` â€” a catalogue row, never a client-side list."""

    id: str
    name: str
    category: str | None = None


class CandidateSkillCreate(BaseModel):
    """``POST /profile/skills``.

    ``skill_id`` must already exist in the catalogue: the client picks it from
    ``/skills/catalog``, and a skill is a row with its own identity rather than
    free text. ``level`` is required because the column is NOT NULL.
    """

    model_config = ConfigDict(extra="forbid")

    skill_id: str
    level: SkillLevel
    years: float | None = Field(default=None, ge=0, le=80)
    #: Where the claim came from, e.g. "self". The mobile create type leaves it
    #: optional; the column is NOT NULL, so a default stands in when it is absent.
    source: str = Field(default="self", max_length=50)


class CandidateSkillUpdate(BaseModel):
    """``PATCH /profile/skills/{id}`` â€” level and years only.

    ``skill_id`` is deliberately absent: changing which catalogue skill a row
    points at is a different operation, and allowing it here would bypass the
    duplicate check the create path makes.
    """

    model_config = ConfigDict(extra="forbid")

    level: SkillLevel | None = None
    years: float | None = Field(default=None, ge=0, le=80)


class CandidateSkillRead(BaseModel):
    """``CandidateSkillRead`` â€” the join row plus the catalogue name."""

    id: str
    skill_id: str
    name: str
    category: str | None = None
    level: str
    years: float | None = None
    verified: bool
    source: str
    created_at: str
    updated_at: str


# --- education --------------------------------------------------------------


class EducationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    institution: str = Field(min_length=1, max_length=200)
    degree: str | None = Field(default=None, max_length=200)
    field_of_study: str | None = Field(default=None, max_length=200)
    level: EducationLevel | None = None
    start_date: date | None = None
    end_date: date | None = None
    current: bool = False
    grade: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=5000)

    def check_dates(self) -> Self:
        """Ordered range, and ``current`` means open-ended.

        Both are also database CHECKs (``education_dates_ordered`` and
        ``education_current_is_open``). This runs as a *validator* so a bad range
        arrives as a 422 that names the field, which is what the form can render —
        rather than a 500 from a constraint violation raised inside a route.

        Returns ``self`` because a ``mode="after"`` validator's return value *is*
        the validated object; returning ``None`` would turn every valid body into
        ``None`` for ``EducationCreate``, ``ExperienceCreate`` and ``ProjectCreate``,
        which all share this function.
        """

        if (
            self.start_date is not None
            and self.end_date is not None
            and self.end_date < self.start_date
        ):
            raise ValueError("end_date cannot be before start_date.")
        # `current` exists on education and experience but not on projects, which
        # shares this check. Reading it through `getattr` keeps one rule in one
        # place instead of a second copy that would drift.
        if getattr(self, "current", False) and self.end_date is not None:
            raise ValueError("A current entry cannot have an end_date.")
        return self

    _dates = model_validator(mode="after")(check_dates)


class EducationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    institution: str | None = Field(default=None, min_length=1, max_length=200)
    degree: str | None = Field(default=None, max_length=200)
    field_of_study: str | None = Field(default=None, max_length=200)
    level: EducationLevel | None = None
    start_date: date | None = None
    end_date: date | None = None
    current: bool | None = None
    grade: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=5000)


class EducationRead(BaseModel):
    id: str
    institution: str
    degree: str | None = None
    field_of_study: str | None = None
    level: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    current: bool
    grade: str | None = None
    description: str | None = None
    created_at: str
    updated_at: str


# --- experience -------------------------------------------------------------


class ExperienceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    company_name: str = Field(min_length=1, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    work_mode: WorkMode | None = None
    start_date: date | None = None
    end_date: date | None = None
    current: bool = False
    description: str | None = Field(default=None, max_length=5000)

    #: Same two rules as education, same reason: a reversed range or a "current"
    #: role with a closed end date is always an entry mistake, and both break any
    #: duration the client shows.
    check_dates = EducationCreate.check_dates
    _dates = model_validator(mode="after")(check_dates)


class ExperienceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    company_name: str | None = Field(default=None, min_length=1, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    work_mode: WorkMode | None = None
    start_date: date | None = None
    end_date: date | None = None
    current: bool | None = None
    description: str | None = Field(default=None, max_length=5000)


class ExperienceRead(BaseModel):
    id: str
    title: str
    company_name: str
    location: str | None = None
    work_mode: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    current: bool
    description: str | None = None
    created_at: str
    updated_at: str


# --- projects ---------------------------------------------------------------


class ProjectSkillRef(BaseModel):
    """One resolved catalogue skill on a project."""

    skill_id: str
    name: str


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    role: str | None = Field(default=None, max_length=120)
    start_date: date | None = None
    end_date: date | None = None
    source_url: str | None = Field(default=None, max_length=2000)
    live_url: str | None = Field(default=None, max_length=2000)
    #: Catalogue ids, resolved on create. The composite primary key on
    #: ``project_skills`` makes a repeat harmless; duplicates are dropped here so
    #: the request is not a 500 because the client sent the same id twice.
    skill_ids: list[str] = Field(default_factory=list)

    check_dates = EducationCreate.check_dates
    _dates = model_validator(mode="after")(check_dates)


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    role: str | None = Field(default=None, max_length=120)
    start_date: date | None = None
    end_date: date | None = None
    source_url: str | None = Field(default=None, max_length=2000)
    live_url: str | None = Field(default=None, max_length=2000)
    #: When present, **replaces** the project's skill set. Absent means "leave it
    #: alone" â€” the same exclude_unset rule as every other PATCH here.
    skill_ids: list[str] | None = None


class ProjectRead(BaseModel):
    id: str
    title: str
    description: str | None = None
    role: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    source_url: str | None = None
    live_url: str | None = None
    skills: list[ProjectSkillRef] = Field(default_factory=list)
    created_at: str
    updated_at: str


# --- certifications ---------------------------------------------------------


class CertificationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    issuer: str = Field(min_length=1, max_length=200)
    issued_on: date | None = None
    expires_on: date | None = None
    credential_id: str | None = Field(default=None, max_length=120)
    verification_url: str | None = Field(default=None, max_length=2000)

    def check_dates(self) -> Self:
        """A certificate cannot expire before it was issued.

        Also a database CHECK (``certification_dates_ordered``); running it as a
        validator turns the violation into a 422 rather than a 500.

        Returns ``self``: a ``mode="after"`` validator that falls through without
        returning the instance makes ``model_validate`` produce ``None``, which
        would surface as a 500 inside the route rather than as a valid body.
        """

        if (
            self.issued_on is not None
            and self.expires_on is not None
            and self.expires_on < self.issued_on
        ):
            raise ValueError("expires_on cannot be before issued_on.")
        return self

    _dates = model_validator(mode="after")(check_dates)


class CertificationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    issuer: str | None = Field(default=None, min_length=1, max_length=200)
    issued_on: date | None = None
    expires_on: date | None = None
    credential_id: str | None = Field(default=None, max_length=120)
    verification_url: str | None = Field(default=None, max_length=2000)


class CertificationRead(BaseModel):
    id: str
    title: str
    issuer: str
    issued_on: str | None = None
    expires_on: str | None = None
    credential_id: str | None = None
    verification_url: str | None = None
    created_at: str
    updated_at: str


# --- achievements -----------------------------------------------------------


class AchievementCreate(BaseModel):
    """``category`` is required: the table column is NOT NULL and the mobile type
    makes it a required member of a closed six-value union."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    category: AchievementCategory
    issuer: str | None = Field(default=None, max_length=200)
    achieved_on: date | None = None
    description: str | None = Field(default=None, max_length=5000)


class AchievementUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    category: AchievementCategory | None = None
    issuer: str | None = Field(default=None, max_length=200)
    achieved_on: date | None = None
    description: str | None = Field(default=None, max_length=5000)


class AchievementRead(BaseModel):
    id: str
    title: str
    category: str
    issuer: str | None = None
    achieved_on: str | None = None
    description: str | None = None
    created_at: str
    updated_at: str


# --- links ------------------------------------------------------------------


class LinkRead(BaseModel):
    id: str
    kind: str
    label: str
    url: str
    created_at: str
    updated_at: str


# --- the aggregate ----------------------------------------------------------


class ProfileAggregate(BaseModel):
    """``GET /profile`` â€” the one round trip the profile screen uses (spec Â§5.1).

    ``preferences`` is ``None`` when never set, which is deliberately distinct
    from an empty object: "never configured" and "configured with nothing in it"
    are different states and the client types it that way.
    """

    identity: IdentityRead
    privacy: PrivacyRead
    completeness: Completeness
    education: list[EducationRead] = Field(default_factory=list)
    experience: list[ExperienceRead] = Field(default_factory=list)
    projects: list[ProjectRead] = Field(default_factory=list)
    certifications: list[CertificationRead] = Field(default_factory=list)
    achievements: list[AchievementRead] = Field(default_factory=list)
    links: list[LinkRead] = Field(default_factory=list)
    skills: list[CandidateSkillRead] = Field(default_factory=list)
    preferences: PreferencesRead | None = None


# Re-exported so the users router can build the same `Me` the auth router does.
# One definition, one shape: two `Me` classes would be two contracts to drift.
__all__ = [
    "AchievementCreate",
    "AchievementRead",
    "AchievementUpdate",
    "CandidateSkillCreate",
    "CandidateSkillRead",
    "CandidateSkillUpdate",
    "CertificationCreate",
    "CertificationRead",
    "CertificationUpdate",
    "Completeness",
    "CompletenessSection",
    "EducationCreate",
    "EducationRead",
    "EducationUpdate",
    "ExperienceCreate",
    "ExperienceRead",
    "ExperienceUpdate",
    "IdentityRead",
    "LinkRead",
    "MeResponse",
    "Page",
    "PreferencesRead",
    "PreferencesUpdate",
    "PrivacyRead",
    "PrivacyUpdate",
    "ProfileAggregate",
    "ProfileIdentityUpdate",
    "ProjectCreate",
    "ProjectRead",
    "ProjectSkillRef",
    "ProjectUpdate",
    "SkillCatalogItem",
    "_iso",
]
