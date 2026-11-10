"""Reusable FastAPI dependencies for the Learn service.

Same layout as the main backend: ``CurrentUser`` / ``DbSession`` /
``CandidateUser`` / ``StaffUser``, all gated on validated JWT authentication.
"""

from __future__ import annotations

import uuid
from typing import Annotated
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError, ErrorCode, TokenError
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.learning import User
from app.models.enums import UserRole, UserStatus

_bearer = HTTPBearer(auto_error=False, description="Mahaa access token")


def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: Annotated[Session, Depends(get_db)],
):
    if credentials is None or not credentials.credentials:
        raise _unauthenticated("Authentication is required.")
    if (credentials.scheme or "").lower() != "bearer":
        raise _unauthenticated("Authentication is required.")
    try:
        claims = decode_access_token(credentials.credentials)
    except TokenError:
        raise _unauthenticated("Your session has expired. Please sign in again.") from None
    subject = claims.get("sub")
    try:
        user_id = uuid.UUID(str(subject))
    except (TypeError, ValueError):
        raise _unauthenticated("Your session is not valid.") from None
    user = session.get(User, user_id)
    if user is None:
        raise _unauthenticated("Your session is not valid.")
    if user.status is UserStatus.SUSPENDED:
        raise ApiError(
            status_code=403,
            code=ErrorCode.FORBIDDEN,
            message="This account is not available. Please contact support.",
        )
    request.state.user_id = str(user.id)
    return user


def require_roles(*roles):
    allowed = frozenset(roles)

    def _dependency(current_user):
        if current_user.role not in allowed:
            raise ApiError(
                status_code=403,
                code=ErrorCode.FORBIDDEN,
                message="This area is for " + " and ".join(sorted(r.value for r in allowed)) + " accounts.",
            )
        return current_user

    return _dependency


CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]
CandidateUser = Annotated[User, Depends(require_roles(UserRole.CANDIDATE))]
StaffUser = Annotated[User, Depends(require_roles(UserRole.ADMIN, UserRole.COLLEGE))]


def _unauthenticated(message):
    return ApiError(status_code=401, code=ErrorCode.NOT_AUTHENTICATED, message=message)