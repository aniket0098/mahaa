"""Alembic environment for the message service.

Three things distinguish this from the main backend's ``env.py``:

1. **Its own version table.** ``version_table`` is
   ``alembic_version_message_service`` (read from ``alembic.ini``), so this
   history coexists with the main backend's in one database without either
   service ever seeing the other's revisions as its own.
2. **Its own metadata.** ``app.db.base.Base`` registers exactly one table —
   ``message_requests`` — so an autogenerate can only ever propose changes to
   the table this service owns. The shared ``users`` table is referenced by
   foreign keys but never created, altered or dropped here.
3. **No online migration from a developer machine.** The DSN comes from the
   environment like every other setting; the README is explicit that
   production migrations are run by an operator, not by a laptop.
"""

from __future__ import annotations

from logging.config import fileConfig

import sqlalchemy as sa
from sqlalchemy import engine_from_config, pool

from alembic import context
from app.core.config import get_settings

# Registers the `users` FK-target stub in the metadata before any model that
# references it is imported. See app/db/dependencies.py for why it exists and
# why it can never be migrated by mistake.
from app.db import dependencies  # noqa: F401
from app.db.base import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# The single table this service owns; the stub it references is never a
# migration candidate (see include_object below).
target_metadata = Base.metadata


def include_object(object, name, type_, reflected, compare_to):  # noqa: A002
    """Autogenerate sees ONLY `message_requests`.

    The metadata also carries the `users` stub (the FK target — see
    app/db/dependencies.py). Without this filter a diff could compare that
    stub against the real table and propose dropping columns this service has
    no business touching. The stub exists so a *string* foreign key can
    resolve; it is not a statement about the table's shape.
    """

    if isinstance(object, sa.Table):
        return object.name == dependencies.OWNED_TABLE
    owner = getattr(object, "table", None)
    if owner is not None and getattr(owner, "name", None) != dependencies.OWNED_TABLE:
        return False
    return True

#: Distinct from the main backend's ``alembic_version`` — see the module
#: docstring. Falls back to the ini value, then to this name, so a copy of the
#: ini cannot silently point the service at the main backend's history.
VERSION_TABLE = config.get_main_option("version_table") or "alembic_version_message_service"


def _database_url() -> str:
    return get_settings().database_url


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode — emit SQL, touch no database."""

    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table=VERSION_TABLE,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live database."""

    connectable = engine_from_config(
        # The section's `sqlalchemy.url` is left empty in the ini on purpose:
        # a URL in a committed file is a credential in a committed file.
        {"sqlalchemy.url": _database_url()},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table=VERSION_TABLE,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
