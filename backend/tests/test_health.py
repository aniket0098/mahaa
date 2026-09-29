"""Tests for the health and readiness endpoints.

These run without a database: ``/health`` never touches one, and ``/ready`` is
tested both ways by substituting the probe. A suite that needed a live database
would be skipped on CI and on a fresh checkout, which is exactly when a broken
health endpoint would go unnoticed.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel


@pytest.fixture()
def client() -> TestClient:
    from app.main import create_app

    return TestClient(create_app())


class _SamplePayload(BaseModel):
    """A body model used only to provoke a validation failure.

    Defined at MODULE scope, not inside the test function. This module uses
    ``from __future__ import annotations``, so every annotation is a string and
    FastAPI resolves it against the function's globals. A class defined inside a
    function is not in those globals, so the annotation would silently fail to
    resolve, FastAPI would treat ``payload`` as a query parameter instead, and
    the test would assert against the wrong error entirely.
    """

    quantity: int


def test_health_reports_ok(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    # The mobile client's type demands these four fields; a missing one would
    # render as undefined on a phone rather than fail a test.
    for field in ("status", "app", "version", "environment"):
        assert field in body, f"/health is missing '{field}'"
    assert isinstance(body["app"], str) and body["app"]
    assert isinstance(body["version"], str) and body["version"]
    assert isinstance(body["environment"], str) and body["environment"]


def test_health_needs_no_authentication(client: TestClient) -> None:
    """A monitor holds no bearer token, so this must never be behind auth."""
    assert client.get("/api/v1/health").status_code == 200


def test_health_does_not_touch_the_database(client: TestClient) -> None:
    """Liveness must not depend on the database.

    A liveness probe that queries the database restarts a healthy application
    whenever the database has a bad minute. Verified by making the probe raise:
    ``/health`` must still answer 200.
    """
    import app.api.v1.endpoints.health as health_module

    def explode() -> tuple[bool, str | None]:
        raise AssertionError("/health must not call the database probe")

    original = health_module.ping_database
    health_module.ping_database = explode
    try:
        assert client.get("/api/v1/health").status_code == 200
    finally:
        health_module.ping_database = original


def test_ready_is_200_when_the_database_answers(client: TestClient) -> None:
    import app.api.v1.endpoints.health as health_module

    original = health_module.ping_database
    health_module.ping_database = lambda: (True, None)
    try:
        response = client.get("/api/v1/ready")
    finally:
        health_module.ping_database = original

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"]["database"] == "ok"


def test_ready_is_503_when_the_database_is_unreachable(client: TestClient) -> None:
    import app.api.v1.endpoints.health as health_module

    original = health_module.ping_database
    health_module.ping_database = lambda: (False, "OperationalError")
    try:
        response = client.get("/api/v1/ready")
    finally:
        health_module.ping_database = original

    # 503 is what takes an instance out of rotation without killing it, and it
    # is the status the mobile client's ReadinessResponse documents.
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    # The driver class name crosses the wire; the message does not, because a
    # connection error can name internal hosts.
    assert body["checks"]["database"] == "OperationalError"


def test_every_response_carries_a_request_id(client: TestClient) -> None:
    """The app surfaces this for support, so it must exist on every response."""
    response = client.get("/api/v1/health")
    assert response.headers.get("X-Request-ID")


def test_an_inbound_request_id_is_preserved(client: TestClient) -> None:
    """A trace started upstream keeps one id end to end."""
    response = client.get("/api/v1/health", headers={"X-Request-ID": "trace-abc-123"})
    assert response.headers["X-Request-ID"] == "trace-abc-123"


def test_unknown_route_uses_the_error_envelope(client: TestClient) -> None:
    """A 404 must parse with the same client the app already has."""
    response = client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert isinstance(error["message"], str) and error["message"]
    assert "request_id" in error


def test_validation_failures_carry_field_names() -> None:
    """The client renders ``details[].field`` next to the offending input."""
    from app.main import create_app

    probe = create_app()

    @probe.post("/api/v1/_validation_probe")
    def _probe(payload: _SamplePayload) -> dict[str, int]:
        return {"quantity": payload.quantity}

    response = TestClient(probe).post(
        "/api/v1/_validation_probe", json={"quantity": "x"}
    )
    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert details, "a 422 with no field detail cannot be rendered inline"
    # The framework's location prefix is kept: the app strips it rather than
    # guessing where the value came from.
    assert any("quantity" in (d["field"] or "") for d in details)


# --------------------------------------------------------------------------
# Configuration: the fail-closed rules
# --------------------------------------------------------------------------


def test_settings_reject_a_non_postgres_url() -> None:
    """A wrong scheme would fail deep inside SQLAlchemy with an opaque error."""
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError, match="DATABASE_URL"):
        Settings(database_url="sqlite:///local.db")


def test_bare_postgresql_scheme_is_normalised() -> None:
    """A pasted ``postgresql://`` must not silently select an absent driver."""
    from app.core.config import Settings

    settings = Settings(database_url="postgresql://u:p@localhost:5432/mahaa")
    assert settings.database_url.startswith("postgresql+psycopg://")


def test_empty_database_url_is_rejected() -> None:
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError, match="DATABASE_URL"):
        Settings(database_url="   ")


def test_production_refuses_the_placeholder_database_url() -> None:
    """Fail closed: never boot production against a developer's default."""
    from pydantic import ValidationError

    from app.core.config import PLACEHOLDER_DATABASE_URL, Settings

    with pytest.raises(ValidationError, match="placeholder"):
        Settings(app_env="production", database_url=PLACEHOLDER_DATABASE_URL)


def test_production_refuses_debug_true() -> None:
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError, match="DEBUG"):
        Settings(
            app_env="production",
            database_url="postgresql+psycopg://u:p@db.example.com:5432/mahaa",
            debug=True,
        )


def test_production_refuses_a_wildcard_cors_origin() -> None:
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError, match="CORS_ORIGINS"):
        Settings(
            app_env="production",
            database_url="postgresql+psycopg://u:p@db.example.com:5432/mahaa",
            cors_origins="*",
        )


def test_importing_settings_does_not_require_a_database() -> None:
    """Configuration must be importable on a machine with no database at all.

    Every other test imports the app; if settings construction needed a live
    connection, the whole suite would depend on infrastructure.
    """
    module = importlib.import_module("app.core.config")
    assert module.get_settings() is not None
