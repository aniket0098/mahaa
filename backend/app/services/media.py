"""Media: limits, validation, storage, and owner-scoped retrieval — §11.

**One authority for the limits.** `GET /media` publishes them so "a limit change
must not require a client release" (§11.4), which only works if there is exactly
one copy. Every number below is defined once, in this module, and the same
constants drive both the published document and the enforcement path — a test
asserts they are the same objects, because two lists that agree today drift by
Phase 8.

**The client's ``Content-Type`` is a claim, not evidence.** §11.3: the server
"must not trust them — re-derive dimensions from the bytes where feasible, and
reject a mismatch". So validation sniffs the payload's magic bytes and compares
the sniffed type against the declared one; a `Content-Type: image/png` header on
a PHP script is a 422. `python-magic` is not a dependency and no image library
is either: PNG, JPEG and WebP each have a header that is a few lines to read, and
pulling in Pillow to do that would be a large dependency for a fixed answer.

**Dimensions are derived, never accepted.** The client sends ``width``/``height``
because `uploadUrl()` builds them, and §11.3 says they must not be trusted. They
are treated as a *cross-check*: the stored values come from the bytes, and a
mismatch is rejected rather than silently corrected, so a picker bug surfaces
here instead of as a stretched avatar.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError, ErrorCode, error_detail
from app.models import MediaAsset, User
from app.models.enums import MediaKind
from app.models.media import STORAGE_KIND_DATABASE
from app.schemas.media import MediaLimits, MediaRead
from app.services.ownership import parse_id

# `PostMedia` is only needed for the return annotation of `_tombstoned_links` and
# for the queries themselves, which import it locally alongside `Post`. A top-level
# import is deliberately avoided: the media service should not depend on the posts
# tables being importable, and that direction only gets harder to reverse as
# stories and the career domain add more tables.
if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.models.posts import PostMedia

# --- limits: the single authority --------------------------------------------

#: §11.5: "Images: PNG/JPEG/WebP, max 10 MB." The same ceiling covers video,
#: which §11.4 treats as the larger of the two ("the document ceiling, which is
#: lower than the video one" — so video's is this one).
MAX_BYTES = 10 * 1024 * 1024

#: §11.5: "Documents: PDF only, private, owner-only, lower ceiling than video."
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024

#: Published because §11.4 names it among the fields the client reads. A posts
#: concern rather than a media one, but the client reads it from here, so here is
#: where it is published.
MAX_ITEMS_PER_POST = 10

#: Likewise published, likewise enforced by posts rather than here.
MAX_BODY_CHARS = 5000

#: §11.5's exact image set. WebP is listed in the specification, not guessed.
IMAGE_MIME_TYPES = ("image/png", "image/jpeg", "image/webp")

#: The two container types a phone picker produces for video. MP4 covers both
#: `.mp4` and the MPEG-4 parts of a `.mov`; QuickTime is `.mov` proper.
VIDEO_MIME_TYPES = ("video/mp4", "video/quicktime")

#: §11.5: "Documents: PDF only."
DOCUMENT_MIME_TYPES = ("application/pdf",)

#: §11.4: published as ``false`` because there is no decoder. §11.5 wants a
#: server-side duration probe; without one, claiming enforcement would be a lie
#: the client would build a UI on. It flips when a decoder exists.
VIDEO_DURATION_ENFORCED = False

#: The path prefix the client joins onto its base URL (§14.11's ``served_at``).
#: Written into the row, so it has to match where the route is actually mounted.
MEDIA_PATH_PREFIX = "/api/v1/media"

#: Read in one pass, and always bounded. Nothing here grows with the file: the
#: headers live at fixed offsets, and JPEG's scan stops as soon as a frame header
#: is found rather than walking every segment.
_MAX_HEADER_BYTES = 64 * 1024


# --- limits ------------------------------------------------------------------


def limits() -> MediaLimits:
    """``GET /media`` — §11.4's document, built from the constants above.

    Every field is read from a constant in this module, so the number a client
    reads to pre-flight a picker is by construction the number the upload path
    enforces. Publishing a hand-copied second list is how those two would drift.
    """

    return MediaLimits(
        max_bytes=MAX_BYTES,
        max_items_per_post=MAX_ITEMS_PER_POST,
        max_body_chars=MAX_BODY_CHARS,
        image_mime_types=list(IMAGE_MIME_TYPES),
        video_mime_types=list(VIDEO_MIME_TYPES),
        document_mime_types=list(DOCUMENT_MIME_TYPES),
        max_document_bytes=MAX_DOCUMENT_BYTES,
        video_duration_enforced=VIDEO_DURATION_ENFORCED,
    )


def _allowed_mime_types(kind: MediaKind) -> tuple[str, ...]:
    return {
        MediaKind.IMAGE: IMAGE_MIME_TYPES,
        MediaKind.VIDEO: VIDEO_MIME_TYPES,
        MediaKind.DOCUMENT: DOCUMENT_MIME_TYPES,
    }[kind]


def _max_bytes_for(kind: MediaKind) -> int:
    """Documents get their own, lower ceiling (§11.4/§11.5)."""

    return MAX_DOCUMENT_BYTES if kind is MediaKind.DOCUMENT else MAX_BYTES


# --- sniffing ----------------------------------------------------------------


def _sniff_png(head: bytes) -> tuple[str, int, int] | None:
    """PNG's IHDR carries the dimensions at a fixed offset (§11.3)."""

    if len(head) < 24 or head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    if head[12:16] != b"IHDR":
        return None
    width = int.from_bytes(head[16:20], "big")
    height = int.from_bytes(head[20:24], "big")
    return "image/png", width, height


