"""Reusable FastAPI dependencies.

`get_current_user` is the single door every protected route goes through, so the
auth rules are written once rather than per endpoint. It is deliberately free of
any domain knowledge: a later phase asks for `Depends(get_current_user)` and gets
a real `User` back, with no knowledge of profiles, connections or companies.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.errors import ApiError, ErrorCode
from app.db.session import get_db
from app.models import User
from app.models.enums import UserRole, UserStatus
from app.services.tokens import TokenError, decode_access_token

#: `auto_error=False` so a *missing* header produces this module's error envelope
#: rather than FastAPI's default `{"detail": ...}` body, which the mobile client
#: cannot parse. Every failure below therefore comes out in one shape.
_bearer = HTTPBearer(auto_error=False, description="Mahaa access token")


def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: Annotated[Session, Depends(get_db)],
) -> User:
    """Resolve the caller from a Bearer token, or raise 401/403.

    The checks, in order: the header is a Bearer credential; the token verifies
    (signature, expiry, issuer, audience); ``sub`` is a real UUID; a user with
    that id exists; and that user is allowed in.

    A token naming a user who no longer exists is a **401**, not a 404. The
    client treats 401 as "sign in again", which is exactly right: the session it
    was holding is no longer valid. A 403 is reserved for a real, known user who
    is not permitted — currently a suspended account.
    """

    if credentials is None or not credentials.credentials:
        raise _unauthenticated("Authentication is required.")

    if (credentials.scheme or "").lower() != "bearer":
        raise _unauthenticated("Authentication is required.")

    try:
        claims = decode_access_token(credentials.credentials)
    except TokenError:
        # Deliberately uninformative: expired, forged, wrong-audience and
        # not-a-token all look the same from out here.
        raise _unauthenticated(
            "Your session has expired. Please sign in again."
        ) from None

    subject = claims.get("sub")
    try:
        user_id = uuid.UUID(str(subject))
    except (TypeError, ValueError):
        raise _unauthenticated("Your session is not valid.") from None

    user = session.get(User, user_id)
    if user is None:
        raise _unauthenticated("Your session is not valid.")

    if user.status is UserStatus.SUSPENDED:
        # 403, not 401: the mobile client maps this to its `forbidden` state,
        # which is a different screen from "signed out". Only a known,
        # authenticated principal gets this.
        raise ApiError(
            status_code=403,
            code=ErrorCode.FORBIDDEN,
            message="This account is not available. Please contact support.",
        )

    request.state.user_id = str(user.id)
    return user


def require_roles(*roles: UserRole):
    """Build a dependency that admits only the given roles.

    Used by the candidate profile domain: the integration suite asserts an
    employer gets **403** from ``GET /profile``, because that route is the
    candidate's own record and an employer's account has no such thing. A 403 is
    the right answer there — the caller *is* authenticated, and "not found" would
    be a lie about a route that exists.

    This checks the role only. Ownership is a separate, second check, made
    against ``record.user_id`` in the service layer — one guard for "may this
    role be here at all", another for "is this row yours".
    """

    allowed = frozenset(roles)

    def _dependency(current_user: CurrentUser) -> User:
        if current_user.role not in allowed:
            raise ApiError(
                status_code=403,
                code=ErrorCode.FORBIDDEN,
                message="This area is for "
                + " and ".join(sorted(role.value for role in allowed))
                + " accounts.",
            )
        return current_user

    return _dependency


#: Convenience aliases, so a route signature reads as
#: ``current_user: Annotated[User, Depends(get_current_user)]``.
CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]
#: The candidate profile domain is candidate-only, per the integration suite.
CandidateUser = Annotated[User, Depends(require_roles(UserRole.CANDIDATE))]
#: The company workspace domain is employer-only (§12.2, §14.1).
#:
#: Same construction as :data:`CandidateUser`, and for the same reason: §12.2 records
#: that "a **candidate** hitting a company route gets `403`" — a 403 rather than a 404,
#: because the route *exists* and the caller is authenticated. Putting the check here
#: rather than in each of the ten company routes is what makes that answer uniform;
#: a service-layer check would be duplicated ten times and drift.
#:
#: This is a **role** gate only, exactly like its counterpart. Whether the caller is a
#: *member* of the particular company is a second, separate question, answered with a
#: **404** in ``services/companies.py``. The two must not be collapsed: §12.2 asserts
#: both behaviours and they answer different questions.
EmployerUser = Annotated[User, Depends(require_roles(UserRole.EMPLOYER))]


def _unauthenticated(message: str) -> ApiError:
    return ApiError(
        status_code=401,
        code=ErrorCode.NOT_AUTHENTICATED,
        message=message,
    )


#: Convenience alias so a route signature reads as
#: ``current_user: Annotated[User, Depends(get_current_user)]``.
CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]
