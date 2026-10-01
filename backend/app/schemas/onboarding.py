"""``GET /onboarding/state`` — the wizard's single source of truth.

Mirrors ``OnboardingStateRead`` in ``src/types/onboarding.ts``. Everything in it
is **derived on every read from the real profile rows**; nothing is stored. That
is the whole point of the endpoint: the client's own comment says a second
authority (a client flag, the aggregate, a local guess) would eventually disagree
with the server and strand somebody on a finished step.

**No table backs this, and none should.** An `onboarding_completed` flag would
drift from the profile the moment anybody edited a record, and then the wizard
would report "done" for a profile with no education. Deriving it means the answer
cannot be stale.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class OnboardingState(StrEnum):
    """Where the wizard is. Mirrors the client's union exactly."""

    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class OnboardingStep(BaseModel):
    """One step, as the client renders it."""

    key: str
    label: str
    complete: bool
    required: bool
    hint: str


class OnboardingStateRead(BaseModel):
    role: str
    state: OnboardingState
    #: The server's own number. The client never computes this.
    percent: int
    #: The first required step that is not complete, or ``None`` when finished.
    next_step: str | None = None
    steps: list[OnboardingStep] = Field(default_factory=list)
