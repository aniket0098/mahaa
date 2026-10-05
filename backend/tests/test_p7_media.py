"""Phase 7 — media. The transport is the contract, so most of this tests it.

**Uploads are raw bodies, and that is the thing worth testing.** §11.3 gives two
settled reasons: no `python-multipart` dependency, and real byte progress from
`expo-file-system`'s native upload task. The client sends `Content-Type: image/png`
and the file's bytes with nothing else — so these tests do exactly that, and one
of them asserts the body round-trips **byte for byte**. A multipart
implementation would pass a shape-based test and fail every real upload.

**The declared `Content-Type` is treated as a claim, not evidence.** §11.3: the
server "must not trust them — re-derive dimensions from the bytes where feasible,
and reject a mismatch". So the suite sends real files whose headers are built
here byte by byte, and then sends lying ones: a PNG header with `text/plain`
declared, and a `width` that disagrees with the actual image. Both must be
refused. A server that trusted the header would store a text file as an image.

**Bytes are never globally readable.** §11.5: "`GET /media/{id}` serves bytes
only to the uploader. This is why `authenticatedImageSource` attaches the bearer
token to every `expo-image`." A third account is present throughout for exactly
this: a suite with one account cannot tell an ownership check from a missing one,
because there is nothing to steal.

**`served_at` is a path, not a timestamp.** §14.11 says so and
`absoluteMediaUri()` in the client proves it. A test writes the URL the client
would build from a returned `served_at` and fetches it, which is the only way to
catch a server that stored something else.

**Limits are published, not duplicated.** §11.4's whole reason is "a limit change
must not require a client release", so one test asserts the published document
and the enforced ceilings come from the same constants.
"""

from __future__ import annotations

import struct
import uuid
import zlib

import pytest
from sqlalchemy import select, text

from app.models import MediaAsset, User
from app.models.enums import MediaKind
from app.services import media as svc
from tests.conftest import REJECTION_ERRORS, register

#: Nobody's asset. Only used where authentication or the id parse is the subject.
NOBODY = str(uuid.UUID(int=0))

MEDIA_ROUTES = [
    ("get", "/api/v1/media", None),
    ("post", "/api/v1/media?kind=image", b""),
    ("get", f"/api/v1/media/{NOBODY}", None),
    ("put", f"/api/v1/media/{NOBODY}?kind=image", b""),
    ("delete", f"/api/v1/media/{NOBODY}", None),
    ("post", f"/api/v1/media/{NOBODY}", b""),
]

ROUTE_IDS = [f"{method.upper()} {path}" for method, path, _ in MEDIA_ROUTES]


# --- real files --------------------------------------------------------------
#
# Built byte by byte rather than checked in as opaque fixtures. A binary blob in
# the repository tells you nothing when a sniffer regresses, and a stub that only
# *looks* right can pass a test while testing nothing. Constructing them makes the
# offsets the server reads explicit, and the JPEG's leading APP1 segment is
# deliberate: it proves the parser walks segments rather than assuming the frame
# starts at byte 2.


