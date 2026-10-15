"""Read-only access to the shared ``users`` table.

**This service never writes a main-backend table.** The only reads are the two
the message-request domain needs: resolve the authenticated caller (auth), and
summarise a sender for a request card. Everything else — profiles, media
bytes, connections, conversations — stays behind the main API's own routes.

Explicit SQL rather than an ORM mapping on purpose: mapping ``users`` into this
service's declarative registry would put a table this service does not own
into its Alembic autogenerate, which is exactly the duplicate-ownership failure
this boundary exists to prevent.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class UserRow:
    """The columns a request card or an auth check actually uses."""

    id: uuid.UUID
    public_id: str
    username: str
    name: str
    role: str
    status: str
    designation: str | None
    avatar_url: str | None


#: Columns read from ``users``, plus the avatar's served path. Deliberately
#: explicit: no ``email``, no ``phone``, no ``password_hash`` — the query
#: cannot leak what it never asks for. The avatar is a LEFT JOIN onto
#: ``media_assets`` so a missing asset degrades to ``None`` (the client falls
#: back to initials) instead of filtering the person out of the list.
_SELECT_USER = (
    "SELECT u.id, u.public_id, u.username, u.name, u.role, u.status, "
    "u.designation, m.served_at AS avatar_url "
    "FROM users u "
    "LEFT JOIN media_assets m ON m.id = u.avatar_media_id "
)


def _to_user(row) -> UserRow:  # noqa: ANN001 - SQLAlchemy Row, duck-typed
    return UserRow(
        id=row.id,
        public_id=row.public_id,
        username=row.username,
        name=row.name,
        role=row.role,
        status=row.status,
        designation=row.designation,
        avatar_url=row.avatar_url,
    )


def find_user(session: Session, user_id: uuid.UUID) -> UserRow | None:
    """One user by internal id, or ``None``. Read-only."""

    row = session.execute(text(_SELECT_USER + "WHERE u.id = :id"), {"id": user_id}).first()
    return None if row is None else _to_user(row)


def find_users(session: Session, user_ids: set[uuid.UUID]) -> dict[uuid.UUID, UserRow]:
    """Many users in one query, keyed by id. Missing ids are simply absent."""

    if not user_ids:
        return {}
    rows = session.execute(
        text(_SELECT_USER + "WHERE u.id = ANY(:ids)"), {"ids": list(user_ids)}
    ).all()
    return {row.id: _to_user(row) for row in rows}
