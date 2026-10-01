"""Authentication over HTTP. Needs a local, migrated PostgreSQL.

Every test here runs the real app: real routing, real dependencies, real error
handlers, real Argon2, real JWT. Only the database session is swapped for the
rolled-back one, so a row written through a request never outlives the test.
"""

from __future__ import annotations

import uuid

import pytest
from conftest import VALID_PASSWORD, bearer, signup_body
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User
from app.models.enums import UserRole, UserStatus


def register(client, email: str, **overrides) -> dict:
    """Create an account and return the response body."""

    response = client.post("/api/v1/auth/signup", json=signup_body(email, **overrides))
    assert response.status_code == 201, response.text
    return response.json()


def sign_in(client, email: str, password: str = VALID_PASSWORD):
    return client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )


def stored_user(db_session: Session, email: str) -> User:
    user = db_session.scalar(select(User).where(User.email == email.lower()))
    assert user is not None
    return user


# --- signup -----------------------------------------------------------------


def test_a_valid_signup_succeeds(api_client, auth_email: str) -> None:
    response = api_client.post("/api/v1/auth/signup", json=signup_body(auth_email))

    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0
    assert body["access_token"]


def test_the_token_has_exactly_the_three_mobile_fields(
    api_client, auth_email: str
) -> None:
    """`TokenResponse` in src/types/auth.ts â€” and no refresh_token in V1."""

    assert set(register(api_client, auth_email)) == {
        "access_token",
        "token_type",
        "expires_in",
    }


def test_the_token_from_signup_works_immediately(api_client, auth_email: str) -> None:
    """The client stores the token and calls /auth/me straight away."""

    token = register(api_client, auth_email)["access_token"]

    me = api_client.get("/api/v1/auth/me", headers=bearer(token))
    assert me.status_code == 200
    assert me.json()["email"] == auth_email


def test_a_duplicate_email_is_a_conflict(api_client, auth_email: str) -> None:
    register(api_client, auth_email)

    response = api_client.post("/api/v1/auth/signup", json=signup_body(auth_email))

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


def test_email_uniqueness_is_case_insensitive(api_client, auth_email: str) -> None:
    """citext does this; the service must not undo it by lowercasing one side."""

    register(api_client, auth_email)

    response = api_client.post(
        "/api/v1/auth/signup", json=signup_body(auth_email.upper())
    )

    assert response.status_code == 409


