"""Access-token minting and verification. No database and no HTTP."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from pydantic import ValidationError

from app.core.config import PLACEHOLDER_JWT_SECRET, Settings
from app.services.tokens import (
    TokenError,
    create_access_token,
    decode_access_token,
)

USER_ID = str(uuid.uuid4())

#: A real production-shaped DSN, used only to satisfy the unrelated
#: fail-closed database rule while these tests exercise the JWT rules.
PROD_DSN = "postgresql+psycopg://u:p@db.example.com:5432/mahaa"
GOOD_SECRET = "a-secret-that-is-definitely-long-enough-1234"


def settings(**overrides) -> Settings:
    """Real settings, overridden — no test-only branch in production code."""

    values = {"jwt_secret": GOOD_SECRET}
    values.update(overrides)
    return Settings(**values)


def mint(**overrides):
    return create_access_token(
        user_id=USER_ID,
        role="candidate",
        public_id="MJ-UNITTEST1",
        settings=settings(**overrides),
    )


def handmade(**claims) -> str:
    """A token built by hand, so a test can put a specific fault in it."""

    now = datetime.now(UTC)
    payload = {
        "sub": USER_ID,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=1)).timestamp()),
        "iss": "mahaa-api",
        "aud": "mahaa-mobile",
    }
    payload.update(claims)
    secret = claims.pop("_secret", settings().jwt_secret)
    algorithm = claims.pop("_algorithm", "HS256")
    return jwt.encode(payload, secret, algorithm=algorithm)


def test_a_minted_token_verifies() -> None:
    claims = decode_access_token(mint().token, settings())

    assert claims["sub"] == USER_ID
    assert claims["role"] == "candidate"
    assert claims["type"] == "access"
    assert claims["public_id"] == "MJ-UNITTEST1"


def test_the_token_carries_every_required_claim() -> None:
    claims = decode_access_token(mint().token, settings())

    for claim in ("sub", "role", "type", "jti", "iat", "exp", "iss", "aud"):
        assert claim in claims, claim


def test_issuer_and_audience_are_stamped_and_checked() -> None:
    claims = decode_access_token(mint().token, settings())

    assert claims["iss"] == "mahaa-api"
    assert claims["aud"] == "mahaa-mobile"


def test_the_subject_is_the_internal_id_not_the_public_handle() -> None:
    """A public id is display data and must not travel inside a token."""

    claims = decode_access_token(mint().token, settings())

    assert claims["sub"] == USER_ID
    assert claims["public_id"] == "MJ-UNITTEST1"
    assert claims["public_id"] != claims["sub"]


def test_each_token_gets_a_unique_jti() -> None:
    """A unique id is what a future revocation list would name."""

    first = decode_access_token(mint().token, settings())["jti"]
    second = decode_access_token(mint().token, settings())["jti"]

    assert first != second


def test_expires_in_matches_the_configured_lifetime() -> None:
    assert mint().expires_in == 60 * 60
    assert mint(access_token_expire_minutes=45).expires_in == 45 * 60


def test_expiry_is_the_configured_number_of_minutes_ahead() -> None:
    claims = decode_access_token(mint().token, settings())

    assert claims["exp"] - claims["iat"] == 60 * 60


def test_an_expired_token_is_rejected() -> None:
    past = datetime.now(UTC) - timedelta(hours=2)

    with pytest.raises(TokenError):
        decode_access_token(
            handmade(iat=int(past.timestamp()), exp=int(past.timestamp()) + 60),
            settings(),
        )


def test_a_token_signed_with_another_key_is_rejected() -> None:
    with pytest.raises(TokenError):
        decode_access_token(
            handmade(_secret="a-different-secret-long-enough-9876"), settings()
        )


def test_a_token_with_the_wrong_issuer_is_rejected() -> None:
    with pytest.raises(TokenError):
        decode_access_token(handmade(iss="some-other-service"), settings())


def test_a_token_with_the_wrong_audience_is_rejected() -> None:
    with pytest.raises(TokenError):
        decode_access_token(handmade(aud="some-other-client"), settings())


def test_a_token_missing_sub_is_rejected() -> None:
    """Every downstream decision keys off `sub`, so its absence is fatal."""

    token = jwt.encode(
        {
            "type": "access",
            "iat": 1,
            "exp": int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
            "iss": "mahaa-api",
            "aud": "mahaa-mobile",
        },
        settings().jwt_secret,
        algorithm="HS256",
    )

    with pytest.raises(TokenError):
        decode_access_token(token, settings())


@pytest.mark.parametrize(
    "malformed",
    ["", "not-a-jwt", "a.b.c", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0", "...."],
)
def test_a_malformed_token_is_rejected(malformed: str) -> None:
    with pytest.raises(TokenError):
        decode_access_token(malformed, settings())


# --- production must fail closed -------------------------------------------


def production(**overrides) -> dict:
    values = {
        "app_env": "production",
        "debug": False,
        "database_url": PROD_DSN,
        "jwt_secret": GOOD_SECRET,
    }
    values.update(overrides)
    return values


def test_production_accepts_a_real_secret() -> None:
    """The fail-closed rules must not be so strict that they block a good config."""

    configured = Settings(**production())

    assert configured.jwt_algorithm == "HS256"
    assert configured.access_token_expire_minutes == 60


def test_production_refuses_the_placeholder_secret() -> None:
    with pytest.raises(ValidationError, match="placeholder"):
        Settings(**production(jwt_secret=PLACEHOLDER_JWT_SECRET))


def test_production_refuses_an_empty_secret() -> None:
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(**production(jwt_secret=""))


def test_production_refuses_a_short_secret() -> None:
    with pytest.raises(ValidationError, match="at least"):
        Settings(**production(jwt_secret="too-short"))


def test_production_refuses_an_unpinned_algorithm() -> None:
    with pytest.raises(ValidationError, match="JWT_ALGORITHM"):
        Settings(**production(jwt_algorithm="none"))


def test_production_refuses_a_zero_lifetime() -> None:
    with pytest.raises(ValidationError, match="EXPIRE_MINUTES"):
        Settings(**production(access_token_expire_minutes=0))


def test_production_refuses_an_empty_audience() -> None:
    with pytest.raises(ValidationError, match="AUDIENCE"):
        Settings(**production(jwt_audience=""))


def test_development_may_use_the_placeholder() -> None:
    """The placeholder is a development convenience, and only there."""

    configured = Settings(app_env="development", jwt_secret=PLACEHOLDER_JWT_SECRET)

    assert configured.jwt_secret == PLACEHOLDER_JWT_SECRET


def test_an_unsigned_token_is_rejected() -> None:
    """`alg: none` is the classic JWT forgery and must never be honoured."""

    now = datetime.now(UTC)
    unsigned = jwt.encode(
        {
            "sub": USER_ID,
            "type": "access",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=1)).timestamp()),
            "iss": "mahaa-api",
            "aud": "mahaa-mobile",
        },
        key="",
        algorithm="none",
    )

    with pytest.raises(TokenError):
        decode_access_token(unsigned, settings())


def test_the_failure_carries_no_cause_detail() -> None:
    """One error for every cause, so nothing is learned from the message."""

    with pytest.raises(TokenError) as caught:
        decode_access_token("garbage", settings())

    assert str(caught.value) == "token rejected"
