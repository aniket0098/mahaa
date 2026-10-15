"""Reusable FastAPI dependencies — the single door every protected route uses.

**The same bearer token as the main API.** The mobile app signs in once against
``mahaa-backend-docker`` and presents that token here; the signature, expiry,
issuer and audience are verified against the shared ``JWT_SECRET`` with the
pinned algorithm (the incoming ``alg`` header is never trusted). No password
logic, no session store and no token minting exists in this service at all —
it verifies, it does not issue.

`get_current_user` carries no domain knowledge: a later phase asking for a role
gate gets a `Depends`, not a second copy of these checks.
"""

from __future__ import annotations

import uuid
from typing import Annotated

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError, ErrorCode
from app.db.session import get_db
from app.services import identity
from app.services.identity import UserRow

#: ``auto_error=False`` so a *missing* header produces this module's error
#: envelope rather than FastAPI's default ``{"detail": ...}`` body, which the
#: mobile client cannot parse.
_bearer = HTTPBearer(auto_error=False, description="Mahaa access token")

#: ``users.status`` values. Mirrors the main backend's ``user_status`` enum;
#: only ``suspended`` is refused here, exactly as the main API does.
SUSPENDED = "suspended"


class TokenError(Exception):
    """A token could not be trusted. Carries no detail by design."""


def decode_access_token(token: str) -> dict:
    """Verify a token and return its claims, or raise :class:`TokenError`.

    Signature, expiry, issuer and audience are all checked, and ``sub`` is
    required: every downstream decision keys off it. The reason for a failure
    never crosses the wire — expired, forged and wrong-audience all become one
    generic 401.
    """

    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            options={
                "require": ["exp", "iat", "sub", "iss", "aud"],
                "verify_signature": True,
                "verify_exp": True,
                "verify_iss": True,
                "verify_aud": True,
            },
        )
    except jwt.PyJWTError:
        raise TokenError("token rejected") from None


def _unauthenticated(message: str) -> ApiError:
    return ApiError(
        status_code=401, code=ErrorCode.NOT_AUTHENTICATED, message=message
    )


def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: Annotated[Session, Depends(get_db)],
) -> UserRow:
    """Resolve the caller from a Bearer token, or raise 401/403.

    Checks in order: the header is a Bearer credential; the token verifies;
    ``sub`` is a real UUID; a user with that id exists; that user is allowed
    in. A token naming a user who no longer exists is a **401** — the session
    the client holds is no longer valid. A **403** is reserved for a known,
    suspended account, matching the main API.
    """

    if credentials is None or not credentials.credentials:
        raise _unauthenticated("Authentication is required.")
    if (credentials.scheme or "").lower() != "bearer":
        raise _unauthenticated("Authentication is required.")

    try:
        claims = decode_access_token(credentials.credentials)
    except TokenError:
        raise _unauthenticated("Your session has expired. Please sign in again.") from None

    try:
        user_id = uuid.UUID(str(claims.get("sub")))
    except (TypeError, ValueError):
        raise _unauthenticated("Your session is not valid.") from None

    user = identity.find_user(session, user_id)
    if user is None:
        raise _unauthenticated("Your session is not valid.")

    if user.status == SUSPENDED:
        raise ApiError(
            status_code=403,
            code=ErrorCode.FORBIDDEN,
            message="This account is not available. Please contact support.",
        )

    request.state.user_id = str(user.id)
    return user


#: Convenience aliases, so a route signature reads
#: ``current_user: CurrentUser``.
CurrentUser = Annotated[UserRow, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]