def _sniff_jpeg(head: bytes) -> tuple[str, int, int] | None:
    """Walk JPEG segments to the first SOF, which is where the frame lives.

    SOFn markers are ``0xFFC0``..``0xFFCF`` minus the four that carry no frame:
    DHT/JPG/DAC. Stopping at the first one is what keeps this O(header) rather
    than O(file) on an image with a large EXIF block ahead of the frame.
    """

    if len(head) < 4 or head[:2] != b"\xff\xd8":
        return None
    offset = 2
    while offset + 4 <= len(head):
        if head[offset] != 0xFF:
            offset += 1
            continue
        marker = head[offset + 1]
        # A standalone marker (no length payload) — skip the padding byte.
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            offset += 2
            continue
        if offset + 4 > len(head):
            return None
        length = int.from_bytes(head[offset + 2 : offset + 4], "big")
        is_sof = 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC)
        if is_sof:
            if offset + 9 > len(head):
                return None
            height = int.from_bytes(head[offset + 5 : offset + 7], "big")
            width = int.from_bytes(head[offset + 7 : offset + 9], "big")
            return "image/jpeg", width, height
        if length < 2:
            return None
        offset += 2 + length
    return None


def _sniff_webp(head: bytes) -> tuple[str, int, int] | None:
    """WebP has three container flavours with dimensions in different places."""

    if len(head) < 16 or head[:4] != b"RIFF" or head[8:12] != b"WEBP":
        return None
    chunk = head[12:16]
    if chunk == b"VP8X" and len(head) >= 30:
        # 24-bit little-endian, minus one (the fields are stored value - 1).
        width = int.from_bytes(head[24:27], "little") + 1
        height = int.from_bytes(head[27:30], "little") + 1
        return "image/webp", width, height
    if chunk == b"VP8 " and len(head) >= 30:
        width = int.from_bytes(head[26:28], "little") & 0x3FFF
        height = int.from_bytes(head[28:30], "little") & 0x3FFF
        return "image/webp", width, height
    if chunk == b"VP8L" and len(head) >= 25:
        bits = int.from_bytes(head[21:25], "little")
        return "image/webp", (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    return None


def sniff(head: bytes) -> tuple[str, int | None, int | None] | None:
    """What the bytes actually are, from their magic numbers.

    Returns ``(mime_type, width, height)``, with the dimensions ``None`` for a
    type this phase does not decode — video containers and PDF are recognised by
    signature so their MIME can still be *validated*, but their dimensions are
    not guessed. §11.5 forbids trusting a client for duration, and by the same
    reasoning a client-supplied width is not evidence of anything.
    """

    for probe in (_sniff_png, _sniff_jpeg, _sniff_webp):
        found = probe(head)
        if found is not None:
            return found
    # MP4/MOV: an ISO base-media file, which carries `ftyp` at offset 4. The
    # brand tells QuickTime from MP4, which is the only distinction §11.5's
    # "video" needs here.
    if len(head) >= 12 and head[4:8] == b"ftyp":
        brand = head[8:12]
        mime = "video/quicktime" if brand in (b"qt  ",) else "video/mp4"
        return mime, None, None
    # PDF: `%PDF-` per its own specification. The version digit is checked but the
    # separator is not -- the format writes `%PDF-<major>.<minor>`, so demanding
    # three consecutive digits after the dash would reject every real file.
    if head[:5] == b"%PDF-" and len(head) >= 6 and head[5:6].isdigit():
        return "application/pdf", None, None
    return None


# --- errors ------------------------------------------------------------------


def _unprocessable(message: str, field: str, hint: str) -> ApiError:
    """A 422 that *names the limit* it broke.

    §11.5 asks for exactly this on the duration rejection: "Reject with a 422
    that names the limit." The hint carries the number, so a client can render it
    without hard-coding it — the same reason §11.4 publishes the limits.
    """

    return ApiError(
        status_code=422,
        code=ErrorCode.UNPROCESSABLE,
        message=message,
        details=[error_detail(field, hint, "value_error")],
    )


def _not_found() -> ApiError:
    """One answer for "no such asset" and "not yours" (§16)."""

    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message="That media file was not found.",
    )


