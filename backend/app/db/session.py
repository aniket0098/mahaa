"""Database engine and session handling.

The engine is created once at import time and reused, so a request does not open
a new connection pool. ``pool_pre_ping`` matters on a hosted platform: a pooled
database (Neon, or anything behind a proxy) will hand back connections it has
already closed, and without this check that surfaces as a 500 on a request that
did nothing wrong.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_settings = get_settings()

# `pool_pre_ping` guards against a stale pooled connection; the recycling
# settings keep memory bounded on a long-lived free-tier instance.
engine: Engine = create_engine(
    _settings.database_url,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=5,
    max_overflow=5,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@contextmanager
def session_scope() -> Iterator[Session]:
    """A transactional scope: commit on success, roll back on any error."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a request-scoped session."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def ping_database() -> tuple[bool, str | None]:
    """Check connectivity with the cheapest possible query.

    Returns ``(ok, reason)`` rather than raising: readiness is a question with
    an answer, not an exception, and a monitoring probe should never see a
    traceback for a database that is simply not up yet.
    """
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True, None
    except Exception as exc:  # noqa: BLE001 - the reason is reported, not raised
        # The message may contain the host, never the password, but the client
        # sees it too, so only the exception class crosses the wire.
        return False, type(exc).__name__
