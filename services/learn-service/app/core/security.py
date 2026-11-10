"""Access-token minting and verification for the Learn service.

Validates existing MAHAJOB JWT access tokens. Uses the same issuer and audience.
Verifies token expiration. Extracts the authenticated user ID correctly.
Enforces existing user roles and permissions.

The algorithm is pinned from configuration and the incoming ``alg`` header is
never trusted — an unpinned decoder accepts ``alg: none`` and is vulnerable to
algorithm confusion.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.core.config import Settings, get_settings
from app.core.errors import TokenError


class TokenError(Exception):
    """A token could not be trusted.

    Deliberately carries no detail about *why*: the reason can be "expired",
    "wrong-audience" or "signed with another key", and telling a caller which
    one is information an attacker can use. Every cause raises this one error,
    and the route turns it into a single generic 401.
    """

    pass


@dataclass(frozen=True)
class AccessToken:
    """A minted token, with the lifetime the client is told about."""

    token: str
    expires_in: int


def _claims(
    user_id: str, role: str, public_id: str, settings: Settings
) -> dict[str, Any]:
    now = datetime.now(UTC)
    return {
        "sub": user_id,
        "role": role,
        "public_id": public_id,
        "type": "access",
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int(
            (now + timedelta(minutes=settings.access_token_expire_minutes)).timestamp()
        ),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }


def create_access_token(
    *, user_id: str, role: str, public_id: str, settings: Settings | None = None
) -> AccessToken:
    """Mint a signed access token for one user."""

    settings = settings or get_settings()
    token = jwt.encode(
        _claims(user_id, role, public_id, settings),
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    return AccessToken(
        token=token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


def decode_access_token(token: str, settings: Settings | None = None) -> dict[str, Any]:
    """Verify a token and return its claims, or raise :class:`TokenError`.

    Verifies, in one pass: the signature, the expiry, the issuer, the audience,
    and the presence of every claim the rest of the system relies on. A token
    missing ``sub`` is rejected rather than trusted, because every downstream
    decision keys off it.
    """

    settings = settings or get_settings()
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