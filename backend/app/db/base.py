"""Declarative base and the metadata every model registers against.

Alembic's autogenerate compares the live database against
``Base.metadata``. A model that forgets to be imported into
``app.models`` is therefore invisible to a migration, which is the usual reason
autogenerate "misses" a table. ``app/models/__init__.py`` re-exports the models
so ``env.py`` can import it and get the complete picture.
"""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for every ORM model."""
