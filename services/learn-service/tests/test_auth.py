"""Authentication tests for the Learn microservice."""

import sys
sys.path.insert(0, r'C:\mahaa\services\learn-service')

from app.core.security import AccessToken  # noqa: F401  (ensures the dataclass is importable)


def test_jwt_token_creation():
    """Test that JWT tokens can be created with the real signature."""
    from app.core.security import create_access_token

    token = create_access_token(
        user_id="test_user",
        role="candidate",
        public_id="MJ-Test",
    )
    assert isinstance(token, AccessToken)
    assert isinstance(token.token, str)
    assert token.token
    print("JWT token creation OK")


def test_token_validation():
    """Test that JWT tokens can be validated with decode_access_token."""
    from app.core.security import create_access_token, decode_access_token

    token = create_access_token(
        user_id="test_user",
        role="candidate",
        public_id="MJ-Test",
    )
    payload = decode_access_token(token.token)
    assert payload is not None
    assert payload["sub"] == "test_user"
    assert payload["role"] == "candidate"
    print("Token validation OK")


def test_invalid_token():
    """Test that invalid tokens are rejected via TokenError."""
    from app.core.security import decode_access_token, TokenError

    try:
        decode_access_token("invalid_token_string")
    except TokenError:
        print("Invalid token rejected OK")
        return
    raise AssertionError("Expected TokenError for invalid token")