def _too_large(limit: int) -> ApiError:
    """413 when the declared length alone already exceeds the ceiling.

    Checked before the body is read, so an oversized upload costs a header
    comparison rather than 10 MB of buffering. ``Content-Length`` is absent on a
    chunked request, in which case `upload` catches the overrun while streaming.
    """

    return ApiError(
        status_code=413,
        code=ErrorCode.UNPROCESSABLE,
        message=f"That file is larger than the {_mib(limit)} limit.",
    )


def _mib(limit: int) -> str:
    return f"{limit // (1024 * 1024)} MB"


# --- validation --------------------------------------------------------------


def parse_kind(raw: str | None) -> MediaKind:
    """The ``kind`` query parameter, or a 422 naming the three real values."""

    try:
        return MediaKind(raw or "")
    except ValueError:
        raise _unprocessable(
            "That kind of media cannot be uploaded.",
            "query.kind",
            "Use one of: " + ", ".join(k.value for k in MediaKind),
        ) from None


def normalise_content_type(declared: str | None) -> str:
    """Strip parameters and case from a ``Content-Type`` header.

    ``image/png; charset=binary`` and ``IMAGE/PNG`` are the same type, and a
    client that sends parameters must not be rejected for them. A value with no
    ``/`` is not a media type at all.
    """

    if not declared:
        return ""
    base = declared.split(";", 1)[0].strip().lower()
    return base if "/" in base else ""


def validate_payload(
    *,
    kind: MediaKind,
    declared_content_type: str | None,
    payload: bytes,
) -> tuple[str, int | None, int | None]:
    """Check the bytes against §11.5, and return the truth about them.

    Four checks, cheapest first. Size is an integer compare. Then the *sniffed*
    type, because a declared type is only a claim. Then that the claim matches
    the bytes — which is what makes ``Content-Type`` evidence rather than
    decoration. Then that the type is in the allowed set for the kind.
    """

    ceiling = _max_bytes_for(kind)
    if len(payload) > ceiling:
        raise _unprocessable(
            f"That file is larger than the {_mib(ceiling)} limit for "
            f"{kind.value} uploads.",
            "body",
            f"Maximum is {ceiling} bytes.",
        )
    if not payload:
        raise _unprocessable(
            "That file was empty.",
            "body",
            "Send the file's bytes as the raw request body.",
        )

    found = sniff(payload[:_MAX_HEADER_BYTES])
    if found is None:
        raise _unprocessable(
            "That file's contents could not be recognised.",
            "body",
            "The bytes do not match any supported file format.",
        )
    actual_mime, width, height = found

    declared = normalise_content_type(declared_content_type)
    if not declared:
        raise _unprocessable(
            "The file's content type is required.",
            "header.content-type",
            "Send the file's real type, for example image/png.",
        )
    if declared != actual_mime:
        raise _unprocessable(
            "That file is not the type it claims to be.",
            "header.content-type",
            f"Declared {declared} but the bytes are {actual_mime}.",
        )

    allowed = _allowed_mime_types(kind)
    if actual_mime not in allowed:
        raise _unprocessable(
            f"{actual_mime} cannot be uploaded as {kind.value}.",
            "header.content-type",
            "Use one of: " + ", ".join(allowed),
        )
    return actual_mime, width, height