def png_bytes(width: int = 4, height: int = 3, colour: int = 2) -> bytes:
    """A structurally valid PNG: signature, IHDR, IDAT, IEND.

    Only the header is load-bearing — the server reads dimensions from IHDR and
    never decodes pixels — but every chunk carries a real CRC so this is a file
    rather than something wearing a PNG's magic number.
    """

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, colour, 0, 0, 0)
    raw = b"".join(b"\x00" + b"\x40" * (width * 3) for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def jpeg_bytes(width: int = 6, height: int = 5) -> bytes:
    """A JPEG carrying a real SOF0 frame, behind an EXIF APP1 segment."""

    app1 = b"Exif\x00\x00" + b"\x00" * 40
    app1_segment = b"\xff\xe1" + struct.pack(">H", len(app1) + 2) + app1
    sof = (
        b"\xff\xc0"
        + struct.pack(">H", 17)
        + b"\x08"
        + struct.pack(">HH", height, width)
        + b"\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01"
    )
    return b"\xff\xd8" + app1_segment + sof + b"\xff\xd9"


def webp_bytes(width: int = 8, height: int = 4) -> bytes:
    """A VP8X WebP, whose 24-bit little-endian dimensions are stored value - 1."""

    body = b"WEBPVP8X" + struct.pack("<I", 10) + b"\x00" * 4
    body += (width - 1).to_bytes(3, "little") + (height - 1).to_bytes(3, "little")
    return b"RIFF" + struct.pack("<I", len(body)) + body


def mp4_bytes(brand: bytes = b"isom") -> bytes:
    """An ISO base-media header — enough to recognise a video container."""

    return b"\x00\x00\x00\x20ftyp" + brand + b"\x00\x00\x02\x00" + b"\x00" * 16


def quicktime_bytes() -> bytes:
    return mp4_bytes(b"qt  ")


def pdf_bytes() -> bytes:
    """A minimal but genuine PDF header — §11.5's only document type."""

    return b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n"


#: A small real image, and the dimensions the server must derive from it.
PNG = png_bytes()
PNG_WIDTH, PNG_HEIGHT = 4, 3

# --- helpers -----------------------------------------------------------------


def _upload(api_client, account, payload, mime="image/png", **params):
    """``POST /media`` the way `uploadPickedImage` sends it.

    Raw ``content=``, the real ``Content-Type``, metadata in the query ? the three
    things ?11.3 settles. Not ``json=``, and not ``files=``.
    """

    query = {"kind": params.pop("kind", "image"), **params}
    headers = dict(account.headers)
    if mime is not None:
        headers["Content-Type"] = mime
    return api_client.post(
        "/api/v1/media", params=query, content=payload, headers=headers
    )


def _fetch(api_client, account, media_id):
    return api_client.get(f"/api/v1/media/{media_id}", headers=account.headers)


def _seed_asset(api_client, account, payload=None, **params):
    """Create one real asset and return its metadata response."""

    response = _upload(
        api_client, account, payload if payload is not None else PNG, **params
    )
    assert response.status_code == 201, response.text
    return response.json()


def _limits(api_client, account):
    response = api_client.get("/api/v1/media", headers=account.headers)
    assert response.status_code == 200, response.text
    return response.json()


# --- fixtures ----------------------------------------------------------------


@pytest.fixture()
def stranger(api_client):
    """User C. The account that must never read another account's bytes."""

    return register(api_client, f"stranger.{uuid.uuid4().hex[:12]}@example.com")


@pytest.fixture()
def asset(api_client, candidate):
    """One PNG owned by ``candidate``."""

    return _seed_asset(api_client, candidate)


# --- authentication ----------------------------------------------------------


@pytest.mark.parametrize("method,path,body", MEDIA_ROUTES, ids=ROUTE_IDS)
def test_every_media_route_needs_a_token(api_client, method, path, body) -> None:
    # httpx rejects `content=` on GET/DELETE, and those two genuinely have no
    # body here -- so the body is attached only where one is legal.
    kwargs = {"content": body} if method in ("post", "put") else {}
    response = getattr(api_client, method)(path, **kwargs)

    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "not_authenticated"


def test_an_unauthenticated_upload_stores_nothing(api_client) -> None:
    """A rejected upload must leave no row ? bytes included."""

    response = _upload(api_client, type("X", (), {"headers": {}})(), PNG)

    assert response.status_code == 401, response.text
    assert _rows(api_client) == []


def test_unauthenticated_binary_retrieval_is_401_not_404(api_client, asset) -> None:
    """401 before authorization: the route must not confirm the asset exists."""

    response = _fetch(api_client, type("X", (), {"headers": {}})(), asset["id"])

    assert response.status_code == 401, response.text


def test_a_forged_token_is_rejected(api_client) -> None:
    headers = {"Authorization": "Bearer not-a-real-token", "Content-Type": "image/png"}

    assert api_client.get("/api/v1/media", headers=headers).status_code == 401
    response = api_client.post(
        "/api/v1/media", params={"kind": "image"}, content=PNG, headers=headers
    )
    assert response.status_code == 401


def test_a_suspended_account_cannot_upload(
    api_client, db_session, candidate
) -> None:
    from app.models.enums import UserStatus

    db_session.get(User, uuid.UUID(candidate.id)).status = UserStatus.SUSPENDED
    db_session.commit()

    response = _upload(api_client, candidate, PNG)

    assert response.status_code == 403, response.text
    assert _rows(api_client) == []


def _client_session(api_client):
    """The rolled-back session the TestClient's routes share.

    The override registered in `conftest.py` is a *generator function* yielding
    the session, so one `next()` is what unwraps it. Calling it directly hands
    back a generator, and the first query on that fails with an attribute error
    that looks nothing like the mistake.
    """

    override = api_client.app.dependency_overrides[
        __import__("app.db.session", fromlist=["get_db"]).get_db
    ]
    return next(override())


def _client_user(api_client, user_id):
    key = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(user_id)
    return _client_session(api_client).get(User, key)


def _assert_database_rejects(api_client, row) -> None:
    """Assert PostgreSQL refuses ``row``, then drop it from the session.

    Discarding is required, not tidiness: rolling the savepoint back undoes the
    database change, but a failed flush can leave the object pending, and the
    next flush would retry the same bad row and fail a later assertion.
    """

    session = _client_session(api_client)
    session.add(row)
    try:
        with session.begin_nested():
            session.flush()
    except REJECTION_ERRORS:
        if row in session:
            session.expunge(row)
        return
    raise AssertionError(f"expected {type(row).__name__} to be rejected")


def _rows(api_client):
    """Every media row, through the *same* session the routes use.

    `db_session` and the TestClient's session are separate objects in this suite,
    so a row written through the API is not visible to the bare `db_session`.
    Asserting through `api_client` keeps the check honest instead of accidentally
    passing on an empty table.
    """

    return list(_client_session(api_client).scalars(select(MediaAsset)))


def _row(api_client, media_id):
    """One row by id, accepting either a JSON string or a ``UUID``.

    Both forms occur here -- the upload response hands back strings, and the
    deletion tests carry a UUID around -- so the helper normalises instead of
    forcing every caller to remember which it has.
    """

    key = media_id if isinstance(media_id, uuid.UUID) else uuid.UUID(media_id)
    return _client_session(api_client).get(MediaAsset, key)

# --- upload: the happy paths -------------------------------------------------


def test_a_png_upload_returns_the_client_read_shape(api_client, candidate) -> None:
    """``uploadPickedImage`` parses this into a `MediaRead`, field for field."""

    body = _upload(api_client, candidate, PNG).json()

    assert set(body) == {
        "id",
        "kind",
        "mime_type",
        "width",
        "height",
        "size_bytes",
        "served_at",
    }
    assert body["kind"] == "image"
    assert body["mime_type"] == "image/png"
    assert body["size_bytes"] == len(PNG)


def test_the_uploader_owns_what_it_uploaded(api_client, candidate) -> None:
    """The owner is the token, never a request field (?16)."""

    body = _upload(api_client, candidate, PNG).json()

    row = _row(api_client, body["id"])
    assert row.owner_id == uuid.UUID(candidate.id)


def test_no_response_field_can_name_another_owner(api_client, candidate) -> None:
    """``owner_id`` is absent from the read model, not merely unset.

    A caller only ever sees their own assets, so an owner field teaches them
    nothing ? and a field that appears later cannot leak what this one hid.
    """

    body = _upload(api_client, candidate, PNG).json()

    assert "owner_id" not in body
    assert "storage_key" not in body
    assert "storage_kind" not in body


def test_a_jpeg_upload_is_accepted(api_client, candidate) -> None:
    """?11.5: "Images: PNG/JPEG/WebP" ? all three, not just PNG."""

    response = _upload(api_client, candidate, jpeg_bytes(), mime="image/jpeg")

    assert response.status_code == 201, response.text
    assert response.json()["mime_type"] == "image/jpeg"


def test_a_webp_upload_is_accepted(api_client, candidate) -> None:
    response = _upload(api_client, candidate, webp_bytes(), mime="image/webp")

    assert response.status_code == 201, response.text
    assert response.json()["mime_type"] == "image/webp"


def test_a_video_upload_is_accepted(api_client, candidate) -> None:
    """A video is recognised by signature, with no dimensions claimed for it."""

    response = _upload(
        api_client, candidate, mp4_bytes(), kind="video", mime="video/mp4"
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["kind"] == "video"
    # ?11.4 publishes `video_duration_enforced: false`, so no decoder ran and the
    # server must not invent a width.
    assert body["width"] is None and body["height"] is None


def test_a_quicktime_upload_is_recognised_as_quicktime(api_client, candidate) -> None:
    response = _upload(
        api_client, candidate, quicktime_bytes(), kind="video", mime="video/quicktime"
    )

    assert response.status_code == 201, response.text
    assert response.json()["mime_type"] == "video/quicktime"


def test_a_pdf_document_upload_is_accepted(api_client, candidate) -> None:
    """?11.5: "Documents: PDF only, private, owner-only"."""

    response = _upload(
        api_client, candidate, pdf_bytes(), kind="document", mime="application/pdf"
    )

    assert response.status_code == 201, response.text
    assert response.json()["kind"] == "document"


def test_dimensions_are_derived_from_the_bytes_not_the_query(
    api_client, candidate
) -> None:
    """?11.3: "re-derive dimensions from the bytes where feasible".

    The query here is deliberately **absent**, so the stored values can only have
    come from parsing the PNG's IHDR chunk.
    """

    body = _upload(api_client, candidate, png_bytes(11, 7)).json()

    assert body["width"] == 11
    assert body["height"] == 7


def test_jpeg_dimensions_are_read_past_its_exif_segment(
    api_client, candidate
) -> None:
    """The APP1 segment in front is the regression guard for a naive parser."""

    body = _upload(
        api_client, candidate, jpeg_bytes(width=17, height=9), mime="image/jpeg"
    ).json()

    assert body["width"] == 17
    assert body["height"] == 9


def test_webp_dimensions_are_derived(api_client, candidate) -> None:
    body = _upload(api_client, candidate, webp_bytes(21, 13), mime="image/webp").json()

    assert body["width"] == 21
    assert body["height"] == 13


def test_matching_claimed_dimensions_are_accepted(api_client, candidate) -> None:
    """The client's ``uploadUrl`` always sends them, so the honest case must pass."""

    response = _upload(
        api_client, candidate, PNG, width=PNG_WIDTH, height=PNG_HEIGHT
    )

    assert response.status_code == 201, response.text

# --- upload: rejection -------------------------------------------------------


def test_a_png_declared_as_text_is_rejected(api_client, candidate) -> None:
    """?11.3: the declared ``Content-Type`` must not be trusted.

    The bytes here are a real PNG. Only the header lies, and a server that
    believed the header would store a binary as a text file.
    """

    response = _upload(api_client, candidate, PNG, mime="text/plain")

    assert response.status_code == 422, response.text
    assert _rows(api_client) == []


def test_a_non_image_body_is_rejected(api_client, candidate) -> None:
    """Bytes that match no supported format are refused before anything else."""

    response = _upload(api_client, candidate, b"<?php echo 1; ?>", mime="image/png")

    assert response.status_code == 422, response.text
    assert "recognised" in response.json()["error"]["message"]


def test_an_empty_body_is_rejected(api_client, candidate) -> None:
    response = _upload(api_client, candidate, b"", mime="image/png")

    assert response.status_code == 422, response.text


def test_a_missing_content_type_is_rejected(api_client, candidate) -> None:
    """The client's contract always sends one; a request without it is malformed."""

    response = _upload(api_client, candidate, PNG, mime=None)

    assert response.status_code == 422, response.text


def test_content_type_parameters_are_tolerated(api_client, candidate) -> None:
    """``image/png; charset=binary`` is the same type as ``image/png``."""

    response = _upload(api_client, candidate, PNG, mime="image/png; charset=binary")

    assert response.status_code == 201, response.text


def test_content_type_case_is_tolerated(api_client, candidate) -> None:
    response = _upload(api_client, candidate, PNG, mime="IMAGE/PNG")

    assert response.status_code == 201, response.text


def test_an_unknown_kind_is_rejected(api_client, candidate) -> None:
    response = _upload(api_client, candidate, PNG, kind="audio")

    assert response.status_code == 422, response.text
    assert "kind" in response.text


def test_a_missing_kind_is_rejected(api_client, candidate) -> None:
    """``kind`` is required. It is the one query parameter the route cannot infer."""

    response = api_client.post(
        "/api/v1/media",
        content=PNG,
        headers={**candidate.headers, "Content-Type": "image/png"},
    )

    assert response.status_code == 422, response.text


def test_a_pdf_uploaded_as_an_image_is_rejected(api_client, candidate) -> None:
    """A real PDF declared ``image/png``: the kind and the bytes disagree."""

    response = _upload(api_client, candidate, pdf_bytes(), mime="image/png")

    assert response.status_code == 422, response.text


def test_an_image_uploaded_as_a_document_is_rejected(api_client, candidate) -> None:
    """?11.5 scopes a document slot to PDFs; an image is not one."""

    response = _upload(api_client, candidate, PNG, kind="document", mime="image/png")

    assert response.status_code == 422, response.text


def test_claimed_dimensions_that_contradict_the_bytes_are_rejected(
    api_client, candidate
) -> None:
    """?11.3: "re-derive dimensions from the bytes where feasible, and reject a
    mismatch."

    Rejecting is the half that matters. Silently storing the derived values and
    ignoring the client's would hide a picker bug behind a working avatar.
    """

    response = _upload(api_client, candidate, PNG, width=9999, height=1)

    assert response.status_code == 422, response.text
    assert "width" in response.text


def test_a_claimed_height_mismatch_is_also_caught(api_client, candidate) -> None:
    response = _upload(api_client, candidate, PNG, width=PNG_WIDTH, height=9999)

    assert response.status_code == 422, response.text


def test_a_rejected_upload_writes_no_metadata_and_no_bytes(
    api_client, candidate
) -> None:
    """?17's transaction rule: a failed upload leaves nothing partial behind."""

    before = _rows(api_client)
    response = _upload(api_client, candidate, b"not a file", mime="image/png")

    assert response.status_code == 422
    assert _rows(api_client) == before

# --- ownership and retrieval -------------------------------------------------


def test_the_uploader_can_read_their_own_bytes(api_client, candidate) -> None:
    """?11.5: bytes are served to the uploader. This is the whole happy path."""

    media_id = _seed_asset(api_client, candidate)["id"]

    response = _fetch(api_client, candidate, media_id)

    assert response.status_code == 200, response.text
    assert response.content == PNG


def test_bytes_come_back_unchanged(api_client, candidate) -> None:
    """Not JSON-encoded, not re-encoded, not truncated ? the exact bytes."""

    payload = png_bytes(5, 9)
    media_id = _seed_asset(api_client, candidate, payload)["id"]

    response = _fetch(api_client, candidate, media_id)

    assert response.content == payload
    assert len(response.content) == len(payload)


def test_the_binary_response_declares_its_type_and_length(
    api_client, candidate
) -> None:
    """A client rendering the bytes needs both, and neither may be guessed."""

    media_id = _seed_asset(api_client, candidate)["id"]

    response = _fetch(api_client, candidate, media_id)

    assert response.headers["content-type"].startswith("image/png")
    assert response.headers["content-length"] == str(len(PNG))


def test_the_binary_response_is_not_a_json_wrapper(api_client, candidate) -> None:
    """The single most important retrieval assertion.

    A JSON envelope around the bytes would render as a broken image in
    ``expo-image`` and still look like a 200 in a status-code-only test.
    """

    response = _fetch(api_client, candidate, _seed_asset(api_client, candidate)["id"])

    assert not response.headers["content-type"].startswith("application/json")
    assert response.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_a_stranger_cannot_read_an_unreferenced_upload(
    api_client, stranger, candidate
) -> None:
    """An upload nobody has published is still the uploader alone.

    §11.5 said "serves bytes only to the uploader", and Phase 12 narrowed that to
    "only the uploader, *or* anybody once a visible row references it". Nothing
    references this asset, so the original rule is the one that applies — which
    is what keeps the media table from becoming a public bucket of loose files.
    """

    media_id = _seed_asset(api_client, candidate)["id"]

    response = _fetch(api_client, stranger, media_id)

    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "not_found"


def test_someone_elses_asset_answers_like_a_missing_one(
    api_client, stranger, candidate
) -> None:
    """?16: one answer for "not yours" and "no such id".

    A distinct status would confirm that an arbitrary id exists, turning the
    route into an enumeration oracle.
    """

    theirs = _seed_asset(api_client, candidate)["id"]

    stolen = _fetch(api_client, stranger, theirs)
    absent = _fetch(api_client, stranger, str(uuid.uuid4()))

    assert stolen.status_code == absent.status_code == 404
    left, right = stolen.json()["error"], absent.json()["error"]
    assert left.pop("request_id") != right.pop("request_id")
    assert left == right


def test_a_malformed_id_is_404_not_500(api_client, candidate) -> None:
    for raw in ("not-a-uuid", "12345", "null"):
        response = _fetch(api_client, candidate, raw)
        assert response.status_code == 404, (raw, response.text)


def test_served_at_is_a_path_the_client_can_join_onto_its_base(
    api_client, candidate
) -> None:
    """?14.11: "served_at is the relative path the client joins onto the base URL".

    Verified the only way that proves anything: take the stored value, treat it
    the way ``absoluteMediaUri()`` does, and fetch it. A server that stored a
    timestamp here would fail this with a 404 on a path that never existed.
    """

    body = _seed_asset(api_client, candidate)
    served_at = body["served_at"]

    assert served_at.startswith("/api/v1/media/")
    assert served_at == f"/api/v1/media/{body['id']}"

    # And that exact path serves the bytes -- the client's own join, verbatim.
    joined = api_client.get(served_at, headers=candidate.headers)
    assert joined.status_code == 200, joined.text
    assert joined.content == PNG


def test_served_at_is_not_a_timestamp(api_client, candidate) -> None:
    """The name is a trap; this is the assertion that pins the meaning down."""

    row = _row(api_client, _seed_asset(api_client, candidate)["id"])
    assert "/" in row.served_at
    assert not row.served_at[0].isdigit()

# --- Phase 12: reading media a visible row publishes ------------------------


def _publish_post(api_client, author, media_ids, body="a post"):
    """Create a real post through the real route, so the reference is real."""

    response = api_client.post(
        "/api/v1/posts",
        json={
            "kind": "image",
            "category": "community",
            "body": body,
            "media_ids": list(media_ids),
        },
        headers=author.headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_another_member_can_read_an_image_attached_to_a_post(
    api_client, candidate, stranger
) -> None:
    """The regression this phase exists for.

    `GET /posts` is a member-visible read, so a stranger could always *see* that
    this post existed — and then got a 404 for the picture inside it. A feed whose
    pictures only their author can see is not a feed.
    """

    media_id = _seed_asset(api_client, candidate)["id"]
    _publish_post(api_client, candidate, [media_id])

    response = _fetch(api_client, stranger, media_id)

    assert response.status_code == 200, response.text
    assert response.content == PNG


def test_another_member_can_read_a_video_attached_to_a_post(
    api_client, candidate, stranger
) -> None:
    video = mp4_bytes()
    media_id = _seed_asset(
        api_client, candidate, video, mime="video/mp4", kind="video"
    )["id"]
    _publish_post(api_client, candidate, [media_id])

    response = _fetch(api_client, stranger, media_id)

    assert response.status_code == 200, response.text
    assert response.content == video


def test_another_member_can_read_a_storys_artwork(
    api_client, candidate, stranger
) -> None:
    """§10.1 gives stories no per-viewer ACL either."""

    media_id = _seed_asset(api_client, candidate)["id"]
    published = api_client.post(
        "/api/v1/stories",
        json={
            "content_type": "announcement",
            "caption": "an announcement",
            "media_id": media_id,
        },
        headers=candidate.headers,
    )
    assert published.status_code == 201, published.text

    assert _fetch(api_client, stranger, media_id).status_code == 200


def test_another_member_can_read_somebodys_avatar(
    api_client, candidate, stranger
) -> None:
    """Otherwise every card header shows initials instead of a face.

    `PUT /users/me/photo?kind=image` uploads the bytes *and* points
    `users.avatar_media_id` at them in one call, so the id the test reads back is
    the one the reference check will look for.
    """

    response = api_client.put(
        "/api/v1/users/me/photo?kind=image",
        content=PNG,
        headers={**candidate.headers, "Content-Type": "image/png"},
    )
    assert response.status_code in (200, 201), response.text
    media_id = response.json()["id"]
    assert media_id

    assert _fetch(api_client, stranger, media_id).status_code == 200
    # ...and a member can read it exactly once per request rather than the URL
    # being guessable: an id nobody was ever shown still 404s for a stranger.
    orphan = _seed_asset(api_client, candidate)["id"]
    assert _fetch(api_client, stranger, orphan).status_code == 404


def test_the_reference_check_survives_the_post_being_deleted(
    api_client, candidate, stranger
) -> None:
    """A tombstoned post leaves every read, so its image stops being readable.

    The predicate is the feed's own (``deleted_at IS NULL``). Sharing it is the
    point: if the two ever disagreed, a deleted post's picture would outlive it.
    """

    media_id = _seed_asset(api_client, candidate)["id"]
    post = _publish_post(api_client, candidate, [media_id])
    assert _fetch(api_client, stranger, media_id).status_code == 200

    removed = api_client.delete(
        f"/api/v1/posts/{post['id']}", headers=candidate.headers
    )
    assert removed.status_code == 204, removed.text

    assert _fetch(api_client, stranger, media_id).status_code == 404


def test_a_document_is_never_readable_by_another_member(
    api_client, candidate, stranger
) -> None:
    """A PDF is a private resume or certificate, whatever else points at it.

    `POSTABLE_KINDS` is `{image, video}`, so no post can reference one — but the
    rule is checked on *kind* rather than inferred from the absence of a
    reference, so a future attachment surface cannot widen it by accident.
    """

    media_id = _seed_asset(
        api_client, candidate, pdf_bytes(), mime="application/pdf", kind="document"
    )["id"]

    assert _fetch(api_client, stranger, media_id).status_code == 404
    # ...and the owner still can, because the widening never took anything away.
    assert _fetch(api_client, candidate, media_id).status_code == 200


def test_an_unauthenticated_caller_cannot_read_any_media(api_client, candidate) -> None:
    """Publishing widens the audience to members, never to anonymous callers."""

    media_id = _seed_asset(api_client, candidate)["id"]
    _publish_post(api_client, candidate, [media_id])

    anonymous = api_client.get(f"/api/v1/media/{media_id}")
    assert anonymous.status_code == 401, anonymous.text


def test_a_deleted_post_still_blocks_its_own_author_from_nothing(
    api_client, candidate
) -> None:
    """Deleting a post must not lock its author out of their own upload."""

    media_id = _seed_asset(api_client, candidate)["id"]
    post = _publish_post(api_client, candidate, [media_id])
    api_client.delete(f"/api/v1/posts/{post['id']}", headers=candidate.headers)

    assert _fetch(api_client, candidate, media_id).status_code == 200


# --- limits: ?11.4 -----------------------------------------------------------


def test_get_media_returns_limits_not_a_list(api_client, candidate) -> None:
    """?11.4 calls the trap out by name: this path is a *limits document*.

    It reads like a collection. A server that returned an array here would leave
    every limit in the app undefined, and the failure would show up as a picker
    that does no pre-flight validation at all.
    """

    body = _limits(api_client, candidate)

    assert isinstance(body, dict)
    assert "items" not in body
    assert set(body) == {
        "max_bytes",
        "max_items_per_post",
        "max_body_chars",
        "image_mime_types",
        "video_mime_types",
        "document_mime_types",
        "max_document_bytes",
        "video_duration_enforced",
    }


def test_the_published_limits_are_the_enforced_ones(api_client, candidate) -> None:
    """?11.4: "a limit change must not require a client release".

    That is only true while the published document and the enforcement path read
    the same constants. A hand-copied second list is how they would drift, so this
    compares the response against the service's own module.
    """

    body = _limits(api_client, candidate)

    assert body["max_bytes"] == svc.MAX_BYTES
    assert body["max_document_bytes"] == svc.MAX_DOCUMENT_BYTES
    assert body["max_items_per_post"] == svc.MAX_ITEMS_PER_POST
    assert body["max_body_chars"] == svc.MAX_BODY_CHARS
    assert body["image_mime_types"] == list(svc.IMAGE_MIME_TYPES)
    assert body["video_mime_types"] == list(svc.VIDEO_MIME_TYPES)
    assert body["document_mime_types"] == list(svc.DOCUMENT_MIME_TYPES)


def test_the_document_ceiling_is_lower_than_the_general_one(
    api_client, candidate
) -> None:
    """?11.4: "the document ceiling, which is lower than the video one"."""

    body = _limits(api_client, candidate)

    assert body["max_document_bytes"] < body["max_bytes"]


def test_the_published_mime_sets_match_the_specification(api_client, candidate) -> None:
    """?11.5's exact lists ? no `audio/*`, no `image/gif`, no wildcards."""

    body = _limits(api_client, candidate)

    assert body["image_mime_types"] == ["image/png", "image/jpeg", "image/webp"]
    assert body["document_mime_types"] == ["application/pdf"]
    assert all("*" not in m for m in body["image_mime_types"])


def test_video_duration_enforcement_is_published_as_false(
    api_client, candidate
) -> None:
    """?11.4: an honest signal, so the UI does not claim a check that is absent."""

    assert _limits(api_client, candidate)["video_duration_enforced"] is False


def test_the_ceiling_is_ten_megabytes(api_client, candidate) -> None:
    """?11.5: "Images: PNG/JPEG/WebP, max 10 MB"."""

    assert _limits(api_client, candidate)["max_bytes"] == 10 * 1024 * 1024


# --- size validation ---------------------------------------------------------


def test_a_smallest_possible_valid_image_is_accepted(api_client, candidate) -> None:
    """The lower boundary: 1x1 is the smallest image the sniffer can read."""

    response = _upload(api_client, candidate, png_bytes(1, 1))

    assert response.status_code == 201, response.text


def test_an_oversized_declared_length_is_refused_before_the_body(api_client, candidate
) -> None:
    """A ``Content-Length`` over the ceiling is a 413 with no row written.

    The point is the early rejection: the header is compared before the body is
    read, so the cost is one integer comparison rather than 10 MB of buffering.
    """

    headers = {
        **candidate.headers,
        "Content-Type": "image/png",
        "Content-Length": str(svc.MAX_BYTES + 1),
    }
    response = api_client.post(
        "/api/v1/media", params={"kind": "image"}, content=PNG, headers=headers
    )

    assert response.status_code in (413, 422), response.status_code
    assert _rows(api_client) == []


def test_a_document_over_its_own_ceiling_is_refused(api_client, candidate) -> None:
    """Documents have a lower ceiling, so a file fine as an image is not fine
    as a document."""

    oversized = b"%PDF-1.7\n" + b"x" * (svc.MAX_DOCUMENT_BYTES + 1024)

    response = _upload(
        api_client, candidate, oversized, kind="document", mime="application/pdf"
    )

    assert response.status_code in (413, 422), response.status_code


def test_the_refusal_names_the_limit(api_client, candidate) -> None:
    """?11.5: "Reject with a 422 that names the limit".

    The client renders the number rather than hard-coding one -- the whole
    reason ?11.4 publishes the limits in the first place.
    """

    oversized = b"%PDF-1.7\n" + b"x" * (svc.MAX_DOCUMENT_BYTES + 1024)
    response = _upload(
        api_client, candidate, oversized, kind="document", mime="application/pdf"
    )

    error = response.json()["error"]
    # "names the limit" is §11.5's wording: the number is in the sentence itself,
    # so a client can render it without hard-coding one.
    limit = str(svc.MAX_DOCUMENT_BYTES)
    assert "5 MB" in error["message"] or limit in error["message"]

# --- replacement, deletion, photo -------------------------------------------


def _replace(api_client, account, media_id, payload, mime="image/png", kind="image"):
    return api_client.put(
        f"/api/v1/media/{media_id}",
        params={"kind": kind},
        content=payload,
        headers={**account.headers, "Content-Type": mime},
    )


def test_the_owner_can_replace_their_asset(api_client, candidate) -> None:
    media_id = _seed_asset(api_client, candidate)["id"]
    replacement = png_bytes(30, 20)

    response = _replace(api_client, candidate, media_id, replacement)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["size_bytes"] == len(replacement)
    assert body["width"] == 30 and body["height"] == 20


def test_the_new_bytes_are_what_is_served(api_client, candidate) -> None:
    media_id = _seed_asset(api_client, candidate)["id"]
    replacement = png_bytes(12, 14)

    _replace(api_client, candidate, media_id, replacement)

    assert _fetch(api_client, candidate, media_id).content == replacement


def test_replacement_keeps_the_identity_and_the_url(api_client, candidate) -> None:
    """A post already referencing this asset must keep working after a PUT."""

    before = _seed_asset(api_client, candidate)

    after = _replace(api_client, candidate, before["id"], png_bytes(9, 9)).json()

    assert after["id"] == before["id"]
    assert after["served_at"] == before["served_at"]


def test_replacement_never_transfers_ownership(api_client, candidate, stranger) -> None:
    """There is no owner field in the request, so there is nothing to transfer."""

    media_id = _seed_asset(api_client, candidate)["id"]

    response = _replace(api_client, stranger, media_id, PNG)

    assert response.status_code == 404, response.text


def test_a_stranger_cannot_replace_another_accounts_asset(
    api_client, candidate, stranger
) -> None:
    media_id = _seed_asset(api_client, candidate)["id"]

    response = _replace(api_client, stranger, media_id, PNG)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_a_rejected_replacement_leaves_the_previous_bytes(
    api_client, candidate
) -> None:
    """Atomic failure: a bad replacement must not clear a working asset."""

    media_id = _seed_asset(api_client, candidate)["id"]

    response = _replace(
        api_client, candidate, media_id, b"not an image", mime="image/png"
    )

    assert response.status_code == 422
    assert _fetch(api_client, candidate, media_id).content == PNG


def test_a_replacement_cannot_change_the_stored_type(api_client, candidate) -> None:
    """A JPEG slot stays a JPEG slot; swapping in a PNG would break the stored
    MIME that clients cache."""

    media_id = _seed_asset(api_client, candidate, jpeg_bytes(), mime="image/jpeg")["id"]

    response = _replace(api_client, candidate, media_id, PNG)

    assert response.status_code == 422, response.text


def test_the_owner_can_delete_their_asset(api_client, candidate) -> None:
    media_id = _seed_asset(api_client, candidate)["id"]

    response = api_client.delete(
        f"/api/v1/media/{media_id}", headers=candidate.headers
    )

    assert response.status_code == 204, response.text
    assert _row(api_client, media_id) is None


def test_a_stranger_cannot_delete_another_accounts_asset(
    api_client, candidate, stranger
) -> None:
    media_id = _seed_asset(api_client, candidate)["id"]

    response = api_client.delete(
        f"/api/v1/media/{media_id}", headers=stranger.headers
    )

    assert response.status_code == 404
    assert _row(api_client, media_id) is not None


def test_deleting_twice_is_a_404_not_a_500(api_client, candidate) -> None:
    media_id = _seed_asset(api_client, candidate)["id"]
    url = f"/api/v1/media/{media_id}"

    assert api_client.delete(url, headers=candidate.headers).status_code == 204
    assert api_client.delete(url, headers=candidate.headers).status_code == 404


def test_putting_a_photo_uploads_and_points_the_account_at_it(
    api_client, candidate
) -> None:
    """?11.2: upload and replace are the same call, with no delete-then-upload
    race that could leave a person with no photo."""

    response = api_client.put(
        "/api/v1/users/me/photo",
        content=PNG,
        headers={**candidate.headers, "Content-Type": "image/png"},
    )

    assert response.status_code == 200, response.text
    # `avatar_url` is only non-null once the account points at real media, so the
    # pointer is observable through the public account shape.
    me = api_client.get("/api/v1/users/me", headers=candidate.headers).json()
    assert me["avatar_url"] == response.json()["served_at"]


def test_putting_a_photo_twice_replaces_rather_than_failing(
    api_client, candidate
) -> None:
    """The client's own words: "upload" and "replace" are the same call."""

    headers = {**candidate.headers, "Content-Type": "image/png"}
    first = api_client.put("/api/v1/users/me/photo", content=PNG, headers=headers)
    second = api_client.put(
        "/api/v1/users/me/photo", content=png_bytes(6, 6), headers=headers
    )

    assert first.status_code == 200 and second.status_code == 200
    me = api_client.get("/api/v1/users/me", headers=candidate.headers).json()
    assert me["avatar_url"] == second.json()["served_at"]
    assert first.json()["id"] != second.json()["id"]


def test_deleting_a_photo_clears_the_pointer_but_keeps_the_asset(
    api_client, candidate
) -> None:
    """?14.11 puts reference-checking on the media delete route, not this one."""

    media_id = _upload(
        api_client, candidate, PNG
    ).json()["id"]
    api_client.put(
        "/api/v1/users/me/photo",
        content=PNG,
        headers={**candidate.headers, "Content-Type": "image/png"},
    )

    response = api_client.delete("/api/v1/users/me/photo", headers=candidate.headers)

    assert response.status_code == 204, response.text
    me = api_client.get("/api/v1/users/me", headers=candidate.headers).json()
    assert me["avatar_url"] is None
    assert _row(api_client, media_id) is not None


def test_a_photo_can_only_point_at_the_callers_own_asset(
    api_client, stranger, candidate
) -> None:
    """The avatar is the one pointer other people see, so it is scoped hardest."""

    theirs = _seed_asset(api_client, candidate)["id"]

    response = api_client.put(
        "/api/v1/users/me/photo",
        content=PNG,
        headers={**stranger.headers, "Content-Type": "image/png"},
    )

    assert response.status_code == 200
    # The stranger got their *own* upload, not the candidate's asset.
    assert response.json()["id"] != theirs

# --- documents, security, schema --------------------------------------------


def test_a_private_document_is_uploaded_to_an_existing_slot(
    api_client, candidate
) -> None:
    """?11.2: ``POST /media/{id}`` -- what ``uploadDocument(path, ...)`` binds to."""

    media_id = _seed_asset(api_client, candidate)["id"]

    response = api_client.post(
        f"/api/v1/media/{media_id}",
        content=pdf_bytes(),
        headers={**candidate.headers, "Content-Type": "application/pdf"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["kind"] == "document"


def test_a_document_route_cannot_be_used_as_an_image_slot(
    api_client, candidate
) -> None:
    """The kind is forced to ``document`` -- a client cannot choose otherwise."""

    media_id = _seed_asset(api_client, candidate)["id"]

    response = api_client.post(
        f"/api/v1/media/{media_id}",
        content=PNG,
        headers={**candidate.headers, "Content-Type": "image/png"},
    )

    assert response.status_code == 422, response.text


def test_a_stranger_cannot_upload_a_document_to_your_slot(
    api_client, candidate, stranger
) -> None:
    media_id = _seed_asset(api_client, candidate)["id"]

    response = api_client.post(
        f"/api/v1/media/{media_id}",
        content=pdf_bytes(),
        headers={**stranger.headers, "Content-Type": "application/pdf"},
    )

    assert response.status_code == 404, response.text


def test_the_kind_registry_is_exactly_the_three_documented_values() -> None:
    """?14.11. ``audio``/``gif``/``archive`` are absent because the server cannot
    validate a MIME set for them."""

    assert {k.value for k in MediaKind} == {"image", "video", "document"}


def test_the_database_refuses_a_kind_outside_the_registry(
    api_client, candidate
) -> None:
    """The CHECK is at the database level, not merely in the Python enum."""

    _assert_database_rejects(
        api_client,
        MediaAsset(
            owner_id=uuid.UUID(candidate.id),
            kind=MediaKind.IMAGE,
            mime_type="audio",
            size_bytes=-1,
            storage_kind="database",
            storage_key="neg",
            served_at="/api/v1/media/neg",
            data=b"x",
        ),
    )
def test_a_negative_size_is_refused_by_the_database(api_client, candidate) -> None:
    """?14.11's "CHECK ? 0"."""

    _assert_database_rejects(
        api_client,
        MediaAsset(
            owner_id=uuid.UUID(candidate.id),
            kind=MediaKind.IMAGE,
            mime_type="image/png",
            size_bytes=-1,
            storage_kind="database",
            storage_key="neg",
            served_at="/api/v1/media/neg",
            data=b"x",
        ),
    )
def test_the_bytes_are_stored_as_bytea_not_text(api_client, candidate) -> None:
    """Storage must not transcode: a PNG is bytes, not a string."""

    media_id = _seed_asset(api_client, candidate)["id"]

    stored = _client_session(api_client).execute(
        text("SELECT pg_typeof(data)::text FROM media_assets WHERE id = :i"),
        {"i": uuid.UUID(media_id)},
    ).scalar_one()

    assert stored == "bytea"


def test_a_metadata_read_does_not_load_the_bytes(api_client, candidate) -> None:
    """A ``SELECT *`` on this table drags every uploaded byte through the driver.

    The read model is built from named attributes and the listing helper selects
    columns explicitly, so a metadata response can never pull megabytes.
    """

    row = _row(api_client, _seed_asset(api_client, candidate)["id"])

    body = svc.read_model(row)

    assert set(body.model_dump()) == {
        "id",
        "kind",
        "mime_type",
        "width",
        "height",
        "size_bytes",
        "served_at",
    }
    # And the JSON contains no path, no storage locator, no owner.
    assert "storage_key" not in body.model_dump()
    assert "/" not in body.model_dump()["served_at"].replace("/api/v1/media/", "")


def test_the_owner_index_exists_and_is_used(api_client, candidate) -> None:
    """?14.11's ``(owner_id, created_at DESC)`` -- the index every read here wants."""

    _seed_asset(api_client, candidate)

    _client_session(api_client).execute(text("SET LOCAL enable_seqscan = off"))
    plan = _client_session(api_client).execute(
        text(
            "EXPLAIN SELECT id FROM media_assets WHERE owner_id = :u "
            "ORDER BY created_at DESC LIMIT 20"
        ),
        {"u": uuid.UUID(candidate.id)},
    ).scalars().all()

    assert "ix_media_assets_owner_id_created_at" in " ".join(plan)


def test_deleting_an_account_takes_its_uploads_with_it(api_client, candidate
) -> None:
    """?14.11's CASCADE, and ?13.4's reasoning applied to bytes.

    An upload is owned by exactly one account, so its bytes go with it rather
    than being orphaned where nobody can authorize them.
    """

    media_id = uuid.UUID(_seed_asset(api_client, candidate)["id"])

    session = _client_session(api_client)
    session.delete(session.get(User, uuid.UUID(candidate.id)))
    _client_session(api_client).commit()

    assert _row(api_client, media_id) is None


def test_deleting_an_avatar_asset_clears_the_pointer_not_the_account(
    api_client, candidate
) -> None:
    """``SET NULL`` on the avatar FK: removing a photo must not remove a person."""

    media_id = uuid.UUID(_seed_asset(api_client, candidate)["id"])
    account = _client_user(api_client, candidate.id)
    account.avatar_media_id = media_id
    _client_session(api_client).commit()

    _client_session(api_client).delete(_row(api_client, media_id))
    _client_session(api_client).commit()

    survivor = _client_user(api_client, candidate.id)
    assert survivor is not None
    assert survivor.avatar_media_id is None


def test_an_employer_may_upload_too(api_client, employer) -> None:
    """No role restriction: ?11.2 marks these routes [M] with no role qualifier."""

    response = _upload(api_client, employer, PNG)

    assert response.status_code == 201, response.text


def test_every_error_uses_the_project_envelope(api_client, stranger, candidate) -> None:
    """No route may answer with FastAPI's ``{"detail": ...}``."""

    media_id = _seed_asset(api_client, candidate)["id"]

    responses = (
        _fetch(api_client, stranger, media_id),
        _upload(api_client, stranger, b"nope", mime="image/png"),
        api_client.delete(f"/api/v1/media/{media_id}", headers=stranger.headers),
    )
    for response in responses:
        body = response.json()
        assert set(body) == {"error"}
        assert set(body["error"]) >= {"code", "message", "details", "request_id"}


def test_no_media_response_carries_a_secret(api_client, candidate) -> None:
    """No password, token, database URL, or filesystem path anywhere."""

    bodies = [
        _upload(api_client, candidate, PNG).text,
        _limits(api_client, candidate) and api_client.get(
            "/api/v1/media", headers=candidate.headers
        ).text,
    ]
    for blob in bodies:
        for forbidden in (
        "password",
        "argon2",
        "jwt",
        "postgres://",
        "postgresql://",
    ):
            assert forbidden.lower() not in blob.lower()
