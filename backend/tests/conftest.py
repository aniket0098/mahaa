"""Shared fixtures.

The database tests need a real PostgreSQL, because most of what Phase 1 promises
lives *in* the database and not in Python: a ``UNIQUE`` constraint, a
``CHECK`` constraint, and a ``citext`` comparison are behaviours of the server.
A SQLite stand-in would test none of them and would pass while the real schema
was broken.

Two rules keep that safe and keep the suite green on a machine with no database —
the same philosophy ``test_health.py`` already follows:

1. **Only a local database is ever touched.** The host is checked against an
   allowlist of loopback names and the fixture refuses to run otherwise, so a
   stray ``DATABASE_URL`` pointing at Neon can never have ``create_all`` or a
   rollback driven at it.
2. **No test mutates the schema.** Tables are expected to exist already (run
   ``alembic upgrade head`` first). Each test runs inside a transaction that is
   always rolled back, so rows never survive and nothing is created or dropped.

Point the suite at a database with either ``TEST_DATABASE_URL`` (preferred) or
``DATABASE_URL``.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session

#: Hosts the database tests are allowed to touch. Anything else — a Neon
#: hostname, a Render host, a private network address — is refused outright.
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "host.docker.internal"}

#: Every table the Phase 1 migration is expected to have created.
EXPECTED_TABLES = {
    "achievements",
    "certifications",
    "education",
    "experience",
    "profile_links",
    "profile_preferences",
    "profile_privacy",
    "profiles",
    "project_skills",
    "projects",
    "skills",
    "user_skills",
    "users",
}


def _dsn() -> str:
    return os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL", "")


def _is_local(dsn: str) -> bool:
    """True only for a loopback host. Deliberately conservative."""

    tail = dsn.rsplit("@", 1)[-1]
    host = tail.split(":", 1)[0].strip("[]").lower()
    return host in LOCAL_HOSTS


@pytest.fixture(scope="session")
def db_engine() -> Iterator[Engine]:
    """A local, already-migrated PostgreSQL, or a skip.

    Never creates or drops anything: the schema is expected to be in place.
    """

    dsn = _dsn()
    if not dsn:
        pytest.skip("Set TEST_DATABASE_URL to a local PostgreSQL to run db tests.")
    if not _is_local(dsn):
        pytest.fail(
            "Refusing to run: the configured database is not local. "
            "These tests write and roll back rows, and must never be pointed "
            "at a production or shared database."
        )

    engine = create_engine(dsn, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            found = {t for t in inspect(connection).get_table_names()}
            missing = EXPECTED_TABLES - found
            if missing:
                pytest.skip(
                    "Phase 1 tables are not present "
                    f"(missing {sorted(missing)}). Run: alembic upgrade head"
                )
            has_citext = connection.execute(
                text("SELECT 1 FROM pg_extension WHERE extname = 'citext'")
            ).first()
            if not has_citext:
                pytest.skip("citext extension is missing; run: alembic upgrade head")
    except pytest.skip.Exception:  # pragma: no cover - re-raised below
        raise
    except Exception as exc:  # noqa: BLE001
        engine.dispose()
        pytest.skip(f"Local database is not reachable: {type(exc).__name__}")

    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def db_session(db_engine: Engine) -> Iterator[Session]:
    """A session whose work is always rolled back.

    An outer transaction is opened on the connection and rolled back at the end
    of the test, so a test that commits still leaves the database exactly as it
    found it.
    """

    conn = db_engine.connect()
    # The session is bound to the *connection*, and told to treat it as an
    # already-joined external transaction (`create_savepoint`). Without that,
    # a test's own `commit()` would try to commit the connection-level
    # transaction and deassociate it, so the rollback below could no longer undo
    # the test. With savepoints, both `commit()` and `begin_nested()` work
    # inside the single transaction that is rolled back at the end — which is
    # what lets a constraint test assert a failure and then carry on.
    transaction = conn.begin()
    session = Session(bind=conn, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        conn.close()


@pytest.fixture()
def user_factory(db_session: Session):
    """Create a valid user, with unique identity fields per call.

    Uniqueness is enforced by the database, so a fixture that reuses one email
    would fail the second test that uses it rather than testing anything.
    """

    from app.models import User

    def _make(**overrides) -> User:
        unique = uuid.uuid4().hex[:12]
        values = {
            "public_id": f"MJ-{unique.upper()}",
            "username": f"user_{unique}",
            "email": f"{unique}@example.test",
            "name": "Test Person",
            "password_hash": "argon2id$not-a-real-hash",
        }
        values.update(overrides)
        user = User(**values)
        db_session.add(user)
        db_session.flush()
        return user

    return _make


#: Every way a bad write can be refused. A database-level violation (unique,
#: foreign key, NOT NULL, CHECK) surfaces as ``IntegrityError``. A closed
#: vocabulary enforced by the ORM's own type raises ``StatementError`` wrapping a
#: ``LookupError`` *before* the statement is sent — which is the better outcome,
#: because it is a round trip saved, and the CHECK constraint still exists for
#: anything that bypasses the ORM.
REJECTION_ERRORS = (IntegrityError, StatementError, LookupError, ValueError)

# Imported here rather than inside the Phase 3 fixtures so the import cost is paid
# once at collection, and so a missing model is a collection error with a clear
# name rather than a fixture error at run time.
from app.models import Skill  # noqa: E402


@pytest.fixture()
def api_client(db_session: Session):
    """A TestClient whose routes use the rolled-back test session.

    The app is built for real — real routing, real dependencies, real error
    handlers — and only the database session is swapped, so a test exercises the
    actual request path rather than a stubbed one. Because the session is the
    same rolled-back one the other fixtures use, rows written through HTTP never
    survive the test.
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