def check_claimed_dimensions(
    *,
    claimed_width: int | None,
    claimed_height: int | None,
    actual_width: int | None,
    actual_height: int | None,
) -> None:
    """Reject a client whose claimed dimensions contradict the bytes (§11.3).

    "Re-derive dimensions from the bytes where feasible, **and reject a
    mismatch**." Storing the derived values and staying silent about the
    contradiction would satisfy half of that and hide a picker bug; rejecting
    surfaces it where the client can fix it.

    Only checked when the server actually derived something. A video's width is
    ``None`` here, and refusing a client for claiming one would be refusing it for
    the server's gap rather than the client's error.
    """

    if actual_width is None or actual_height is None:
        return
    for claimed, actual, name in (
        (claimed_width, actual_width, "width"),
        (claimed_height, actual_height, "height"),
    ):
        if claimed is not None and claimed != actual:
            raise _unprocessable(
                "The image dimensions did not match the file.",
                f"query.{name}",
                f"Declared {claimed} but the image is {actual}.",
            )


# --- read models -------------------------------------------------------------


def read_model(row: MediaAsset) -> MediaRead:
    """The metadata a client is entitled to see.

    ``storage_kind``, ``storage_key`` and ``owner_id`` are withheld (§14.11 calls
    the first two reserved, and a caller only ever sees their own assets so the
    third teaches them nothing). Nothing here touches ``row.data``, so building a
    response can never pull bytes.
    """

    return MediaRead(
        id=str(row.id),
        kind=row.kind.value,
        mime_type=row.mime_type,
        width=row.width,
        height=row.height,
        size_bytes=row.size_bytes,
        served_at=row.served_at,
    )


def served_path(asset_id: uuid.UUID) -> str:
    """§14.11's ``served_at``: the relative path the client joins onto its base.

    Derived from the id rather than stored twice, so the path a row advertises is
    the path the route actually serves and the two cannot drift.
    """

    return f"{MEDIA_PATH_PREFIX}/{asset_id}"


# --- write -------------------------------------------------------------------


def upload(
    session: Session,
    viewer: User,
    *,
    kind: MediaKind,
    payload: bytes,
    declared_content_type: str | None,
    claimed_width: int | None = None,
    claimed_height: int | None = None,
) -> MediaAsset:
    """Validate, then write metadata **and** bytes in one commit.

    The owner is ``viewer``, taken from the token. There is no owner parameter
    on this function and no way to supply one, which is how §16's "no
    client-supplied user id is ever trusted" is satisfied here by the absence of
    the input rather than by validating it.

    Validation runs to completion *before* the row is constructed, so a rejected
    upload has written nothing at all — no metadata row and no orphaned bytes.
    There is no intermediate commit: one flush, one commit.
    """

    mime_type, width, height = validate_payload(
        kind=kind,
        declared_content_type=declared_content_type,
        payload=payload,
    )
    check_claimed_dimensions(
        claimed_width=claimed_width,
        claimed_height=claimed_height,
        actual_width=width,
        actual_height=height,
    )

    row = MediaAsset(
        owner_id=viewer.id,
        kind=kind,
        mime_type=mime_type,
        size_bytes=len(payload),
        width=width,
        height=height,
        # Always NULL in V1: §11.4 publishes `video_duration_enforced: false`
        # and §11.5 forbids trusting a client-declared duration.
        duration_ms=None,
        storage_kind=STORAGE_KIND_DATABASE,
        storage_key="",  # replaced below, once the id exists
        served_at="",
        data=payload,
    )
    session.add(row)
    # Flush, not commit: the id has to exist before `storage_key` and
    # `served_at` can point at it. Nothing is durable yet, so a failure here
    # leaves nothing behind.
    session.flush()
    row.storage_key = str(row.id)
    row.served_at = served_path(row.id)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def replace(
    session: Session,
    viewer: User,
    raw_id: str,
    *,
    kind: MediaKind,
    payload: bytes,
    declared_content_type: str | None,
    allow_kind_change: bool = False,
) -> MediaAsset:
    """``PUT /media/{id}`` — replace an existing asset's bytes, owner only.

    A full replacement, not a partial update: the bytes, the sniffed MIME, the
    derived dimensions and the size all change together. Keeping ``owner_id``,
    ``storage_key``, ``served_at`` and ``created_at`` is the point — the asset
    keeps its identity and its URL, so a post referencing it does not break.

    Validation happens before any mutation, so a rejected replacement leaves the
    previous bytes in place rather than half of the new ones.
    """

    row = find_owned(session, viewer, raw_id)
    mime_type, width, height = validate_payload(
        kind=kind,
        declared_content_type=declared_content_type,
        payload=payload,
    )
    if mime_type != row.mime_type and not allow_kind_change:
        raise _unprocessable(
            "A replacement must be the same type as the file it replaces.",
            "header.content-type",
            f"This asset is {row.mime_type}.",
        )

    row.data = payload
    row.size_bytes = len(payload)
    row.width = width
    row.height = height
    if allow_kind_change:
        row.kind = kind
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


