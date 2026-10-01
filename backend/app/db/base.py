"""Declarative base, shared column conventions, and the metadata every model
registers against.

Alembic's autogenerate compares the live database against
``Base.metadata``. A model that forgets to be imported into
``app.models`` is therefore invisible to a migration, which is the usual reason
autogenerate "misses" a table. ``app/models/__init__.py`` re-exports the models
so ``env.py`` can import it and get the complete picture.

The conventions below are the ones the specification fixes for the whole
schema, expressed once so no table can quietly diverge:

* **Primary keys are application-generated UUIDs.** A sequential integer id is
  enumerable across accounts, so it is never used for an application entity.
* **Timestamps are timezone-aware** (``timestamptz``) and never naive, because a
  naive timestamp silently means different instants in different sessions.
* **Constraints are named deterministically** via ``naming_convention``, so a
  migration generated on one machine produces the same object names as one
  generated on another and ``alembic check`` stays quiet.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

#: Deterministic constraint names. Required for repeatable migrations: without
#: it, Alembic emits unnamed CHECK constraints that differ per environment.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Base class for every ORM model."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class UUIDPrimaryKeyMixin:
    """Application-generated UUID primary key.

    The default is Python-side rather than a server-side ``gen_random_uuid()``
    so the specification's "generated in the application" rule holds literally
    and no database extension is required for the primary key.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )


class TimestampMixin:
    """``created_at`` / ``updated_at``, both timezone-aware and non-nullable.

    ``server_default=func.now()`` means a row inserted outside the ORM (a data
    fix, another tool) still gets a real timestamp, and ``onupdate`` keeps
    ``updated_at`` honest for ORM writes.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class CreatedAtMixin:
    """``created_at`` only, timezone-aware.

    Three of the Phase 5 tables are append-mostly and have no meaningful
    ``updated_at``: a membership row is a join with its own ``joined_at``, and a
    message carries ``edited_at`` and ``deleted_at`` instead. Using
    :class:`TimestampMixin` for them would add a column the specification (§14.6)
    does not list and that nothing would ever update.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
