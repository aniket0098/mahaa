"""Authentication: which tokens this service accepts, and which it refuses.

The claim set is the main backend's (``sub``/``role``/``public_id``/``type``/
``jti``/``iat``/``exp``/``iss``/``aud``), verified with the shared
``JWT_SECRET`` and a pinned algorithm. A failure is always one generic 401 —
expired, forged, wrong-audience and not-a-token must be indistinguishable, or
the response becomes an oracle.

These tests need no database rows (the "user does not exist" case needs only a
token), but they do need the app to boot, so they run everywhere the package
imports.
"""

from __future__ import annotations

import uuid

from conftest import headers_for


def test_missing_token_is_401_in_the_envelope(client) -> None:
    response = client.get("/api/v1/message-requests/count")

    assert response.status_code == 401
    error = response.json()["error"]
    assert error["code"] == "not_authenticated"
    assert error["message"]


def test_garbage_token_is_401_with_no_internals_leaked(client) -> None:
    response = client.get(
        "/api/v1/message-requests/count",
        headers={"Authorization": "Bearer not-a-real-token"},
    )

    assert response.status_code == 401
    error = response.json()["error"]
    assert error["code"] == "not_authenticated"
    # One generic sentence for every cause — it must not become an oracle by
    # naming the reason (not "signature", not "malformed", not a library error).
    assert "signature" not in error["message"].lower()
    assert "malformed" not in error["message"].lower()
    assert "pyjwt" not in error["message"].lower()


def test_wrong_scheme_is_401(client) -> None:
    response = client.get(
        "/api/v1/message-requests/count", headers={"Authorization": "Basic abc"}
    )

    assert response.status_code == 401


def test_token_signed_with_a_different_secret_is_401(client) -> None:
    """The one test that proves the shared key is actually checked."""

    response = client.get(
        "/api/v1/message-requests/count",
        headers=headers_for(uuid.uuid4(), secret="some-other-key-entirely"),
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


def test_token_with_the_wrong_audience_is_401(client) -> None:
    response = client.get(
        "/api/v1/message-requests/count",
        headers=headers_for(uuid.uuid4(), audience="some-other-app"),
    )

    assert response.status_code == 401


def test_token_naming_a_user_that_does_not_exist_is_401(api_client) -> None:
    """Not 404: the session the client holds is no longer valid, and the
    mobile client treats 401 as "sign in again" — exactly right."""

    response = api_client.get(
        "/api/v1/message-requests/count",
        headers=headers_for(uuid.uuid4()),
    )

    assert response.status_code == 401


def test_suspended_account_is_403_not_401(api_client, user_factory) -> None:
    """A known, authenticated principal who is not permitted gets 403 — a
    different screen from "signed out" on the client."""

    suspended = user_factory(status="suspended")
    response = api_client.get(
        "/api/v1/message-requests/count", headers=headers_for(suspended)
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"