# --- owner scope -------------------------------------------------------------


def find_owned(session: Session, viewer: User, raw_id: str) -> MediaAsset:
    """The caller's own asset, or a 404 that does not say whether it exists.

    §11.5: "``GET /media/{id}`` serves bytes only to the uploader." The
    ``owner_id == viewer.id`` predicate is part of the lookup rather than a check
    afterwards, so another account's asset is never loaded, and a distinct answer
    for "exists but is not yours" would be a membership oracle (§16).
    """

    asset_id = parse_id(raw_id, "media")
    row = session.scalar(
        select(MediaAsset).where(
            MediaAsset.id == asset_id,
            MediaAsset.owner_id == viewer.id,
        )
    )
    if row is None:
        raise _not_found()
    return row


def serve(session: Session, viewer: User, raw_id: str) -> tuple[MediaAsset, bytes]:
    """``GET /media/{id}`` — the bytes, for the uploader only.

    Only the columns needed are selected. A list or metadata endpoint that
    selected ``*`` would drag every uploaded byte through the driver, which is
    the one performance trap this table's design creates.
    """

    asset_id = parse_id(raw_id, "media")
    found = session.execute(
        select(
            MediaAsset.id,
            MediaAsset.kind,
            MediaAsset.mime_type,
            MediaAsset.size_bytes,
            MediaAsset.data,
        ).where(
            MediaAsset.id == asset_id,
            MediaAsset.owner_id == viewer.id,
        )
    ).one_or_none()
    if found is None:
        raise _not_found()

    asset_id, kind, mime_type, size_bytes, data = found
    if data is None:
        # Reachable only if a future `storage_kind` keeps content elsewhere while
        # the V1 `database` reader is still in use. Answering 404 keeps "I cannot
        # serve this" in the same shape as "not yours" rather than leaking a 500.
        raise _not_found()
    return (
        MediaAsset(
            id=asset_id,
            kind=kind,
            mime_type=mime_type,
            size_bytes=size_bytes,
            owner_id=viewer.id,
            storage_key=str(asset_id),
            served_at=served_path(asset_id),
        ),
        bytes(data),
    )


def _live_post_references(session: Session, media_id: uuid.UUID) -> int:
    """How many **live** posts still use this asset.

    §14.11's word is "live", and it is doing real work: a soft-deleted post keeps
    its `post_media` rows on purpose (§9.3 — the position and its comments
    survive), so counting tombstones would make an asset permanently undeletable
    after one post was removed. Only rows whose post has ``deleted_at IS NULL``
    are a real reference.

    The join to ``posts`` is what makes that filter possible, and doing it in SQL
    rather than fetching the links and checking in Python keeps it a single
    index-backed aggregate.
    """
    from app.models.posts import Post, PostMedia

    return (
        session.scalar(
            select(func.count())
            .select_from(PostMedia)
            .join(Post, Post.id == PostMedia.post_id)
            .where(PostMedia.media_id == media_id, Post.deleted_at.is_(None))
        )
        or 0
    )


