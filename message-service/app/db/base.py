"""Declarative base and column conventions for the tables this service owns.

Deliberately a *second* Base rather than an import from ``backend/``: the two
services ship in separate Docker build contexts, and a model registered here
must never drift into the main backend's Alembic autogenerate. Only
``message_requests`` registers against this metadata — every other table in the
shared database belongs to the main backend and is read with a plain ``SELECT``
(see ``app/services/identity.py``).

The conventions mirror ``backend/app/db/base.py`` so a row written by either
service looks the same: application-generated UUID primary keys,
timezone-aware timestamps, and deterministic constraint names so migrations
are reproducible across machines.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

#: Deterministic constraint names — required for repeatable migrations.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Base class for the models this service owns."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class UUIDPrimaryKeyMixin:
    """Application-generated UUID primary key (no extension required)."""

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )


class CreatedAtMixin:
    """``created_at`` only — append-mostly rows with no meaningful update."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