@pytest.mark.parametrize("password", ["short1", "nodigitshere", "12345678", "a" * 200])
def test_a_password_the_policy_forbids_is_a_validation_error(
    api_client, auth_email: str, password: str
) -> None:
    response = api_client.post(
        "/api/v1/auth/signup", json=signup_body(auth_email, password=password)
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_the_password_error_names_the_password_field(
    api_client, auth_email: str
) -> None:
    """The form renders this next to the input, so the field must be named."""

    response = api_client.post(
        "/api/v1/auth/signup", json=signup_body(auth_email, password="short1")
    )

    fields = [d["field"] for d in response.json()["error"]["details"] or []]
    assert any("password" in (f or "") for f in fields)


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "No Email", "password": VALID_PASSWORD, "role": "candidate"},
        {"name": "No Password", "email": "x@example.com", "role": "candidate"},
        {"name": "", "email": "x@example.com", "password": VALID_PASSWORD},
        {"name": "Bad Email", "email": "not-an-email", "password": VALID_PASSWORD},
        {
            "name": "Bad Role",
            "email": "x@example.com",
            "password": VALID_PASSWORD,
            "role": "admin",
        },
        {
            "name": "Unknown Role",
            "email": "x@example.com",
            "password": VALID_PASSWORD,
            "role": "wizard",
        },
    ],
)
def test_an_invalid_request_is_rejected(api_client, payload: dict) -> None:
    response = api_client.post("/api/v1/auth/signup", json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_the_admin_role_cannot_be_self_registered(api_client, auth_email: str) -> None:
    response = api_client.post(
        "/api/v1/auth/signup", json=signup_body(auth_email, role="admin")
    )

    assert response.status_code == 422


def test_an_unknown_field_is_refused(api_client, auth_email: str) -> None:
    """`extra="forbid"`: an unrecognised field is an error, not a silent drop."""

    response = api_client.post(
        "/api/v1/auth/signup", json=signup_body(auth_email, is_admin=True)
    )

    assert response.status_code == 422


@pytest.mark.parametrize("role", ["candidate", "employer", "college"])
def test_each_self_registerable_role_works(
    api_client, auth_email: str, role: str
) -> None:
    response = api_client.post(
        "/api/v1/auth/signup", json=signup_body(auth_email, role=role)
    )

    assert response.status_code == 201


def test_signup_never_returns_the_password_or_its_hash(
    api_client, auth_email: str
) -> None:
    body = register(api_client, auth_email)
    text = str(body).lower()

    assert "password" not in text
    assert "argon2" not in text
    assert VALID_PASSWORD not in str(body)


def test_the_stored_password_is_hashed(
    api_client, auth_email: str, db_session: Session
) -> None:
    register(api_client, auth_email)

    user = stored_user(db_session, auth_email)
    assert user.password_hash != VALID_PASSWORD
    assert user.password_hash.startswith("$argon2id$")


def test_signup_assigns_a_public_id_and_username(
    api_client, auth_email: str, db_session: Session
) -> None:
    """The client has no username field, so the server assigns both."""

    register(api_client, auth_email)

    user = stored_user(db_session, auth_email)
    assert user.public_id.startswith("MJ-")
    assert len(user.public_id) == 11
    assert user.username
    assert user.role is UserRole.CANDIDATE
    assert user.status is UserStatus.ACTIVE


def test_signup_stores_the_email_normalised(
    api_client, auth_email: str, db_session: Session
) -> None:
    """So the same address is never stored two ways."""

    shouted = auth_email.replace("phase2", "PHASE2").replace("@example", "@EXAMPLE")
    response = api_client.post("/api/v1/auth/signup", json=signup_body(shouted))
    assert response.status_code == 201, response.text

    assert stored_user(db_session, auth_email).email == auth_email.lower()


# --- login ------------------------------------------------------------------


def test_valid_credentials_return_a_token(api_client, auth_email: str) -> None:
    register(api_client, auth_email)

    response = sign_in(api_client, auth_email)

    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"
    assert response.json()["expires_in"] > 0


def test_a_wrong_password_is_invalid_credentials(api_client, auth_email: str) -> None:
    register(api_client, auth_email)

    response = sign_in(api_client, auth_email, "WrongPass1")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"


def test_an_unknown_email_is_invalid_credentials(api_client) -> None:
    response = sign_in(api_client, f"nobody.{uuid.uuid4().hex[:8]}@example.com")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"


def test_login_does_not_reveal_whether_an_account_exists(
    api_client, auth_email: str
) -> None:
    """The two failures must be byte-identical, or sign-in enumerates users."""

    register(api_client, auth_email)

    wrong_password = sign_in(api_client, auth_email, "WrongPass1")
    unknown_email = sign_in(api_client, f"nobody.{uuid.uuid4().hex[:8]}@example.com")

    assert wrong_password.status_code == unknown_email.status_code == 401
    # `request_id` is the one field that must differ; everything else cannot.
    assert (
        wrong_password.json()["error"]["code"] == unknown_email.json()["error"]["code"]
    )
    assert (
        wrong_password.json()["error"]["message"]
        == unknown_email.json()["error"]["message"]
    )


def test_login_is_case_insensitive_on_the_email(api_client, auth_email: str) -> None:
    register(api_client, auth_email)

    assert sign_in(api_client, auth_email.upper()).status_code == 200


def test_a_deactivated_account_signs_in_and_reactivates(
    api_client, auth_email: str, db_session: Session
) -> None:
    """The soft pause: nothing was deleted, so signing in brings it back."""

    register(api_client, auth_email)
    user = stored_user(db_session, auth_email)
    user.status = UserStatus.DEACTIVATED
    db_session.commit()

    assert sign_in(api_client, auth_email).status_code == 200

    db_session.expire_all()
    assert (
        db_session.scalar(select(User.status).where(User.email == auth_email.lower()))
        is UserStatus.ACTIVE
    )


def test_a_suspended_account_is_forbidden_not_unauthenticated(
    api_client, auth_email: str, db_session: Session
) -> None:
    """403, because the client maps it to its `forbidden` state â€” a different
    screen from "signed out"."""

    register(api_client, auth_email)
    user = stored_user(db_session, auth_email)
    user.status = UserStatus.SUSPENDED
    db_session.commit()

    response = sign_in(api_client, auth_email)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_a_deleted_account_cannot_sign_in(
    api_client, auth_email: str, db_session: Session
) -> None:
    register(api_client, auth_email)
    db_session.delete(stored_user(db_session, auth_email))
    db_session.commit()

    response = sign_in(api_client, auth_email)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"


def test_login_records_the_last_login_time(
    api_client, auth_email: str, db_session: Session
) -> None:
    register(api_client, auth_email)

    sign_in(api_client, auth_email)

    assert stored_user(db_session, auth_email).last_login_at is not None


# --- the current user -------------------------------------------------------


def test_me_returns_the_principal(api_client, auth_email: str) -> None:
    token = register(api_client, auth_email)["access_token"]

    body = api_client.get("/api/v1/auth/me", headers=bearer(token)).json()

    assert body["email"] == auth_email
    assert body["role"] == "candidate"
    assert body["id"]
    assert body["public_id"].startswith("MJ-")
    assert body["username"]
    # The integration suite asserts this is an array; companies arrive later.
    assert body["memberships"] == []


def test_users_me_returns_the_account(api_client, auth_email: str) -> None:
    token = register(api_client, auth_email)["access_token"]

    response = api_client.get("/api/v1/users/me", headers=bearer(token))

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == auth_email
    assert body["public_id"].startswith("MJ-")
    assert body["created_at"]
    assert body["avatar_url"] is None
    assert body["phone"] is None


def test_users_me_includes_a_phone_when_one_was_given(
    api_client, auth_email: str
) -> None:
    token = register(api_client, auth_email, phone="+91 90000 00000")["access_token"]

    body = api_client.get("/api/v1/users/me", headers=bearer(token)).json()

    assert body["phone"] == "+91 90000 00000"


def test_neither_identity_route_leaks_the_password_hash(
    api_client, auth_email: str
) -> None:
    token = register(api_client, auth_email)["access_token"]

    for path in ("/api/v1/auth/me", "/api/v1/users/me"):
        text = api_client.get(path, headers=bearer(token)).text.lower()
        assert "password" not in text, path
        assert "argon2" not in text, path


# --- the auth dependency ----------------------------------------------------

PROTECTED = ("/api/v1/auth/me", "/api/v1/users/me")


@pytest.mark.parametrize("path", PROTECTED)
def test_a_protected_route_without_a_token_is_401(api_client, path: str) -> None:
    response = api_client.get(path)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


@pytest.mark.parametrize("path", PROTECTED)
@pytest.mark.parametrize(
    "header",
    [
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer "},
        {"Authorization": "Bearer not-a-jwt"},
        {"Authorization": "Bearer a.b.c"},
        {"Authorization": "Basic dXNlcjpwYXNz"},
        {"Authorization": "token abc"},
    ],
)
def test_a_malformed_authorization_header_is_401(
    api_client, path: str, header: dict
) -> None:
    """A malformed header must come back in the standard envelope, not FastAPI's."""

    response = api_client.get(path, headers=header)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"
    assert "detail" not in response.json()


@pytest.mark.parametrize("path", PROTECTED)
def test_a_valid_token_returns_the_caller(
    api_client, auth_email: str, path: str
) -> None:
    token = register(api_client, auth_email)["access_token"]

    response = api_client.get(path, headers=bearer(token))

    assert response.status_code == 200
    assert response.json()["email"] == auth_email


def test_a_token_signed_with_another_key_is_refused(
    api_client, auth_email: str
) -> None:
    from app.core.config import Settings
    from app.services.tokens import create_access_token

    forged = create_access_token(
        user_id="00000000-0000-4000-8000-000000000000",
        role="candidate",
        public_id="MJ-FORGED01",
        settings=Settings(jwt_secret="a-different-secret-long-enough-9876"),
    ).token

    assert api_client.get("/api/v1/auth/me", headers=bearer(forged)).status_code == 401


def test_a_token_for_a_user_who_no_longer_exists_is_401(
    api_client, auth_email: str, db_session: Session
) -> None:
    """A deleted account's token is simply no longer valid â€” 401, not 404."""

    token = register(api_client, auth_email)["access_token"]
    db_session.delete(stored_user(db_session, auth_email))
    db_session.commit()

    response = api_client.get("/api/v1/auth/me", headers=bearer(token))

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


def test_a_suspended_user_with_a_valid_token_gets_403(
    api_client, auth_email: str, db_session: Session
) -> None:
    """The token is genuine; the account is not permitted. 403, matching login."""

    token = register(api_client, auth_email)["access_token"]
    user = stored_user(db_session, auth_email)
    user.status = UserStatus.SUSPENDED
    db_session.commit()

    assert api_client.get("/api/v1/auth/me", headers=bearer(token)).status_code == 403


def test_an_expired_token_is_401(api_client) -> None:
    from datetime import UTC, datetime, timedelta

    import jwt

    from app.core.config import get_settings

    now = datetime.now(UTC)
    expired = jwt.encode(
        {
            "sub": "00000000-0000-4000-8000-000000000000",
            "type": "access",
            "iat": int((now - timedelta(hours=2)).timestamp()),
            "exp": int((now - timedelta(hours=1)).timestamp()),
            "iss": get_settings().jwt_issuer,
            "aud": get_settings().jwt_audience,
        },
        get_settings().jwt_secret,
        algorithm=get_settings().jwt_algorithm,
    )

    assert api_client.get("/api/v1/auth/me", headers=bearer(expired)).status_code == 401


# --- security properties ----------------------------------------------------


def test_no_response_contains_the_signing_secret(api_client, auth_email: str) -> None:
    from app.core.config import get_settings

    secret = get_settings().jwt_secret
    token = register(api_client, auth_email)["access_token"]

    assert secret not in str(token)
    assert secret not in api_client.get("/api/v1/health").text
    assert secret not in api_client.get("/api/v1/auth/me", headers=bearer(token)).text


def test_a_response_does_not_echo_the_token_or_header(
    api_client, auth_email: str
) -> None:
    token = register(api_client, auth_email)["access_token"]

    response = api_client.get("/api/v1/auth/me", headers=bearer(token))

    assert token not in response.text
    assert "authorization" not in response.text.lower()


def test_a_validation_error_does_not_echo_the_password(
    api_client, auth_email: str
) -> None:
    """A 422 body is stored by proxies and quoted in bug reports; keep it clean."""

    response = api_client.post(
        "/api/v1/auth/signup", json=signup_body(auth_email, password="short1")
    )

    assert "short1" not in response.text


def test_the_password_is_never_logged(api_client, auth_email: str, caplog) -> None:
    """Structured logs are shipped off-box, so a password in one is a leak."""

    with caplog.at_level("INFO"):
        register(api_client, auth_email)

    logged = "\n".join(
        [record.getMessage() for record in caplog.records]
        + [str(record.__dict__) for record in caplog.records]
    )

    assert VALID_PASSWORD not in logged
    assert "argon2" not in logged.lower()


# --- rate limiting ----------------------------------------------------------


def test_the_limiter_refuses_past_its_budget(allow_rate_limit) -> None:
    from app.core.errors import ApiError
    from app.core.rate_limit import enforce_auth_rate_limit

    for _ in range(allow_rate_limit.auth_rate_limit_per_window):
        enforce_auth_rate_limit("203.0.113.7", allow_rate_limit)

    with pytest.raises(ApiError) as throttled:
        enforce_auth_rate_limit("203.0.113.7", allow_rate_limit)
    assert throttled.value.status_code == 429


def test_the_limiter_is_per_client(allow_rate_limit) -> None:
    """One noisy caller must not lock everyone else out."""

    from app.core.errors import ApiError
    from app.core.rate_limit import enforce_auth_rate_limit

    for _ in range(allow_rate_limit.auth_rate_limit_per_window):
        enforce_auth_rate_limit("203.0.113.8", allow_rate_limit)

    # A different address still has its full budget.
    enforce_auth_rate_limit("203.0.113.9", allow_rate_limit)

    with pytest.raises(ApiError):
        enforce_auth_rate_limit("203.0.113.8", allow_rate_limit)


def test_a_signup_burst_is_throttled(api_client, auth_email, allow_rate_limit) -> None:
    """And the limit is wired to the route, not merely present in a module."""

    allow_rate_limit.auth_rate_limit_per_window = 2
    allow_rate_limit.auth_rate_limit_window_seconds = 60

    for index in range(2):
        api_client.post(
            "/api/v1/auth/signup",
            json=signup_body(f"{auth_email.split('@')[0]}.{index}@example.com"),
        )
    throttled = api_client.post("/api/v1/auth/signup", json=signup_body(auth_email))

    assert throttled.status_code == 429
    assert throttled.json()["error"]["code"] == "rate_limited"
