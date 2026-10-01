"""``/users/me`` â€” the account lifecycle.

Covers the read, the partial update, the sensitive-change password rule, username
availability, password change, deactivation and deletion.
"""

from __future__ import annotations

import uuid

import pytest
from conftest import VALID_PASSWORD
from sqlalchemy.orm import Session

from app.models.enums import UserStatus

NEW_PASSWORD = "Rotated9Pass"


# --- read -------------------------------------------------------------------


def test_me_returns_the_account(api_client, candidate) -> None:
    response = api_client.get("/api/v1/users/me", headers=candidate.headers)

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == candidate.email
    assert body["id"] == candidate.id
    assert body["public_id"].startswith("MJ-")
    assert body["created_at"]
    assert body["avatar_url"] is None


def test_me_never_returns_the_password_hash(api_client, candidate) -> None:
    body = api_client.get("/api/v1/users/me", headers=candidate.headers).text

    assert "password_hash" not in body
    assert "argon2" not in body.lower()
    assert VALID_PASSWORD not in body


def test_me_requires_a_token(api_client) -> None:
    assert api_client.get("/api/v1/users/me").status_code == 401


# --- update -----------------------------------------------------------------


def test_update_changes_the_name(api_client, candidate) -> None:
    response = api_client.patch(
        "/api/v1/users/me", json={"name": "Renamed Person"}, headers=candidate.headers
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Renamed Person"


def test_update_leaves_absent_fields_alone(api_client, candidate) -> None:
    """PATCH semantics: only what was sent is touched."""

    api_client.patch(
        "/api/v1/users/me", json={"phone": "+91 90000 00000"}, headers=candidate.headers
    )

    response = api_client.patch(
        "/api/v1/users/me", json={"name": "Only The Name"}, headers=candidate.headers
    )

    assert response.status_code == 200
    assert response.json()["phone"] == "+91 90000 00000"


def test_update_can_clear_a_nullable_field(api_client, candidate) -> None:
    api_client.patch(
        "/api/v1/users/me", json={"phone": "+91 1"}, headers=candidate.headers
    )

    response = api_client.patch(
        "/api/v1/users/me", json={"phone": None}, headers=candidate.headers
    )

    assert response.status_code == 200
    assert response.json()["phone"] is None


def test_update_rejects_an_empty_name(api_client, candidate) -> None:
    response = api_client.patch(
        "/api/v1/users/me", json={"name": ""}, headers=candidate.headers
    )

    assert response.status_code == 422


def test_update_rejects_an_unknown_field(api_client, candidate) -> None:
    """`extra="forbid"` â€” an unknown field is a 422, not a silent no-op."""

    response = api_client.patch(
        "/api/v1/users/me", json={"is_admin": True}, headers=candidate.headers
    )

    assert response.status_code == 422


def test_update_cannot_touch_another_account(
    api_client, candidate, other_candidate
) -> None:
    """There is no user id in the body, so this is structurally impossible.

    Asserted anyway: a future convenience field that accepted one would fail here.
    """

    response = api_client.patch(
        "/api/v1/users/me",
        json={"id": other_candidate.id, "name": "Should Not Apply"},
        headers=candidate.headers,
    )

    assert response.status_code == 422



# --- sensitive changes need the password ------------------------------------


def test_changing_the_email_requires_the_password(api_client, candidate) -> None:
    response = api_client.patch(
        "/api/v1/users/me",
        json={"email": f"moved.{uuid.uuid4().hex[:8]}@example.com"},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_changing_the_username_requires_the_password(api_client, candidate) -> None:
    response = api_client.patch(
        "/api/v1/users/me", json={"username": "newhandle"}, headers=candidate.headers
    )

    assert response.status_code == 422


def test_changing_the_email_with_the_password_succeeds(api_client, candidate) -> None:
    new_email = f"moved.{uuid.uuid4().hex[:8]}@example.com"

    response = api_client.patch(
        "/api/v1/users/me",
        json={"email": new_email, "current_password": VALID_PASSWORD},
        headers=candidate.headers,
    )

    assert response.status_code == 200
    assert response.json()["email"] == new_email


def test_changing_the_email_with_a_wrong_password_is_401(
    api_client, candidate
) -> None:
    response = api_client.patch(
        "/api/v1/users/me",
        json={
            "email": f"moved.{uuid.uuid4().hex[:8]}@example.com",
            "current_password": "Wr0ngPassw0rd",
        },
        headers=candidate.headers,
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"


def test_a_taken_username_is_a_conflict(
    api_client, candidate, other_candidate
) -> None:
    response = api_client.patch(
        "/api/v1/users/me",
        json={"username": other_candidate.username, "current_password": VALID_PASSWORD},
        headers=candidate.headers,
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


def test_a_taken_email_is_a_conflict(api_client, candidate, other_candidate) -> None:
    response = api_client.patch(
        "/api/v1/users/me",
        json={"email": other_candidate.email, "current_password": VALID_PASSWORD},
        headers=candidate.headers,
    )

    assert response.status_code == 409


@pytest.mark.parametrize("handle", ["ab", "A" * 5, "has space", "bad-dash", "x" * 40])
def test_an_invalid_username_is_rejected(
    api_client, candidate, handle: str
) -> None:
    response = api_client.patch(
        "/api/v1/users/me",
        json={"username": handle, "current_password": VALID_PASSWORD},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_changing_the_username_succeeds(api_client, candidate) -> None:
    response = api_client.patch(
        "/api/v1/users/me",
        json={"username": "brandnewhandle", "current_password": VALID_PASSWORD},
        headers=candidate.headers,
    )

    assert response.status_code == 200
    assert response.json()["username"] == "brandnewhandle"


# --- username availability --------------------------------------------------


def test_an_unused_username_is_available(api_client, candidate) -> None:
    response = api_client.get(
        "/api/v1/users/me/username/availability",
        params={"username": "nobodyhasthis99"},
        headers=candidate.headers,
    )

    assert response.status_code == 200
    assert response.json() == {"username": "nobodyhasthis99", "available": True}


def test_a_taken_username_is_not_available(
    api_client, candidate, other_candidate
) -> None:
    response = api_client.get(
        "/api/v1/users/me/username/availability",
        params={"username": other_candidate.username},
        headers=candidate.headers,
    )

    assert response.status_code == 200
    assert response.json()["available"] is False


def test_your_own_username_reads_as_available(api_client, candidate) -> None:
    """The account screen asks while the field still holds the current value."""

    response = api_client.get(
        "/api/v1/users/me/username/availability",
        params={"username": candidate.username},
        headers=candidate.headers,
    )

    assert response.json()["available"] is True



# --- password ---------------------------------------------------------------


def test_change_password_succeeds(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/users/me/password",
        json={"current_password": VALID_PASSWORD, "new_password": NEW_PASSWORD},
        headers=candidate.headers,
    )

    assert response.status_code == 204


def test_the_new_password_works_for_signing_in(api_client, candidate) -> None:
    api_client.post(
        "/api/v1/users/me/password",
        json={"current_password": VALID_PASSWORD, "new_password": NEW_PASSWORD},
        headers=candidate.headers,
    )

    response = api_client.post(
        "/api/v1/auth/login",
        json={"email": candidate.email, "password": NEW_PASSWORD},
    )

    assert response.status_code == 200


def test_the_old_password_stops_working(api_client, candidate) -> None:
    api_client.post(
        "/api/v1/users/me/password",
        json={"current_password": VALID_PASSWORD, "new_password": NEW_PASSWORD},
        headers=candidate.headers,
    )

    response = api_client.post(
        "/api/v1/auth/login",
        json={"email": candidate.email, "password": VALID_PASSWORD},
    )

    assert response.status_code == 401


def test_a_wrong_current_password_is_401(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/users/me/password",
        json={"current_password": "Wr0ngPassw0rd", "new_password": NEW_PASSWORD},
        headers=candidate.headers,
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"


def test_a_wrong_current_password_changes_nothing(api_client, candidate) -> None:
    api_client.post(
        "/api/v1/users/me/password",
        json={"current_password": "Wr0ngPassw0rd", "new_password": NEW_PASSWORD},
        headers=candidate.headers,
    )

    response = api_client.post(
        "/api/v1/auth/login",
        json={"email": candidate.email, "password": VALID_PASSWORD},
    )

    assert response.status_code == 200


@pytest.mark.parametrize(
    "new_password", ["short1", "nodigitshere", "12345678", "a" * 200]
)
def test_a_new_password_the_policy_forbids_is_422(
    api_client, candidate, new_password: str
) -> None:
    """The Phase 2 policy applies to a changed password too."""

    response = api_client.post(
        "/api/v1/users/me/password",
        json={"current_password": VALID_PASSWORD, "new_password": new_password},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_reusing_the_same_password_is_422(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/users/me/password",
        json={"current_password": VALID_PASSWORD, "new_password": VALID_PASSWORD},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_change_password_requires_a_token(api_client) -> None:
    response = api_client.post(
        "/api/v1/users/me/password",
        json={"current_password": VALID_PASSWORD, "new_password": NEW_PASSWORD},
    )

    assert response.status_code == 401



# --- deactivation -----------------------------------------------------------


def test_deactivate_returns_the_account(api_client, candidate) -> None:
    response = api_client.post("/api/v1/users/me/deactivate", headers=candidate.headers)

    assert response.status_code == 200
    assert response.json()["id"] == candidate.id


def test_deactivate_does_not_delete_the_account(
    api_client, candidate, db_session: Session
) -> None:
    """A soft pause: the row must survive, which is what makes it reversible."""

    from app.models import User

    api_client.post("/api/v1/users/me/deactivate", headers=candidate.headers)

    stored = db_session.get(User, candidate.id)
    assert stored is not None
    assert stored.status is UserStatus.DEACTIVATED


def test_a_deactivated_account_can_sign_in_again(api_client, candidate) -> None:
    api_client.post("/api/v1/users/me/deactivate", headers=candidate.headers)

    response = api_client.post(
        "/api/v1/auth/login",
        json={"email": candidate.email, "password": VALID_PASSWORD},
    )

    assert response.status_code == 200


def test_signing_in_again_reactivates(
    api_client, candidate, db_session: Session
) -> None:
    from app.models import User

    api_client.post("/api/v1/users/me/deactivate", headers=candidate.headers)
    api_client.post(
        "/api/v1/auth/login",
        json={"email": candidate.email, "password": VALID_PASSWORD},
    )

    db_session.expire_all()
    assert db_session.get(User, candidate.id).status is UserStatus.ACTIVE


def test_deactivate_requires_a_token(api_client) -> None:
    assert api_client.post("/api/v1/users/me/deactivate").status_code == 401


# --- deletion ---------------------------------------------------------------


def test_delete_requires_the_password(api_client, candidate) -> None:
    """A wrong password refuses, so the typed phrase alone is not enough."""

    response = api_client.request(
        "DELETE",
        "/api/v1/users/me",
        json={"password": "Wr0ngPassw0rd", "confirmation": "DELETE"},
        headers=candidate.headers,
    )

    assert response.status_code == 401


def test_delete_requires_the_typed_phrase(api_client, candidate) -> None:
    response = api_client.request(
        "DELETE",
        "/api/v1/users/me",
        json={"password": VALID_PASSWORD, "confirmation": "delete"},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_delete_removes_the_account(api_client, candidate, db_session: Session) -> None:
    from app.models import User

    response = api_client.request(
        "DELETE",
        "/api/v1/users/me",
        json={"password": VALID_PASSWORD, "confirmation": "DELETE"},
        headers=candidate.headers,
    )

    assert response.status_code == 204
    db_session.expire_all()
    assert db_session.get(User, candidate.id) is None


def test_a_deleted_account_cannot_sign_in(api_client, candidate) -> None:
    api_client.request(
        "DELETE",
        "/api/v1/users/me",
        json={"password": VALID_PASSWORD, "confirmation": "DELETE"},
        headers=candidate.headers,
    )

    response = api_client.post(
        "/api/v1/auth/login",
        json={"email": candidate.email, "password": VALID_PASSWORD},
    )

    assert response.status_code == 401