def _tombstoned_links(session: Session, media_id: uuid.UUID) -> list[PostMedia]:
    """The attachment rows belonging to **soft-deleted** posts that use this asset.

    These are the rows that would otherwise block the delete. §9.3 keeps a
    tombstone's `post_media` rows so a future undelete or moderation read still
    has them — but §14.11 also requires that an asset no live post uses becomes
    deletable, and `post_media.media_id` is RESTRICT. Those two rules only fit
    together if deleting an asset clears the links that no live post needs.

    Returned as ORM objects rather than deleted in the helper so the caller can
    see what it is about to drop, and so the ordering of the two deletes in
    :func:`delete` is obvious at the call site.
    """
    from app.models.posts import Post, PostMedia

    return list(
        session.scalars(
            select(PostMedia)
            .join(Post, Post.id == PostMedia.post_id)
            .where(PostMedia.media_id == media_id, Post.deleted_at.is_not(None))
        )
    )


def _live_story_references(session: Session, media_id: uuid.UUID) -> int:
    """How many **active** stories still use this asset.

    §14.11 names "post/**story**" in the same sentence, so stories are half of this
    requirement and implementing the post half alone left it half-done.

    "Active" means both of §10.2's conditions — unexpired *and* published — because
    an archived story is invisible, and an asset only invisible stories show is
    storage nobody is looking at. ``now()`` is evaluated in SQL for the same reason
    the service does it in SQL: one expression the database and the tests agree on.

    ``stories.media_id`` is RESTRICT, so an expired story's reference would still
    block the delete at the database level even though this reports zero. That is
    what :func:`_detach_inactive_stories` is for, and it has the same shape as
    ``_tombstoned_links``: the check and the FK must agree, or an asset becomes
    permanently stranded.
    """
    from app.models.stories import Story

    return (
        session.scalar(
            select(func.count())
            .select_from(Story)
            .where(
                Story.media_id == media_id,
                Story.expires_at > func.now(),
                Story.status == "published",
            )
        )
        or 0
    )


def _detach_inactive_stories(session: Session, media_id: uuid.UUID) -> int:
    """Null out ``media_id`` on stories that are no longer visible.

    An expired or archived story keeps its row — §10.2's retention job may want to
    account for it, and a hard delete is not this service's business — but its
    artwork is unreachable by any reader. Clearing the FK on those rows is what lets
    the bytes be reclaimed; leaving it set would make ``stories.media_id`` RESTRICT
    pin the asset forever, which is exactly the failure ``_tombstoned_links`` fixes
    for posts.

    Returns how many rows were detached, so the call site is explicit about having
    done it rather than silently mutating state.
    """
    from app.models.stories import Story

    inactive = session.scalars(
        select(Story).where(
            Story.media_id == media_id,
            (Story.expires_at <= func.now()) | (Story.status == "archived"),
        )
    ).all()
    for story in inactive:
        story.media_id = None
    return len(inactive)


