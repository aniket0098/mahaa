"""Request guards — body-size limit and database-down readiness.

Two cheap bounds that keep a malformed or oversized caller (or an unreachable
database) from turning into a 500, a stack trace, or a connection string on the
wire. Both run with no database rows, so they execute on any machine.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_oversized_body_is_413_in_the_envelope() -> None:
    """A body larger than the limit is refused before it is parsed — 413, not a
    500 and not a stack trace, in the same envelope the client parses."""

    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.post(
            "/api/v1/message-requests",
            # Far past the 64 KiB default; the shape never matters because the
            # middleware rejects on declared length before FastAPI reads it.
            json={"recipient_id": "x" * 200000},
            headers={"Authorization": "Bearer whatever"},
        )

    assert response.status_code == 413
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    # A size refusal must not leak how big, or why, beyond the generic sentence.
    assert "too large" in error["message"].lower()
    assert "://" not in error["message"]


def test_declared_content_length_over_the_limit_is_413() -> None:
    """The guard keys on the declared ``Content-Length`` header, so even a body
    that would parse fine is refused when it declares itself too large."""

    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.post(
            "/api/v1/message-requests",
            content=b"{}",
            headers={
                "Authorization": "Bearer whatever",
                "Content-Length": "999999",
            },
        )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "validation_error"


def test_a_malformed_content_length_is_refused_not_crashed() -> None:
    """A non-integer Content-Length must not reach ``int()`` and 500 — it is
    treated as invalid and refused cleanly."""

    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.post(
            "/api/v1/message-requests",
            content=b"{}",
            headers={
                "Authorization": "Bearer whatever",
                "Content-Length": "not-a-number",
            },
        )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "validation_error"


def test_requests_without_a_body_are_unaffected_by_the_guard() -> None:
    """Health and readiness carry no body, so the size guard never trips them —
    a liveness probe must not be blocked by a request-size rule."""

    from app.main import create_app

    with TestClient(create_app()) as client:
        assert client.get("/api/v1/health").status_code == 200


def test_ready_is_503_when_the_database_is_unreachable(monkeypatch) -> None:
    """Point the engine at a closed loopback port: readiness must report
    ``not_ready`` with 503 and a sanitized reason — no DSN, no driver message."""

    # The app builds its engine from DATABASE_URL at import time, so the engine
    # is patched in place rather than through configuration. A short
    # connect_timeout keeps the refusal instant (a default connect to a closed
    # port can block for the OS timeout, which would hang the suite on some
    # platforms) and `pool_pre_ping` is off so the ping cannot retry.
    from sqlalchemy import create_engine

    import app.db.session as db_session

    dead = create_engine(
        "postgresql+psycopg://user:pass@127.0.0.1:1/db",
        connect_args={"connect_timeout": 1},
        pool_pre_ping=False,
    )
    monkeypatch.setattr(db_session, "engine", dead)

    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.get("/api/v1/ready")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    reason = body["checks"]["database"]
    # The reason is an exception class name at most — never a connection string.
    assert "://" not in reason
    assert "127.0.0.1" not in reason
    assert reason  # and it is present, not blank


def test_health_still_succeeds_when_the_database_is_down(monkeypatch) -> None:
    """Liveness must not depend on the database: a DB outage is a readiness
    problem, not a reason to kill a healthy process."""

    from sqlalchemy import create_engine

    import app.db.session as db_session

    monkeypatch.setattr(
        db_session,
        "engine",
        create_engine(
            "postgresql+psycopg://u:p@127.0.0.1:1/db",
            connect_args={"connect_timeout": 1},
            pool_pre_ping=False,
        ),
    )

    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
