"""The ``/media`` router — §11.2's routes.

**Raw bodies, not multipart.** ``POST /media`` and ``PUT /media/{id}`` read the
request body with ``await request.body()``. §11.3 gives two settled reasons: it
keeps ``python-multipart`` out of the dependencies, and it lets the client use
``expo-file-system``'s native upload task, which reports **genuine** byte
progress — ``fetch`` cannot, so a progress bar built on it would be a lie.
Nothing here uses ``UploadFile`` or a ``Form``, and there is no multipart parser
to accidentally reintroduce.

**Oversized uploads are refused before the body is read.** ``Content-Length`` is
compared against the ceiling first, so a 10 MB rejection costs one integer
comparison instead of 10 MB of buffering. That is the one optimisation worth
having here: it is the difference between an attack costing memory and costing
a header. A chunked request with no declared length falls through to the
streaming check in the service, so the bound holds either way.

**``GET /media`` is a limits document.** It reads like a collection and is not
one — §11.4 calls the trap out by name, and the client calls
``fetchMediaLimits()``. There is no listing endpoint here, because the
specification lists none and the client calls none.

**No role restriction.** ``CurrentUser``, not ``CandidateUser``: an employer
uploads a company logo and a college official a profile photo, and §11.2 marks
these routes ``[M]`` with no role qualifier.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status

from app.api.deps import CurrentUser, DbSession
from app.models.enums import MediaKind
from app.schemas.media import MediaLimits, MediaRead
from app.services import media as svc

router = APIRouter(tags=["media"])

#: Registration order is load-bearing, and silently so. Starlette matches in
#: declaration order, so `/users/me/photo` has to be declared *before*
#: `/media/{media_id}` or the parameterised route swallows it and `media_id`
#: binds to the literal string "me" -- a 404 that looks like a missing asset
#: rather than a routing mistake. Literal paths first is the same rule
#: `endpoints/notifications.py` follows for `/unread-count`.

Kind = Annotated[
    str,
    Query(description="One of image, video, document (§14.11)."),
]
Width = Annotated[
    int | None,
    Query(ge=1, description="Claimed width; cross-checked against the bytes (§11.3)."),
]
Height = Annotated[
    int | None,
    Query(ge=1, description="Claimed height; cross-checked against the bytes (§11.3)."),
]


async def _raw_body(request: Request, ceiling: int) -> bytes:
    """The raw request body, refusing an over-long one before reading it.

    Two guards, because either alone is insufficient. ``Content-Length`` rejects
    an oversized upload without buffering it, but a chunked request sends no
    length at all — so the accumulated size is checked on every chunk too. The
    cap is one byte over the ceiling, which is enough to detect the overflow
    without ever buffering a whole oversized body.
    """

    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > ceiling:
        raise svc._too_large(ceiling)

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > ceiling:
            raise svc._too_large(ceiling)
    return bytes(body)


def _binary_response(row: svc.MediaAsset, payload: bytes) -> Response:
    """The bytes, as bytes.

    ``Content-Type`` is the asset's stored MIME, so the browser and ``expo-image``
    both see what the file actually is. ``Content-Length`` is set explicitly
    rather than left to the ASGI layer, because a client reading a download needs
    a total and a 10 MB photo must not arrive as a length-less stream.

    No ``Content-Disposition``: the client renders these inline in an
    ``expo-image``, and forcing a download would break every image in the app.
    """

    return Response(
        content=payload,
        media_type=row.mime_type,
        headers={"Content-Length": str(len(payload))},
    )


@router.put(
    "/users/me/photo",
    response_model=MediaRead,
    summary="Replace my profile photo",
)
async def put_photo(
    request: Request,
    current_user: CurrentUser,
    session: DbSession,
) -> MediaRead:
    """``PUT /users/me/photo?kind=image`` — §11.2, the client's `uploadProfilePhoto`.

    Upload-and-point in one call, because the client's docstring says why: "The
    server replaces any existing photo, so 'upload' and 'replace' are the same
    call — no delete-then-upload race that could leave a person with no photo."
    A two-step contract would leave a window where a failed avatar upload has
    already cleared the old one.
    """

    payload = await _raw_body(request, svc._max_bytes_for(MediaKind.IMAGE))
    row = svc.upload(
        session,
        current_user,
        kind=MediaKind.IMAGE,
        payload=payload,
        declared_content_type=request.headers.get("content-type"),
    )
    svc.set_avatar(session, current_user, str(row.id))
    return svc.read_model(row)


@router.get(
    "/media",
    response_model=MediaLimits,
    summary="The limits this server enforces",
)
def media_limits(current_user: CurrentUser) -> MediaLimits:
    """§11.4 — a limits document, **not** a list of assets.

    Every field comes from the same constants the upload path enforces, so the
    number a client pre-flights a picker against is by construction the number
    the server applies. "A limit change must not require a client release"
    (§11.4) is only true while there is exactly one copy of each limit.
    """

    return svc.limits()


@router.post(
    "/media",
    response_model=MediaRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a file (raw body)",
)
async def upload_media(
    request: Request,
    current_user: CurrentUser,
    session: DbSession,
    kind: Kind,
    width: Width = None,
    height: Height = None,
) -> MediaRead:
    """§11.3's transport: raw body, metadata in the query, real ``Content-Type``.

    201 with the asset's metadata — which is what `uploadPickedImage` parses into
    a `MediaRead`. The owner is the authenticated caller; there is no owner
    parameter, so a client cannot nominate somebody else (§16).
    """

    parsed = svc.parse_kind(kind)
    payload = await _raw_body(request, svc._max_bytes_for(parsed))
    row = svc.upload(
        session,
        current_user,
        kind=parsed,
        payload=payload,
        declared_content_type=request.headers.get("content-type"),
        claimed_width=width,
        claimed_height=height,
    )
    return svc.read_model(row)


@router.post(
    "/media/{media_id}",
    response_model=MediaRead,
    summary="Upload a private document to this asset (raw body)",
)
async def upload_document(
    media_id: str,
    request: Request,
    current_user: CurrentUser,
    session: DbSession,
) -> MediaRead:
    """§11.2's private document — what `uploadDocument(path, …)` binds to.

    ``kind`` is forced to ``document`` rather than taken from the query, because
    §11.5 scopes this route to "Documents: PDF only, private, owner-only". A
    client asking to make a private PDF an *image* is asking for the wrong route,
    and the answer should not depend on what it put in the URL.

    The asset must already exist and belong to the caller, so this attaches
    bytes to a slot the caller owns rather than minting a new one — which is what
    keeps the id a resume UI already holds meaningful.
    """

    row = svc.find_owned(session, current_user, media_id)
    payload = await _raw_body(request, svc._max_bytes_for(MediaKind.DOCUMENT))
    replaced = svc.replace(
        session,
        current_user,
        row.id,
        kind=MediaKind.DOCUMENT,
        payload=payload,
        declared_content_type=request.headers.get("content-type"),
        # This route's whole purpose is to make an asset a private PDF, so it is
        # the one caller permitted to change the stored kind. A plain PUT is not.
        allow_kind_change=True,
    )
    return svc.read_model(replaced)


@router.get(
    "/media/{media_id}",
    response_class=Response,
    summary="Download the bytes (uploader only)",
    responses={
        200: {
            "content": {"application/octet-stream": {}},
            "description": "The file's bytes.",
        }
    },
)
def get_media(media_id: str, current_user: CurrentUser, session: DbSession) -> Response:
    """§11.5: bytes, and **only to the uploader**.

    This is why `authenticatedImageSource()` in the client attaches the bearer
    token to every `expo-image`: an image in a post card cannot be a plain public
    URL. There is deliberately no unsigned variant of this route.

    A 404 covers both "no such asset" and "not yours", so the route cannot be
    used to confirm that an arbitrary id exists (§16).
    """

    row, payload = svc.serve(session, current_user, media_id)
    return _binary_response(row, payload)


@router.put(
    "/media/{media_id}",
    response_model=MediaRead,
    summary="Replace the bytes (owner only)",
)
async def replace_media(
    media_id: str,
    request: Request,
    current_user: CurrentUser,
    session: DbSession,
    kind: Kind,
) -> MediaRead:
    """§16's replacement, as a **full** replacement.

    The bytes, the MIME and the derived dimensions all change together; the
    identity does not. ``id``, ``owner_id``, ``storage_key``, ``served_at`` and
    ``created_at`` survive, so a post that already references this asset keeps
    working and keeps its URL. That is the whole reason PUT is defined on the id
    rather than as "upload and hope the id is the same".

    Ownership never transfers: the owner is ``viewer``, matched against the
    existing row, and there is no owner field in the request.
    """

    parsed = svc.parse_kind(kind)
    payload = await _raw_body(request, svc._max_bytes_for(parsed))
    row = svc.replace(
        session,
        current_user,
        media_id,
        kind=parsed,
        payload=payload,
        declared_content_type=request.headers.get("content-type"),
    )
    return svc.read_model(row)


@router.delete(
    "/media/{media_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an asset (owner only)",
)
def delete_media(
    media_id: str, current_user: CurrentUser, session: DbSession
) -> Response:
    """§14.11: owner-only, and reference-checked.

    The check is real now. Phase 7 left it unimplemented because there was nothing
    to query — `post_media` arrived with Phase 8 — and `stories` has not. So an
    asset referenced by a live post is a 409, and the story half of §14.11's
    "post/story" is still outstanding. `services.media.delete` is where both halves
    meet, and is the one place to extend when stories land.
    """

    svc.delete(session, current_user, media_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/users/me/photo",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove my profile photo",
)
def delete_photo(current_user: CurrentUser, session: DbSession) -> Response:
    """``DELETE /users/me/photo`` — clears the pointer, keeps the asset.

    The bytes stay: they may be referenced elsewhere, and §14.11 puts reference
    checking on the media deletion route rather than on this one. The account
    simply stops pointing at them.
    """

    svc.clear_avatar(session, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
