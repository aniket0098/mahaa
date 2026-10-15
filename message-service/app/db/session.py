"""Database engine and session handling.

Same shape as ``backend/app/db/session.py``: one engine at import time,
``pool_pre_ping`` for hosted databases (a pooled connection handed back after
the server closed it surfaces as a 500 otherwise), and a request-scoped
session per FastAPI dependency.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_settings = get_settings()

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
    """``(ok, reason)`` for the readiness probe — never an exception.

    Only the exception **class** crosses the wire: a driver message can name
    internal hosts or a DSN fragment, and ``/ready`` is unauthenticated.
    """

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True, None
    except Exception as exc:  # noqa: BLE001 - the reason is reported, not raised
        return False, type(exc).__name__