@pytest.fixture(autouse=True)
def _no_rate_limit_by_default(request):
    """Turn the auth rate limiter off for tests, except where a test asks for it.

    A limiter that counts every call in a suite would make the tests
    order-dependent — an early test would spend the budget and a later one would
    fail for no reason. The limiter itself is still tested, explicitly, by the
    tests that opt back in with ``@pytest.mark.usefixtures`` style opt-in via
    the ``rate_limited`` fixture.
    """

    if "allow_rate_limit" in request.fixturenames:
        yield
        return
    from app.core.config import get_settings

    settings = get_settings()
    previous = settings.auth_rate_limit_enabled
    settings.auth_rate_limit_enabled = False
    try:
        yield
    finally:
        settings.auth_rate_limit_enabled = previous


@pytest.fixture()
def allow_rate_limit():
    """Re-enable the limiter for the tests that assert it exists.

    Counters are reset first so one test's requests cannot throttle the next.
    """

    from app.core.config import get_settings
    from app.core.rate_limit import auth_limiter

    settings = get_settings()
    previous = settings.auth_rate_limit_enabled
    settings.auth_rate_limit_enabled = True
    auth_limiter.reset()
    try:
        yield settings
    finally:
        settings.auth_rate_limit_enabled = previous
        auth_limiter.reset()


@pytest.fixture()
def auth_email() -> str:
    """A unique, valid address.

    ``@example.com`` is accepted by ``EmailStr``; ``@example.test`` is not,
    because ``email-validator`` treats ``.test`` as a special-use TLD. The same
    domain the mobile integration suite defaults to, so both agree.
    """

    return f"phase2.{uuid.uuid4().hex[:12]}@example.com"


#: Satisfies the policy in `app.services.passwords`: 8+ chars, a letter, a digit.
VALID_PASSWORD = "Passw0rd123"


# --- Phase 3: accounts and profiles ----------------------------------------


class Account:
    """A registered account plus the headers that authenticate it.

    Returned rather than a bare token because almost every Phase 3 test needs
    three things at once — the token, the auth headers, and the id to assert
    ownership against — and unpacking a tuple three times per test is noise.
    """

    def __init__(self, body: dict, token: str, role: str) -> None:
        self.body = body
        self.token = token
        self.role = role
        self.id = body["id"]
        self.username = body["username"]
        self.email = body["email"]

    @property
    def headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}


def register(
    api_client, email: str, role: str = "candidate", password: str = VALID_PASSWORD
) -> Account:
    """Sign up through the real endpoint and return an authenticated account."""

    response = api_client.post(
        "/api/v1/auth/signup", json=signup_body(email, role=role, password=password)
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    me = api_client.get(
        "/api/v1/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.status_code == 200, me.text
    return Account(me.json(), token, role)


@pytest.fixture()
def candidate(api_client, auth_email: str) -> Account:
    """A signed-in candidate — the account every profile test acts as."""

    return register(api_client, auth_email)


@pytest.fixture()
def other_candidate(api_client) -> Account:
    """A second, unrelated candidate.

    Exists so the ownership tests can be honest: a test that only ever uses one
    account cannot tell a working ownership check from one that is missing,
    because there is nothing to steal.
    """

    return register(api_client, f"other.{uuid.uuid4().hex[:12]}@example.com")


@pytest.fixture()
def employer(api_client) -> Account:
    """An employer, for the role-guard tests.

    The integration suite asserts an employer gets 403 from the candidate profile
    routes, so the backend needs a way to produce one.
    """

    return register(api_client, f"employer.{uuid.uuid4().hex[:12]}@example.com",
                    role="employer")


@pytest.fixture()
def make_skill(db_session: Session):
    """Create catalogue skills on demand.

    The catalogue is database-backed by design, so a test that wants a skill to
    add creates a real row rather than relying on seeded data that a later test
    might depend on the absence of.
    """

    counter = {"n": 0}

    def _make(name: str | None = None, category: str | None = None) -> Skill:
        counter["n"] += 1
        skill = Skill(
            name=name or f"Test Skill {counter['n']}",
            category=category if category is not None else "Testing",
        )
        db_session.add(skill)
        db_session.commit()
        db_session.refresh(skill)
        return skill

    return _make


def signup_body(email: str, **overrides) -> dict:
    """A signup payload in the exact shape `src/api/auth.ts` sends."""

    body = {
        "name": "Phase Two Candidate",
        "email": email,
        "password": VALID_PASSWORD,
        "phone": None,
        "role": "candidate",
    }
    body.update(overrides)
    return body


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def assert_rejected(session: Session, obj: object) -> None:
    """Assert the database refuses ``obj``, then drop it from the session.

    Discarding the object is not tidiness, it is required. Rolling the savepoint
    back undoes the database change, but the object can stay *pending* in the
    session — so the next ``flush()`` would retry the same bad row and raise
    outside the assertion, failing a test for the wrong reason. A failed flush
    may also have detached it already, hence the membership check.
    """

    session.add(obj)  # type: ignore[arg-type]
    try:
        with session.begin_nested():
            session.flush()
    except REJECTION_ERRORS:
        if obj in session:
            session.expunge(obj)  # type: ignore[arg-type]
        return
    raise AssertionError(
        f"expected {type(obj).__name__} to be rejected, but it was accepted"
    )


def assert_delete_rejected(session: Session, obj: object) -> None:
    """The same idea for a refused DELETE (e.g. an FK ``RESTRICT``)."""

    session.delete(obj)  # type: ignore[arg-type]
    try:
        with session.begin_nested():
            session.flush()
    except REJECTION_ERRORS:
        return
    raise AssertionError(f"expected deleting {type(obj).__name__} to be rejected")