def delete(session: Session, viewer: User, raw_id: str) -> None:
    """``DELETE /media/{id}`` — owner only, and reference-checked (§14.11).

    §14.11 requires deletion to "first confirm no live post/story references the
    asset". Phase 7 left this unimplemented and said so, because there was nothing to
    query: `post_media` arrived in Phase 8, and so did `stories`. Both exist now, so
    the guard is real rather than a comment describing one.

    A referenced asset is a **409**, not a 404 and not a silent delete. The post or
    story is the caller's own, so telling them it exists tells them nothing they do
    not already know; what they need is that the image is in use, so the composer can
    detach it. `post_media.media_id` and `stories.media_id` are both RESTRICT, so the
    database would refuse the delete anyway — these checks turn that refusal into an
    answer the client can act on instead of a 500.

    **The live checks and the RESTRICT FKs have to agree, and they did not.**
    `_live_post_references` counts only live posts, so a soft-deleted post does not
    pin an asset — §9.3 keeps its `post_media` rows on purpose, and counting those
    would make an asset permanently undeletable. But those rows still exist, and
    `media_id` is RESTRICT, so the database refused the delete and returned a 500: an
    asset no live post used could never be reclaimed. `_tombstoned_links` closes that
    gap for posts and `_detach_inactive_stories` for stories, each dropping exactly
    the references no *visible* row needs. Live posts and active stories still get the
    409 above; invisible ones no longer block storage from being freed, which is the
    only way a user can ever get the bytes back.

    `companies.logo_media_id` is still absent (the career domain is Phase 9), so that
    reference cannot exist and is not checked for. It belongs in this same function
    when it lands.
    """
    row = find_owned(session, viewer, raw_id)

    in_a_post = _live_post_references(session, row.id)
    in_a_story = _live_story_references(session, row.id)
    if in_a_post or in_a_story:
        where = "post" if in_a_post else "story"
        raise ApiError(
            status_code=409,
            code=ErrorCode.CONFLICT,
            message=f"This file is used in a {where} and cannot be deleted.",
            details=[
                error_detail(
                    "media_id",
                    f"Remove it from the {where} that uses it, then delete it.",
                )
            ],
        )

    # Nothing visible uses it, so any remaining references belong to rows nobody can
    # see. They are dropped here because both `post_media.media_id` and
    # `stories.media_id` are RESTRICT: leaving them would make the database refuse the
    # delete and strand the asset forever, which is the exact outcome tombstone
    # retention must not cause.
    for link in _tombstoned_links(session, row.id):
        session.delete(link)
    _detach_inactive_stories(session, row.id)

    session.delete(row)
    session.commit()


def list_owned(session: Session, viewer: User, *, limit: int = 50) -> list[MediaAsset]:
    """The caller's own assets, newest first. A helper, not a route.

    §11.4's ``GET /media`` is a limits document, so there is deliberately **no**
    public listing endpoint — the specification lists none and the client calls
    none. This exists so ownership and ordering can be asserted without inventing
    one.

    ``data`` is not among the selected columns, which is the whole point of
    keeping this separate from the retrieval path.
    """

    return list(
        session.scalars(
            select(
                MediaAsset.id,
                MediaAsset.kind,
                MediaAsset.mime_type,
                MediaAsset.size_bytes,
                MediaAsset.width,
                MediaAsset.height,
                MediaAsset.served_at,
                MediaAsset.owner_id,
                MediaAsset.created_at,
            )
            .where(MediaAsset.owner_id == viewer.id)
            .order_by(MediaAsset.created_at.desc(), MediaAsset.id.desc())
            .limit(limit)
        )
    )


def set_avatar(session: Session, viewer: User, raw_id: str) -> None:
    """Point this account at one of its own assets (§11.2's photo route).

    Scoped to the caller's assets, so an avatar can never be set to somebody
    else's upload — the rule that governs reading bytes, applied to the one
    pointer other people will see.

    The previous avatar is **not** deleted. It may still be referenced by a post,
    and §14.11 makes reference-checking the deletion route's job; a silent delete
    here would take a published image down with nobody asking.
    """

    row = find_owned(session, viewer, raw_id)
    viewer.avatar_media_id = row.id
    session.add(viewer)
    session.commit()


def clear_avatar(session: Session, viewer: User) -> None:
    """Drop the pointer, keeping the asset (§11.2's ``DELETE /users/me/photo``).

    Nulling a column is honest: the account no longer has a photo, and the bytes
    remain for the owner to reference or delete deliberately.
    """

    viewer.avatar_media_id = None
    session.add(viewer)
    session.commit()


def avatar_url_for(user: User, session: Session) -> str | None:
    """The served path for a user's avatar, or ``None``.

    Phase 1 declared ``users.avatar_media_id`` and left the read model's
    ``avatar_url`` permanently null with a "media phase" note. This is that note
    being paid.

    Returns the **relative** ``served_at`` path, not an absolute URL: the client
    joins it onto its configured base itself (``absoluteMediaUri()``), and
    publishing a host here would break every other environment and contradict
    ?14.11's "the relative path the client joins onto the base URL".

    A dangling pointer is answered with ``None`` rather than raising. The FK makes
    one impossible, but a row deleted out from under a loaded ORM object would
    otherwise turn a profile read into a 500 -- and the honest answer for "no
    photo" is still no photo.
    """

    if user.avatar_media_id is None:
        return None
    served_at = session.scalar(
        select(MediaAsset.served_at).where(MediaAsset.id == user.avatar_media_id)
    )
    return served_at
