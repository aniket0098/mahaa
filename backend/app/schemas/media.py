"""Media read models — the wire shapes for §11.2's routes.

**``MediaLimits`` is a forward contract with the client that already exists.**
``src/api/media.ts`` declares all eight fields as *required* ``readonly``
properties, and §11.4 is explicit about why: "The server publishes these limits
so the client never hard-codes a copy — a limit change must not require a client
release." So this model has every one of them, non-optional, and every one is
read from the single authority in `services/media.py` rather than restated here.
A field the client does not read would be dead weight; a field the client reads
and finds missing would break the composer's pre-flight check.

**``MediaRead`` matches the client's ``MediaRead`` field for field**, including
that ``served_at`` is a path (§14.11) and that ``width``/``height`` are nullable.
The client types are exact — no optional properties — so anything marked optional
here would be a promise the server does not keep.

**No bytes, ever.** Nothing in this module can carry a ``BYTEA`` column. The
retrieval route returns a ``Response`` with the raw body, and the metadata routes
name their columns, so a stray serialization cannot put megabytes of binary into
a JSON response.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class MediaLimits(BaseModel):
    """``GET /media`` — a limits **document**, not a list (§11.4).

    The route name is a genuine trap: ``GET /media`` reads like a collection but
    returns this. §11.4 calls that out explicitly, and the client calls
    ``fetchMediaLimits()`` to get it.
    """

    model_config = ConfigDict(extra="forbid")

    #: Ceiling for an image or a video (§11.5: images "max 10 MB").
    max_bytes: int = Field(gt=0)
    #: How many assets one post may carry. A posts concern, published here
    #: because §11.4 names it as one of the fields the client already reads.
    max_items_per_post: int = Field(gt=0)
    #: Character ceiling on a post body. Likewise published, not enforced here.
    max_body_chars: int = Field(gt=0)
    image_mime_types: list[str]
    video_mime_types: list[str]
    #: §11.5: "Documents: PDF only, private, owner-only".
    document_mime_types: list[str]
    #: Lower than ``max_bytes`` — §11.4 calls this out as its own field for a
    #: reason: a resume is not a video.
    max_document_bytes: int = Field(gt=0)
    #: §11.4: an honest signal, not a limitation to hide. False because there is
    #: no decoder, so the UI does not claim it enforces a duration. It becomes
    #: true in the phase that adds one, with no client release.
    video_duration_enforced: bool


class MediaRead(BaseModel):
    """One asset's metadata — §14.11, minus everything private to the server.

    ``storage_kind``/``storage_key`` are omitted on purpose (§14.11 calls them
    reserved): they describe where bytes sit, which is an implementation detail
    that changes when storage moves, and publishing it would make that change a
    client-visible contract. ``owner_id`` is omitted for the same reason the
    notification actor is narrow: a caller only ever sees their own assets, so
    repeating the id teaches them nothing.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    kind: str
    mime_type: str
    #: Server-derived (§11.3). Null for video and documents.
    width: int | None
    height: int | None
    size_bytes: int
    #: A **relative path** such as ``/api/v1/media/<id>``. §14.11: "the relative
    #: path the client joins onto the base URL". Not a timestamp — the name is a
    #: trap and `absoluteMediaUri()` in the client is the proof.
    served_at: str
