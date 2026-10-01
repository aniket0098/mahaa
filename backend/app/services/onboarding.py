"""``GET /onboarding/state`` â€” derived from the profile, stored nowhere.

The client's wizard treats this one call as the authority for where somebody is:
it renders the step ``next_step`` names and decides completion from ``state``.
A stored flag would drift from the profile the first time anybody edited a record
and then report "done" for an empty profile, so nothing is persisted â€” the answer
is a pure function of the real rows, recomputed on every read.

**The step table mirrors ``src/features/onboarding/onboardingSteps.ts`` exactly**,
including which steps are ``required``. The client owns the *presentation* order
and the gate; the server owns whether each step is *done*. The two agreeing is
the whole design: the client's own comment says that table "is the single place
that decides what gates completion" and this endpoint "decides whether each of
them is done".

**On the two non-candidate roles.** An employer's only required step is creating
a company, and a college's are the institution and its programs. Those domains
are later phases, and until they exist there is no row to count. Rather than
guessing "done", those steps report ``complete: false`` â€” so an employer is held
in the wizard instead of being shown an empty dashboard. That is the
conservative answer on purpose: a false completion is what strands somebody on a
screen they already finished, whereas the opposite mistake is merely
inconvenient. Both become true the moment those phases land.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import User
from app.models.enums import UserRole
from app.schemas.onboarding import OnboardingState, OnboardingStateRead, OnboardingStep
from app.services.completeness import ProfileCounts, collect_counts


def _candidate_steps(counts: ProfileCounts) -> list[OnboardingStep]:
    return [
        OnboardingStep(
            key="basics",
            label="Basic profile",
            complete=counts.has_headline and counts.has_summary and counts.has_location,
            required=True,
            hint="Add the headline, location, and bio employers see first.",
        ),
        OnboardingStep(
            key="education",
            label="Education",
            complete=counts.education > 0,
            required=True,
            hint="Add where you studied.",
        ),
        OnboardingStep(
            key="skills",
            label="Skills",
            complete=counts.skills >= 3,
            required=True,
            hint="Add at least three skills.",
        ),
        OnboardingStep(
            key="experience",
            label="Experience & projects",
            complete=counts.experience > 0 or counts.projects > 0,
            required=False,
            hint="Show what you have done so far. Optional.",
        ),
        OnboardingStep(
            key="preferences",
            label="Preferences",
            complete=counts.has_preferences,
            required=True,
            hint="Set the work modes and job types you want.",
        ),
        OnboardingStep(
            key="photo",
            label="Profile photo",
            complete=counts.has_avatar,
            required=False,
            hint="Add a photo from your camera or gallery. Optional.",
        ),
        OnboardingStep(
            key="links",
            label="Resume & links",
            complete=counts.links >= 1,
            required=False,
            hint="Add a resume, a portfolio, or a LinkedIn link. Optional.",
        ),
        OnboardingStep(
            key="review",
            label="Review and finish",
            # The review screen collects nothing; it is how the wizard ends, and
            # it is never a gate â€” see the step table's own note in the client.
            complete=True,
            required=False,
            hint="Check everything, then finish and open your dashboard.",
        ),
    ]


def _employer_steps(counts: ProfileCounts) -> list[OnboardingStep]:
    return [
        OnboardingStep(
            key="profile",
            label="Your profile",
            complete=counts.has_avatar,
            required=False,
            hint="Add a photo, your designation, and a phone number. Optional.",
        ),
        OnboardingStep(
            key="company",
            label="Company",
            # No companies table is readable in Phase 3, so this cannot be
            # honestly marked done. See the module docstring.
            complete=False,
            required=True,
            hint="Create the company you hire through.",
        ),
        OnboardingStep(
            key="verification",
            label="Verification",
            complete=False,
            required=False,
            hint="See where your company stands.",
        ),
        OnboardingStep(
            key="review",
            label="Review and finish",
            complete=True,
            required=False,
            hint="Check your recruiter and company details, then finish.",
        ),
    ]


def _college_steps(counts: ProfileCounts) -> list[OnboardingStep]:
    return [
        OnboardingStep(
            key="profile",
            label="Your contact profile",
            complete=counts.has_avatar,
            required=False,
            hint="Add a photo and your designation as the contact person.",
        ),
        OnboardingStep(
            key="institution",
            label="Institution",
            complete=False,
            required=True,
            hint="Add your institution's name and details.",
        ),
        OnboardingStep(
            key="programs",
            label="Programs",
            complete=False,
            required=True,
            hint="Add at least one course or program you offer.",
        ),
        OnboardingStep(
            key="verification",
            label="Verification",
            complete=False,
            required=False,
            hint="See where your institution stands.",
        ),
        OnboardingStep(
            key="review",
            label="Review and finish",
            complete=True,
            required=False,
            hint="Check your institution and programs, then finish.",
        ),
    ]


def build_state(user: User, counts: ProfileCounts) -> OnboardingStateRead:
    """Compose the wizard's view of one account."""

    if user.role is UserRole.EMPLOYER:
        steps = _employer_steps(counts)
    elif user.role is UserRole.COLLEGE:
        steps = _college_steps(counts)
    else:
        steps = _candidate_steps(counts)

    outstanding = [step for step in steps if step.required and not step.complete]
    done = [step for step in steps if step.complete]

    if not outstanding:
        state = OnboardingState.COMPLETED
    elif _any_real_data(counts):
        state = OnboardingState.IN_PROGRESS
    else:
        state = OnboardingState.NOT_STARTED

    return OnboardingStateRead(
        role=user.role.value,
        state=state,
        percent=_progress_percent(done, steps),
        # The first required step still outstanding, or None when finished. The
        # client falls back to its own first step when this names a step it does
        # not know, so an unrecognised key is harmless rather than fatal.
        next_step=outstanding[0].key if outstanding else None,
        steps=steps,
    )


def _any_real_data(counts: ProfileCounts) -> bool:
    """Whether the account has any profile content at all.

    Separates ``not_started`` (a brand new account, nothing written) from
    ``in_progress`` (somebody has begun). The review step is complete on every
    account, so without this check every new account would read as
    ``in_progress`` and the distinction would carry no information.
    """

    return any(
        (
            counts.education,
            counts.experience,
            counts.projects,
            counts.certifications,
            counts.achievements,
            counts.links,
            counts.skills,
            counts.has_headline,
            counts.has_summary,
            counts.has_location,
            counts.has_preferences,
        )
    )


def _progress_percent(done: list[OnboardingStep], steps: list[OnboardingStep]) -> int:
    """Share of the wizard's steps that are done.

    Step-based rather than the profile's weighted completeness: this number
    answers "how far through the wizard am I", and weighting a photo the same as
    a work history would not answer that. The two are deliberately different
    numbers about the same account.
    """

    if not steps:
        return 100
    return round(len(done) / len(steps) * 100)


def onboarding_state_for(session: Session, user: User) -> OnboardingStateRead:
    """The one entry point the route calls."""

    return build_state(user, collect_counts(session, user.id))
