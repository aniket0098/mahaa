"""Shared fixtures for the message service's tests.

Same safety rules as ``backend/tests/conftest.py``, restated because they are
the ones that make this suite safe to run on any machine:

1. **Only a local database is ever touched.** The host is checked against an
   allowlist of loopback names and the fixture refuses to run otherwise, so a
   stray ``DATABASE_URL`` pointing at Neon can never have rows written through
   it — not even rolled-back ones.
2. **No test mutates the schema.** Tables are expected to exist already
   (``alembic upgrade head`` in ``backend/`` then in ``message-service/``).
   Each test runs inside one outer transaction that is always rolled back.
3. **No secret is ever printed.** A DSN failure is reported as an exception
   class, never as the connection string.

Point the suite at a database with either ``TEST_DATABASE_URL`` (preferred) or
``DATABASE_URL``. With neither set, the API tests that need rows skip — honestly,
with the command that would fix it — while the health/auth tests that need no
database still run.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine

#: Hosts the database tests are allowed to touch. Anything else — a Neon
#: hostname, a Render host, a private network address — is refused outright.
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "host.docker.internal"}

#: The two tables every database-backed test assumes. `users` comes from the
#: main backend's migrations; `message_requests` from this service's.
EXPECTED_TABLES = {"users", "message_requests"}


def _dsn() -> str:
    return os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL", "")


def _is_local(dsn: str) -> bool:
    """True only for a loopback host. Deliberately conservative."""

    tail = dsn.rsplit("@", 1)[-1]
    host = tail.split(":", 1)[0].strip("[]").lower()
    return host in LOCAL_HOSTS


# The application under test must open its engine against the *test* database,
# and it builds that engine at import time. So the environment is pinned
# before any ``app.*`` import happens anywhere in the suite (every fixture
# below imports the app lazily, inside the fixture).
_TEST_DSN = _dsn()
if _TEST_DSN:
    os.environ["DATABASE_URL"] = _TEST_DSN
# A deterministic development signing key when none is configured, so the
# token fixtures and the app agree without a real credential being involved.
os.environ.setdefault("JWT_SECRET", "dev-only-insecure-secret-change-me")


@pytest.fixture(scope="session")
def db_engine() -> Iterator[Engine]:
    """A local, already-migrated PostgreSQL, or a skip.

    Never creates or drops anything: the schema is expected to be in place.
    """

    from sqlalchemy import create_engine, inspect

    dsn = _dsn()
    if not dsn:
        pytest.skip(
            "Set TEST_DATABASE_URL (or DATABASE_URL) to a local PostgreSQL "
            "to run database tests."
        )
    if not _is_local(dsn):
        pytest.fail(
            "Refusing to run: the configured database is not local. These "
            "tests write and roll back rows, and must never be pointed at a "
            "production or shared database."
        )

    engine = create_engine(dsn, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            found = set(inspect(connection).get_table_names())
            missing = EXPECTED_TABLES - found
            if missing:
                pytest.skip(
                    f"Missing tables {sorted(missing)}. Run: alembic upgrade "
                    "head in backend/, then in message-service/"
                )
    except pytest.skip.Exception:  # pragma: no cover - re-raised below
        raise
    except Exception as exc:  # noqa: BLE001
        engine.dispose()
        # The exception class only: a driver message can embed the DSN.
        pytest.skip(f"Local database is not reachable: {type(exc).__name__}")

    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def db_session(db_engine) -> Iterator["Session"]:  # noqa: F821
    """A session whose work is always rolled back.

    One outer transaction, and the session joins it with ``create_savepoint``
    so a test's own ``commit()`` commits *inside* it — which is what lets a
    constraint test assert an ``IntegrityError`` and then carry on, while the
    final rollback still undoes everything.
    """

    from sqlalchemy.orm import Session

    conn = db_engine.connect()  # type: ignore[arg-type]
    transaction = conn.begin()
    session = Session(bind=conn, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        conn.close()


@pytest.fixture()
def user_factory(db_session):
    """Create a user row with unique identity fields, inside the rolled-back
    transaction.

    Raw SQL rather than an ORM model: ``users`` belongs to the main backend
    and mapping it here would put a table this service does not own into its
    registry — the exact duplication the service boundary exists to prevent.
    """

    def _make(
        *, name: str = "Test Person", designation: str | None = None, status: str = "active"
    ) -> uuid.UUID:
        from sqlalchemy import text

        user_id = uuid.uuid4()
        unique = uuid.uuid4().hex[:12]
        db_session.execute(
            text(
                """
                INSERT INTO users (id, public_id, username, email, password_hash, name,
                                   role, status, designation)
                VALUES (:id, :public_id, :username, :email, 'argon2id$not-a-real-hash',
                        :name, 'candidate', :status, :designation)
                """
            ),
            {
                "id": user_id,
                "public_id": f"MJ-{unique.upper()}",
                "username": f"user_{unique}",
                "email": f"{unique}@example.test",
                "name": name,
                "status": status,
                "designation": designation,
            },
        )
        db_session.flush()
        return user_id

    return _make


def mint_token(
    user_id: uuid.UUID,
    *,
    secret: str | None = None,
    issuer: str | None = None,
    audience: str | None = None,
) -> str:
    """Sign an access token exactly the way the main backend does.

    Deliberately re-implemented from the *documented* claim set (``sub``,
    ``role``, ``public_id``, ``type``, ``jti``, ``iat``, ``exp``, ``iss``,
    ``aud``) rather than imported from the main backend: the two services share
    a key and a contract, not a code path. A claim the message service
    requires but the test forgot would fail loudly in ``decode_access_token``.
    """

    from datetime import UTC, datetime, timedelta

    import jwt

    from app.core.config import get_settings

    settings = get_settings()
    now = datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "role": "candidate",
        "public_id": "MJ-TESTTEST",
        "type": "access",
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
        "iss": issuer or settings.jwt_issuer,
        "aud": audience or settings.jwt_audience,
    }
    return jwt.encode(
        claims,
        secret or settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def headers_for(user_id: uuid.UUID, **overrides) -> dict[str, str]:
    """Bearer headers for a user, or for a deliberately broken token when the
    test asks for one (``secret='wrong'`` signs with a different key)."""

    return {"Authorization": f"Bearer {mint_token(user_id, **overrides)}"}


@pytest.fixture()
def client():
    """A TestClient with no database override.

    Used by tests whose request never reaches a query — a missing token is
    rejected before the session is touched — so they run on a machine with no
    PostgreSQL at all instead of skipping with the database tests.
    """

    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture()
def api_client(db_session):
    """A TestClient whose routes use the rolled-back test session.

    The app is built for real — real routing, real auth dependency, real error
    handlers — and only the database session is swapped, so a test exercises
    the actual request path rather than a stubbed one.
    """

    from fastapi.testclient import TestClient

    from app.db.session import get_db
    from app.main import create_app

    def _override_get_db():
        yield db_session

    application = create_app()
    application.dependency_overrides[get_db] = _override_get_db
    with TestClient(application) as client:
        yield client


#: Every way a bad write can be refused: a unique, FK, NOT NULL or CHECK
#: violation surfaces as ``IntegrityError`` from the session.
from sqlalchemy.exc import IntegrityError  # noqa: E402

REJECTION_ERRORS = (IntegrityError,)
