"""Authentication routes.

Three routes, and no more:

* ``POST /auth/signup``  — create an account, return a token
* ``POST /auth/login``   — exchange credentials for a token
* ``GET  /auth/me``      — who am I signing in as

There is no logout route, and that is deliberate. V1 issues stateless access
tokens with no server-side session, so there is nothing for a server to revoke:
`src/auth/AuthProvider.tsx` already implements sign-out as
`tokenStorage.clear()` plus a state change, and that is the whole behaviour. An
endpoint that returned 204 and changed nothing would be theatre, and inventing
server state to justify one is exactly the "unnecessary server state" Phase 2 is
told not to create.

Refreshing is likewise absent: V1 is access-token-only, so an expired session
means signing in again.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, status

from app.api.deps import CurrentUser, DbSession
from app.core.errors import ApiError, ErrorCode
from app.core.logging import get_logger
from app.core.rate_limit import enforce_auth_rate_limit
from app.models import User
from app.schemas.auth import (
    LoginRequest,
    PrincipalResponse,
    SignupRequest,
    TokenResponse,
)
from app.services.identity import (
    AccountSuspended,
    authenticate,
    create_user,
    issue_access_token,
)

router = APIRouter(tags=["auth"])
logger = get_logger("mahaa.auth")


def _token_response(user: User) -> TokenResponse:
    """Mint a token and shape it as the mobile ``TokenResponse``.

    Written out rather than derived from the dataclass's ``__dict__``: the
    service's field is called ``token`` and the wire format's is
    ``access_token``, and a rename-in-place of the internal dataclass would then
    silently produce a 500 on every sign-in rather than a type error.
    """

    issued = issue_access_token(user)
    return TokenResponse(
        access_token=issued.token,
        token_type="bearer",
        expires_in=issued.expires_in,
    )


@router.post(
    "/auth/signup",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account and return an access token",
)
def signup(
    payload: SignupRequest,
    request: Request,
    session: DbSession,
) -> TokenResponse:
    """Register and sign in in one step.

    The client stores the returned token and immediately calls ``/auth/me``, so
    there is no separate "verify your account" step between them.

    Rate limited per client address, because this is the endpoint worth
    hammering: it is the one that creates rows.
    """

    enforce_auth_rate_limit(request.client.host if request.client else None)
    user = create_user(session, payload)
    # The email is never logged, and neither is anything derived from the
    # password. The id is enough to correlate a signup with later log lines.
    logger.info("account created", extra={"user_id": str(user.id)})
    return _token_response(user)


@router.post(
    "/auth/login",
    response_model=TokenResponse,
    summary="Exchange credentials for an access token",
)
def login(
    payload: LoginRequest,
    request: Request,
    session: DbSession,
) -> TokenResponse:
    """Sign in.

    An unknown email and a wrong password produce the **same** status, the same
    error code, and the same sentence, and take the same time. Any difference
    between them would let a caller discover which addresses have accounts here.
    """

    enforce_auth_rate_limit(request.client.host if request.client else None)
    try:
        user = authenticate(session, str(payload.email), payload.password)
    except AccountSuspended:
        raise ApiError(
            status_code=403,
            code=ErrorCode.FORBIDDEN,
            message="This account is not available. Please contact support.",
        ) from None

    logger.info("signed in", extra={"user_id": str(user.id)})
    return _token_response(user)


@router.get(
    "/auth/me",
    response_model=PrincipalResponse,
    summary="The signed-in principal",
)
def me(current_user: CurrentUser) -> PrincipalResponse:
    """Resolve the session from the token alone.

    This is what the mobile auth provider calls on every launch, so it is the
    route that decides whether the app shows a candidate, employer or college
    tree. ``memberships`` is empty in V1 — companies arrive in a later phase —
    but the field exists because the client types it as an array and asserts
    ``Array.isArray`` on it.
    """

    return PrincipalResponse(
        id=str(current_user.id),
        public_id=current_user.public_id,
        username=current_user.username,
        name=current_user.name,
        email=current_user.email,
        role=current_user.role.value,
        designation=current_user.designation,
        memberships=[],
    )
