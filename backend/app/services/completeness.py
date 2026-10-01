"""Profile completeness and onboarding state â€” both derived, never stored.

The percentages here are computed from real rows on every read. The client's
``AGENTS.md`` forbids computing completeness on the client and the specification
says it "must never be a constant", so there is deliberately no table, no column
and no cached value: the number is a pure function of the profile, and a profile
edit cannot leave a stale score behind.

**The weighting.** Weights sum to 100, so ``percent`` is the sum of what has been
earned. They are chosen by how much a section matters to the two things this
platform does â€” being found by a recruiter, and being understood by one:

    basics 25      the first thing a recruiter reads
    skills 20      the vocabulary matching is built on
    education 20   the main filter for early-career roles
    experience 15  evidence of having done the work
    projects 10    evidence of building something
    photo 5        real presence, but skippable
    certifications 5  a differentiator, not a filter

``skills`` requires **three**, not one. The mobile wizard's own copy says "Add at
least three skills", so the completion rule and the step the person is reading
have to agree; one skill would light the step up while the screen still said
otherwise.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Achievement,
    Certification,
    Education,
    Experience,
    Profile,
    ProfileLink,
    ProfilePreferences,
    Project,
    User,
    UserSkill,
)
from app.schemas.profile import Completeness, CompletenessSection

#: How many skills count as a complete skills section.
SKILLS_TARGET = 3

#: How many links count as complete. One is enough â€” the step is skippable and
#: the wizard copy says "add a resume, a portfolio, or a LinkedIn link".
LINKS_TARGET = 1


@dataclass(frozen=True)
class ProfileCounts:
    """Every count and flag the calculation needs, in one struct.

    Grouped so a section can never read a value that was never fetched, and so
    the number of queries is fixed and obvious.
    """

    education: int = 0
    experience: int = 0
    projects: int = 0
    certifications: int = 0
    achievements: int = 0
    links: int = 0
    skills: int = 0
    has_headline: bool = False
    has_summary: bool = False
    has_location: bool = False
    has_avatar: bool = False
    has_preferences: bool = False


def collect_counts(session: Session, user_id) -> ProfileCounts:
    """Read the counts and flags the calculation depends on.

    ``COUNT(*)`` queries rather than loading rows: a profile with two hundred
    education entries must not be fully materialised to be told it has two
    hundred.
    """

    def count(model) -> int:
        statement = (
            select(func.count()).select_from(model).where(model.user_id == user_id)
        )
        return int(session.scalar(statement) or 0)

    profile = session.get(Profile, user_id)
    user = session.get(User, user_id)

    return ProfileCounts(
        education=count(Education),
        experience=count(Experience),
        projects=count(Project),
        certifications=count(Certification),
        achievements=count(Achievement),
        links=count(ProfileLink),
        skills=count(UserSkill),
        has_headline=bool(profile and (profile.headline or "").strip()),
        has_summary=bool(profile and (profile.summary or "").strip()),
        has_location=bool(profile and (profile.location or "").strip()),
        has_avatar=bool(user and user.avatar_media_id is not None),
        has_preferences=session.get(ProfilePreferences, user_id) is not None,
    )


def calculate(counts: ProfileCounts) -> Completeness:
    """Turn counts into the weighted score.

    ``percent`` is an integer. The client types it as ``number`` and renders it
    straight into a label, so a float would show as ``33.33333333333333%`` on a
    phone.
    """

    sections = [
        CompletenessSection(
            key="basics",
            label="Basic profile",
            weight=25,
            # Partial credit inside the section: a headline alone is worth
            # something, so filling the basics one field at a time visibly moves
            # the number instead of jumping from 0 to 25 on the last field.
            earned=(
                (9 if counts.has_headline else 0)
                + (8 if counts.has_summary else 0)
                + (8 if counts.has_location else 0)
            ),
            complete=counts.has_headline and counts.has_summary and counts.has_location,
            hint="Add a headline, a short summary, and your location.",
        ),
        CompletenessSection(
            key="skills",
            label="Skills",
            weight=20,
            earned=min(counts.skills, SKILLS_TARGET) * (20 // SKILLS_TARGET),
            complete=counts.skills >= SKILLS_TARGET,
            hint=f"Add at least {SKILLS_TARGET} skills.",
        ),
        CompletenessSection(
            key="education",
            label="Education",
            weight=20,
            earned=20 if counts.education else 0,
            complete=counts.education > 0,
            hint="Add where you studied.",
        ),
        CompletenessSection(
            key="experience",
            label="Experience",
            weight=15,
            earned=15 if counts.experience else 0,
            complete=counts.experience > 0,
            hint="Add a role you have held.",
        ),
        CompletenessSection(
            key="projects",
            label="Projects",
            weight=10,
            earned=10 if counts.projects else 0,
            complete=counts.projects > 0,
            hint="Add something you have built.",
        ),
        CompletenessSection(
            key="photo",
            label="Profile photo",
            weight=5,
            earned=5 if counts.has_avatar else 0,
            complete=counts.has_avatar,
            hint="Add a photo from your camera or gallery.",
        ),
        CompletenessSection(
            key="certifications",
            label="Certifications",
            weight=5,
            earned=5 if counts.certifications else 0,
            complete=counts.certifications > 0,
            hint="Add a certificate you hold.",
        ),
    ]

    earned_total = sum(section.earned for section in sections)
    weight_total = sum(section.weight for section in sections)
    return Completeness(
        percent=round(earned_total / weight_total * 100) if weight_total else 0,
        sections=sections,
    )


def completeness_for(session: Session, user_id) -> Completeness:
    """The whole calculation in one call â€” the only entry point callers need."""

    return calculate(collect_counts(session, user_id))
