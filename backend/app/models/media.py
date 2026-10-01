"""``media_assets`` — the one row per upload, plus the bytes it describes.

**Metadata and binary live in one table, and that is the deliberate reading of
§14.11.** The column list there names no bytes column, but §11.1 calls binary
storage "a separate concern" *while* `storage_kind` defaults to `'database'`, and
`docs/feed-api-contract.md` has a heading that settles it: "Why bytes live in
the database". So the bytes are a ``BYTEA`` column here, and `storage_kind` is
what makes moving them a configuration change and a row update rather than a
schema redesign — the entire reason §11.1 reserves the column.

One table also means there is no way to end up with a metadata row whose content
is missing. The cost is that a careless ``SELECT`` pulls megabytes, so every
metadata read in `services/media.py` names its columns and every binary read
selects only the bytes.

**``served_at`` is a URL path, not a timestamp.** §14.11 says it "is the relative
path the client joins onto the base URL", and the client agrees:
``absoluteMediaUri()`` in `src/api/media.ts` returns
``${env.apiBaseUrl}${servedAt}`` for any value not already absolute. A name that
reads like "when was this served" is a genuine trap — it is written once, at
insert, from the row's own id, and nothing ever updates it. A route that stored a
timestamp here would break every image in the app.

**``owner_id`` is CASCADE** (§14.11), for the same reason notifications are: an
upload belongs to exactly one account, and deleting that account should take its
bytes with it rather than orphan content nobody can authorize.

**No FK on ``storage_key``.** It locates a row inside whatever backend
``storage_kind`` names — this row today, an object key later. A constraint would
have to be rewritten the day storage changed, which is the outcome `storage_kind`
exists to prevent.

**Duration is always NULL in V1.** §11.4 publishes `video_duration_enforced:
false` because there is no decoder, and §11.5 forbids trusting a client-declared
duration. So the column exists (the specification names it) and is never written.
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import BYTEA
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, UUIDPrimaryKeyMixin
from app.models.enums import MediaKind, pg_enum

#: The reserved storage backend for V1 (§14.11's default). Deliberately a plain
#: string rather than an enum: `s3` is expected to arrive when object storage is
#: chosen, and a CHECK would turn that into a migration instead of the
#: "configuration change and a row" §11.1 asks for.
STORAGE_KIND_DATABASE = "database"


class MediaAsset(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One uploaded file: its metadata, and — in V1 — its bytes."""

    __tablename__ = "media_assets"
    __table_args__ = (
        # §14.11's index. Owner-first because every read in this phase is "an
        # asset of this owner": the list an account sees, and the lookup that
        # precedes an authorization decision.
        Index(
            "ix_media_assets_owner_id_created_at",
            "owner_id",
            text("created_at DESC"),
        ),
        # §14.11's "CHECK ≥ 0". A negative size is not a value this application
        # can produce, so it is a database-level statement rather than an ORM
        # check some future writer could forget.
        CheckConstraint("size_bytes >= 0", name="size_bytes_non_negative"),
        {
            "comment": (
                "One uploaded file. served_at is a URL path the client joins onto "
                "the base URL, not a timestamp (§14.11)."
            )
        },
    )

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[MediaKind] = mapped_column(
        pg_enum(MediaKind, "media_kind"), nullable=False
    )
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    #: BigInteger, not Integer: §14.11 says bigint. Today's ceiling fits an int,
    #: but the ceiling is configuration and should not be a schema promise.
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    #: Server-derived from the bytes where the format makes it possible — §11.3:
    #: "re-derive dimensions from the bytes where feasible, and reject a
    #: mismatch". NULL for video and documents, which this phase does not decode.
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Always NULL in V1 — see the module docstring.
    duration_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    storage_kind: Mapped[str] = mapped_column(
        String(50), nullable=False, server_default=STORAGE_KIND_DATABASE
    )
    #: Locator within ``storage_kind``. For V1 this is the row's own id.
    storage_key: Mapped[str] = mapped_column(String(200), nullable=False)
    #: A **path**, e.g. ``/api/v1/media/<id>``. NOT NULL because the client joins
    #: it onto the base URL unconditionally.
    served_at: Mapped[str] = mapped_column(String(300), nullable=False)
    #: The bytes. Nullable only so a future ``storage_kind`` that keeps content
    #: elsewhere does not also need this column's nullability changed.
    data: Mapped[bytes | None] = mapped_column(BYTEA, nullable=True)

    owner: Mapped["User"] = relationship(foreign_keys=[owner_id])  # noqa: F821
