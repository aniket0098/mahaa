"""Tables this service *references* but does not own.

``message_requests`` has foreign keys to ``users``, and SQLAlchemy resolves a
string FK against the metadata of the declaring model — so the target table
must exist here as a table object. The trap is obvious: a ``users`` table in
this metadata could show up in an ``alembic autogenerate`` diff and propose
altering a table that belongs to the main backend.

Two defences, both required:

1. **Key columns only.** The stub declares ``id`` and nothing else — no email,
   no password hash. It is structurally incapable of representing an
   alteration to any column this service does not use, and it is never used to
   ``SELECT`` (``app/services/identity.py`` writes its own explicit SQL).
2. **An autogenerate filter.** ``alembic/env.py`` passes
   ``include_object`` that admits only ``message_requests``, so even a diff
   that noticed the stub could not emit DDL for it.

No ORM model maps this table, so nothing can ever ``INSERT`` through it.
"""

from __future__ import annotations

from sqlalchemy import Column, Table
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from app.db.base import Base

#: The main backend's ``users`` table, referenced only as an FK target.
#: ``extend_existing`` so a re-import in a long-lived process is harmless.
users = Table(
    "users",
    Base.metadata,
    Column("id", PGUUID(as_uuid=True), primary_key=True),
    extend_existing=True,
)

#: The one table this service's migrations are allowed to touch. Named here so
#: ``alembic/env.py`` and this module cannot drift apart.
OWNED_TABLE = "message_requests"
