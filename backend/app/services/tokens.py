"""Access-token minting and verification.

V1 is **access-token-only**: there is no refresh token, no server-side session
store, and no revocation list. Signing in again is the only way to extend a
session. That is an approved product decision (V1 spec §4.8), and it is why this
module has no storage — a JWT is self-contained, and the only shared state is the
signing secret.

Claims, and why each one is here:

``sub``   the internal user id. The internal key, never the public handle — a
          public id is display data and would leak through a token payload.
``role``  so authorization does not need a database read on every request.
``type``  ``"access"``. Reserved: when a refresh token is ever added, a token of
          the wrong type must not be accepted here.
``jti``   a unique id per token, so a future revocation list has something to
          name.
``iat``/``exp``  issued-at and expiry.
``iss``/``aud``  who minted it and who may present it. Both are verified on every
          decode, so a token signed by the same key for a different service (or a
          different environment) is rejected.

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


class TokenError(Exception):
    """A token could not be trusted.

    Deliberately carries no detail about *why*: the reason can be "expired",
    "wrong issuer", or "signed with another key", and telling a caller which one
    is information an attacker can use. Every cause raises this one error, and the
    route turns it into a single generic 401.
    """


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
        # Deliberately uninformative: expired, forged, wrong-audience and
        # not-a-token all look the same from out here. `from None` keeps the
        # internal reason out of any chained traceback that might be rendered,
        # while the server log still gets the real cause.
        raise TokenError("token rejected") from None
