"""Health, readiness and the error envelope — the probes and the contract.

These need no database, so they run on any machine: a green run here means
the process boots, the routes are mounted under ``/api/v1``, and every failure
comes back in the envelope the mobile client parses.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_is_liveness_and_touches_nothing() -> None:
    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["app"] == "Mahaa Message Service"
    assert set(body) == {"status", "app", "version", "environment"}
    # A correlation id on every response, so a client report can be matched to
    # a log line without either side inventing one.
    assert response.headers.get("X-Request-Id")


def test_root_names_the_api_instead_of_404() -> None:
    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.get("/")

    assert response.status_code == 200
    assert response.json()["api"] == "/api/v1"


def test_ready_answers_with_a_sanitized_check_result() -> None:
    """`/ready` reports `ready` or `not_ready` — never an exception, a DSN,
    or a driver message."""

    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.get("/api/v1/ready")

    body = response.json()
    assert body["status"] in {"ready", "not_ready"}
    assert set(body) == {"status", "checks"}
    assert set(body["checks"]) == {"database"}
    # 503 only when it says so, and 200 only when it says so.
    assert (response.status_code == 200) == (body["status"] == "ready")
    # The reason is a class name at most — never a connection string.
    assert "://" not in body["checks"]["database"]


def test_unknown_route_uses_the_error_envelope() -> None:
    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.get("/api/v1/no-such-route")

    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert isinstance(error["message"], str) and error["message"]
