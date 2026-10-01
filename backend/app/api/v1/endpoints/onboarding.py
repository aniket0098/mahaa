"""``GET /onboarding/state`` — one call, no write.

There is deliberately **no** ``PUT`` or ``PATCH`` here. The mobile module
``src/api/onboarding.ts`` exports exactly one function, ``fetchOnboardingState``,
and its own comment explains why: the wizard has "a single authority to ask
instead of inferring progress from the profile aggregate, the company list, or a
local flag", because those three would eventually disagree with each other.

A writable onboarding endpoint would be exactly the second authority the client
is written to avoid — a client that could set "completed" without the profile to
back it. The state is therefore a pure function of the real rows, and the way to
move it is to edit the profile.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CurrentUser, DbSession
from app.schemas.onboarding import OnboardingStateRead
from app.services.onboarding import onboarding_state_for

router = APIRouter(tags=["onboarding"])


@router.get(
    "/onboarding/state",
    response_model=OnboardingStateRead,
    summary="Where this account is in its wizard",
)
def read_state(current_user: CurrentUser, session: DbSession) -> OnboardingStateRead:
    """Report the wizard's position, derived from the profile on every read.

    Open to every role: the client calls this from its role guard and its entry
    path resolver for candidates, employers and colleges alike, so a
    candidate-only guard here would break the other two sign-ups at the first
    navigation.
    """

    return onboarding_state_for(session, current_user)
