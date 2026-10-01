"""Phase 8 — posts. The [M] routes of §9.1, and the media rules §7 leans on.

**The author is never the client's to choose.** §9.3 forbids impersonation, and
the strongest way to test that is to *try* it: `author_id` is sent in a body and
must be refused outright, and a post created by one account must come back
attributed to that account when a second one reads it. A test that only ever
publishes as the reader cannot tell an ownership check from a missing one.

**`kind` is derived, so a lying client is the test.** §9.2: kind "is derived
server-side from which payload is present, never accepted as a free string. The
client sends it, but the server decides." `PostCreate` *requires* `kind` because
the client always sends it, and these tests send a deliberately wrong one to prove
the stored value is the server's conclusion and not the request's.

**Soft delete is asserted as behaviour, not as a column.** §9.3 wants the row to
survive so its position and comments do, and a tombstone to leave the feed. So
the tests check all three faces: gone from `GET /posts`, gone from `/posts/mine`,
gone from `GET /posts/{id}` — and the row still there afterwards.

**Media rules are Phase 7's, reused rather than reimplemented.** Every
attachment here is uploaded through the real `POST /media` route, so ownership,
MIME sniffing and dimension derivation are the genuine article. The post-specific
rules under test are: the attachment must belong to the author, a document cannot
be attached, `position` preserves the caller's order, and a referenced asset
cannot be deleted.

**A third account is present throughout** for the same reason the media suite has
one: an ownership assertion needs something to steal.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text

from app.models import Post, PostMedia
from app.models.enums import MediaKind, PostCategory, PostKind
from app.schemas.common import DEFAULT_PAGE_LIMIT
from tests.conftest import REJECTION_ERRORS, Account, assert_rejected
from tests.test_p7_media import mp4_bytes, png_bytes

#: Nobody's post. Only used where authentication or the id parse is the subject.
NOBODY = str(uuid.UUID(int=0))

POST_ROUTES = [
    ("get", "/api/v1/posts", None),
    ("get", "/api/v1/posts/mine", None),
    ("post", "/api/v1/posts", {}),
    ("get", f"/api/v1/posts/{NOBODY}", None),
    ("patch", f"/api/v1/posts/{NOBODY}", {}),
    ("delete", f"/api/v1/posts/{NOBODY}", None),
]


# --- helpers ------------------------------------------------------------------


def body(**overrides) -> dict:
    """A minimal valid ``POST /posts`` body.

    ``kind`` is present because the client always sends it, and the derivation
    tests override it with a lie. A text post is the simplest case: body only, no
    media, so kind derivation has one job to do.
    """
    payload = {"kind": "text", "category": "community", "body": "Hello from the feed."}
    payload.update(overrides)
    return payload


def publish(api_client, account: Account, **overrides) -> dict:
    """``POST /posts`` and assert it was created. Returns the JSON body."""
    response = api_client.post(
        "/api/v1/posts", json=body(**overrides), headers=account.headers
    )
    assert response.status_code == 201, response.text
    return response.json()


def upload_image(api_client, account: Account, **kwargs) -> str:
    """A real PNG uploaded through the real route; returns its id."""
    response = api_client.post(
        "/api/v1/media?kind=image",
        content=png_bytes(**kwargs),
        headers={**account.headers, "Content-Type": "image/png"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def upload_document(api_client, account: Account) -> str:
    """A real PDF, for the "a document is not postable" test."""
    response = api_client.post(
        "/api/v1/media?kind=document",
        content=b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
        headers={**account.headers, "Content-Type": "application/pdf"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _client_session(api_client):
    """The rolled-back session the TestClient's routes share. See `test_p7_media`."""
    override = api_client.app.dependency_overrides[
        __import__("app.db.session", fromlist=["get_db"]).get_db
    ]
    return next(override())


def _rows(api_client) -> list[Post]:
    return list(_client_session(api_client).scalars(select(Post)))


def _links(api_client, post_id) -> list[PostMedia]:
    return list(
        _client_session(api_client)
        .scalars(
            select(PostMedia)
            .where(PostMedia.post_id == uuid.UUID(str(post_id)))
            .order_by(PostMedia.position)
        )
    )



# --- transport: authentication and envelope -----------------------------------


@pytest.mark.parametrize(("method", "path", "payload"), POST_ROUTES)
def test_every_post_route_needs_a_token(api_client, method, path, payload) -> None:
    """§9.1 marks all six [M]; a member-visible feed, not a public one."""
    kwargs = {"json": payload} if payload is not None else {}
    response = getattr(api_client, method)(path, **kwargs)
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "not_authenticated"


def test_a_malformed_post_id_is_a_404_not_a_422(api_client, candidate) -> None:
    """`services.ownership.parse_id` treats a bad id as "no such record".

    The project rule (`ownership.py`): "keeps the endpoint from becoming a UUID-
    format oracle". A 422 would confirm the string was *supposed* to be a UUID,
    which tells a caller something a plain 404 does not. Phase 6 and Phase 7 both
    assert this for their routes, so posts is held to the same bar.
    """
    for raw in ("not-a-uuid", "12345", "null", "0000"):
        response = api_client.get(
            f"/api/v1/posts/{raw}", headers=candidate.headers
        )
        assert response.status_code == 404, (raw, response.text)
        assert response.json()["error"]["code"] == "not_found"


def test_an_unknown_post_id_is_a_404(api_client, candidate) -> None:
    response = api_client.get(f"/api/v1/posts/{NOBODY}", headers=candidate.headers)
    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "not_found"


def test_mine_is_not_captured_by_the_parameterised_route(api_client, candidate) -> None:
    """``/posts/mine`` must be declared before ``/posts/{post_id}``.

    Otherwise Starlette matches the parameterised route, binds "mine" to the id,
    and `parse_id` answers 404 for the client's own "My Posts" screen — which reads
    like a client bug rather than a declaration-order mistake. This is the
    assertion that keeps the two in order.
    """
    response = api_client.get("/api/v1/posts/mine", headers=candidate.headers)
    assert response.status_code == 200, response.text
    page = response.json()
    # The envelope is §9.1's `PostPage`; the default limit is the shared
    # `page_params` one, asserted by value so a change is deliberate here.
    assert page == {
        "items": [],
        "total": 0,
        "limit": DEFAULT_PAGE_LIMIT,
        "offset": 0,
        "has_more": False,
    }


# --- create: the contract §9.1 and §9.2 fix ------------------------------------


def test_create_returns_201_and_the_stored_post(api_client, candidate) -> None:
    """§9.1: "the client renders only after 201" — so 201, and the stored copy."""
    response = api_client.post(
        "/api/v1/posts", json=body(title="First"), headers=candidate.headers
    )
    assert response.status_code == 201, response.text
    created = response.json()

    # And it is the *stored* post: reading it back gives the same thing.
    fetched = api_client.get(
        f"/api/v1/posts/{created['id']}", headers=candidate.headers
    ).json()
    assert fetched["id"] == created["id"]
    assert fetched["body"] == created["body"]
    assert fetched["title"] == "First"


def test_the_author_is_the_caller_never_the_request(
    api_client, candidate, other_candidate
) -> None:
    """§9.3's impersonation rule, asserted from the reader's side."""
    created = publish(api_client, candidate, body="Mine.")
    assert created["author"]["name"] == candidate.body["name"]
    assert created["author"]["is_self"] is True

    seen = api_client.get(
        f"/api/v1/posts/{created['id']}", headers=other_candidate.headers
    ).json()
    assert seen["author"]["is_self"] is False
    assert seen["author"]["name"] == candidate.body["name"]


def test_a_client_supplied_author_id_is_refused(
    api_client, candidate, other_candidate
) -> None:
    """``extra="forbid"`` makes impersonation a parse error, not a silent drop."""
    response = api_client.post(
        "/api/v1/posts",
        json=body(author_id=other_candidate.id),
        headers=candidate.headers,
    )
    assert response.status_code == 422, response.text
    details = response.json()["error"]["details"]
    assert any("author_id" in d["field"] for d in details)


def test_verified_is_always_false(api_client, candidate) -> None:
    """§9.2: it "must default to `false` and require a real signal".

    A `true` here is a credential claim the client renders as a badge, and V1 has
    no verification system to justify one.
    """
    assert publish(api_client, candidate)["author"]["verified"] is False


def test_the_author_headline_comes_from_the_profile(api_client, candidate) -> None:
    """`headline` lives on `profiles`, not `users` — a real regression guard.

    Reading it off the `User` row raises `AttributeError`, so this asserts the
    value actually arrives rather than only that the call does not 500.
    """
    response = api_client.patch(
        "/api/v1/profile",
        json={"headline": "Software Engineering Intern"},
        headers=candidate.headers,
    )
    assert response.status_code == 200, response.text

    created = publish(api_client, candidate)
    assert created["author"]["headline"] == "Software Engineering Intern"


def test_a_post_with_no_profile_still_has_an_author(api_client, candidate) -> None:
    """A post is publishable before onboarding finishes; the card shows no headline."""
    created = publish(api_client, candidate)
    assert created["author"]["headline"] is None
    assert created["author"]["avatar_url"] is None


def test_the_avatar_url_is_the_served_path(api_client, candidate) -> None:
    """§14.11's relative `served_at` path, resolved the way `/users/me` resolves it."""
    upload = api_client.put(
        "/api/v1/users/me/photo?kind=image",
        content=png_bytes(),
        headers={**candidate.headers, "Content-Type": "image/png"},
    )
    assert upload.status_code == 200, upload.text
    expected = api_client.get("/api/v1/users/me", headers=candidate.headers).json()[
        "avatar_url"
    ]

    created = publish(api_client, candidate)
    assert created["author"]["avatar_url"] == expected
    assert created["author"]["avatar_url"].startswith("/api/v1/media/")
# --- kind derivation (§9.2) ----------------------------------------------------


def test_a_body_only_post_is_text(api_client, candidate) -> None:
    assert publish(api_client, candidate)["kind"] == PostKind.TEXT


def test_an_attached_image_is_an_image_post(api_client, candidate) -> None:
    """Even with a body: media outranks prose, so the card renders an image block."""
    media_id = upload_image(api_client, candidate)
    created = publish(api_client, candidate, body="Caption.", media_ids=[media_id])
    assert created["kind"] == PostKind.IMAGE


def test_an_attached_video_is_a_video_post(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/media?kind=video",
        content=mp4_bytes(),
        headers={**candidate.headers, "Content-Type": "video/mp4"},
    )
    assert response.status_code == 201, response.text
    created = publish(
        api_client, candidate, body="Clip.", media_ids=[response.json()["id"]]
    )
    assert created["kind"] == PostKind.VIDEO


def test_a_project_payload_is_a_project_post(api_client, candidate) -> None:
    """No body at all — §9.2 allows a post whose only payload is `project`."""
    created = publish(api_client, candidate, body=None, project={"title": "Mahaa"})
    assert created["kind"] == PostKind.PROJECT
    assert created["project"] == {"title": "Mahaa"}


def test_an_achievement_beats_a_project(api_client, candidate) -> None:
    """Precedence is fixed, so the same post cannot render two different blocks."""
    created = publish(
        api_client,
        candidate,
        body=None,
        project={"title": "Mahaa"},
        achievement={"title": "First PR"},
    )
    assert created["kind"] == PostKind.ACHIEVEMENT


def test_a_project_stays_a_project_when_a_screenshot_is_attached(
    api_client, candidate
) -> None:
    """The precedence rule applied to the case that motivated it."""
    media_id = upload_image(api_client, candidate)
    created = publish(
        api_client,
        candidate,
        body=None,
        project={"title": "Mahaa"},
        media_ids=[media_id],
    )
    assert created["kind"] == PostKind.PROJECT


def test_learning_prose_is_a_learning_post(api_client, candidate) -> None:
    """§9.2's one non-payload kind, so learning prose is not `community` prose."""
    created = publish(api_client, candidate, category="learning", body="Notes.")
    assert created["kind"] == PostKind.LEARNING


@pytest.mark.parametrize(
    ("sent", "expected"),
    [
        ("achievement", PostKind.TEXT),
        ("project", PostKind.TEXT),
        ("video", PostKind.TEXT),
    ],
)
def test_a_client_supplied_kind_is_ignored(
    api_client, candidate, sent, expected
) -> None:
    """§9.2: "The client sends it, but the server decides."

    The client always includes `kind`, so a lying one is the only way to prove the
    stored column is the server's conclusion. A server that trusted the field
    would let a caller choose which block the feed renders.
    """
    assert publish(api_client, candidate, kind=sent)["kind"] == expected


def test_kind_is_derived_before_the_row_is_written(api_client, candidate) -> None:
    """The stored column, not just the response — the two must not be able to differ."""
    created = publish(api_client, candidate, kind="achievement")
    stored = _rows(api_client)[0]
    assert stored.kind == PostKind.TEXT
    assert str(stored.id) == created["id"]


# --- payload validation (§9.3) -------------------------------------------------


@pytest.mark.parametrize("body_text", [None, "", "   "])
def test_a_post_with_no_payload_is_422(api_client, candidate, body_text) -> None:
    """§9.3: at least one of body, media, project, achievement.

    Whitespace counts as absent — it is not a payload the client can render.
    """
    response = api_client.post(
        "/api/v1/posts", json=body(body=body_text), headers=candidate.headers
    )
    assert response.status_code == 422, response.text


def test_a_rejected_post_leaves_no_row_and_no_attachment(
    api_client, candidate
) -> None:
    """The commit is at the end, so a failure cannot leave a partial post behind."""
    media_id = upload_image(api_client, candidate)
    response = api_client.post(
        "/api/v1/posts",
        json=body(kind="image", body=None, media_ids=[]),
        headers=candidate.headers,
    )
    assert response.status_code == 422, response.text
    assert _rows(api_client) == []
    assert _links(api_client, media_id) == []


def test_an_unknown_category_is_422(api_client, candidate) -> None:
    """The feed renders one chip per value, so a fifth would render a dead chip."""
    response = api_client.post(
        "/api/v1/posts", json=body(category="ramblings"), headers=candidate.headers
    )
    assert response.status_code == 422, response.text


def test_the_length_ceilings_are_enforced(api_client, candidate) -> None:
    """§9.3's limits are schema constraints, not comments."""
    for payload in (
        body(body="x" * 5001),
        body(body="ok", title="y" * 201),
        body(body="ok", tags=[f"t{i}" for i in range(21)]),
        body(body="ok", media_ids=[str(uuid.uuid4()) for _ in range(11)]),
    ):
        response = api_client.post(
            "/api/v1/posts", json=payload, headers=candidate.headers
        )
        assert response.status_code == 422, (payload.keys(), response.text)


def test_an_unknown_project_field_is_422(api_client, candidate) -> None:
    """`project` is `extra="forbid"` too — a typo is not silently dropped."""
    response = api_client.post(
        "/api/v1/posts",
        json=body(body=None, project={"title": "Mahaa", "salary": 1}),
        headers=candidate.headers,
    )
    assert response.status_code == 422, response.text

# --- media rules (§9.2 / §9.3) -------------------------------------------------


def test_an_attachment_is_echoed_with_the_served_path(api_client, candidate) -> None:
    """The `media[]` entry is §9.2's field list, including server-derived dimensions."""
    media_id = upload_image(api_client, candidate)
    created = publish(api_client, candidate, media_ids=[media_id])
    entry = created["media"][0]
    assert entry["id"] == media_id
    assert entry["kind"] == MediaKind.IMAGE
    assert entry["uri"] == f"/api/v1/media/{media_id}"
    assert (entry["width"], entry["height"]) == (4, 3)
    assert entry["position"] == 0


def test_the_attachments_keep_the_callers_order(api_client, candidate) -> None:
    """§14.9 makes `position` part of the key, so the list order *is* the order.

    Three distinct sizes, so the assertion could not pass on a set or on an
    accidental sort by id.
    """
    ids = [upload_image(api_client, candidate, width=w) for w in (4, 9, 7)]
    created = publish(api_client, candidate, media_ids=list(reversed(ids)))
    assert [entry["id"] for entry in created["media"]] == list(reversed(ids))
    assert [entry["position"] for entry in created["media"]] == [0, 1, 2]


def test_the_stored_positions_are_the_callers_order(api_client, candidate) -> None:
    """The database rows, not just the response — they make the same claim."""
    ids = [upload_image(api_client, candidate, width=w) for w in (4, 9)]
    created = publish(api_client, candidate, media_ids=ids)
    links = _links(api_client, created["id"])
    assert [(str(link.media_id), link.position) for link in links] == [
        (ids[0], 0),
        (ids[1], 1),
    ]


def test_the_same_image_twice_is_one_attachment(api_client, candidate) -> None:
    """A repeat would otherwise hit `unique (post_id, media_id)` as a 500."""
    media_id = upload_image(api_client, candidate)
    created = publish(api_client, candidate, media_ids=[media_id, media_id])
    assert [entry["id"] for entry in created["media"]] == [media_id]
    assert len(_links(api_client, created["id"])) == 1


def test_another_accounts_attachment_is_403(
    api_client, candidate, other_candidate
) -> None:
    """Phase 7's IDOR rule: the caller named a specific thing they were refused."""
    media_id = upload_image(api_client, other_candidate)
    response = api_client.post(
        "/api/v1/posts", json=body(media_ids=[media_id]), headers=candidate.headers
    )
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "forbidden"
    assert _rows(api_client) == []


def test_an_attachment_that_does_not_exist_is_404(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/posts", json=body(media_ids=[str(uuid.uuid4())]),
        headers=candidate.headers,
    )
    assert response.status_code == 404, response.text


def test_a_document_cannot_be_attached(api_client, candidate) -> None:
    """`POSTABLE_KINDS` is `{image, video}`: a PDF has no dimensions to lay out."""
    document_id = upload_document(api_client, candidate)
    response = api_client.post(
        "/api/v1/posts",
        json=body(body="My resume.", media_ids=[document_id]),
        headers=candidate.headers,
    )
    assert response.status_code == 422, response.text
    assert _rows(api_client) == []


# --- reading: pagination, filtering, /posts/mine -------------------------------


def feed(api_client, account: Account, path: str = "/api/v1/posts", **params) -> dict:
    response = api_client.get(path, headers=account.headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_the_empty_feed_is_a_full_envelope(api_client, candidate) -> None:
    """Not `[]` — §17's pager reads `total` and `has_more`."""
    assert feed(api_client, candidate) == {
        "items": [],
        "total": 0,
        "limit": DEFAULT_PAGE_LIMIT,
        "offset": 0,
        "has_more": False,
    }


def test_total_is_a_real_count_not_the_page_length(api_client, candidate) -> None:
    """§9.1: "``total`` must be a real count, not a page length"."""
    for i in range(5):
        publish(api_client, candidate, body=f"Post {i}")
    page = feed(api_client, candidate, limit=2)
    assert (page["total"], len(page["items"])) == (5, 2)
    assert page["has_more"] is True


def test_the_feed_is_newest_first_and_does_not_repeat(api_client, candidate) -> None:
    """`(created_at DESC, id DESC)` — without the tiebreak, page 2 repeats page 1.

    The ids are collected across both pages and checked for overlap, because
    "newest first" alone passes even when the ordering is unstable.
    """
    for i in range(4):
        publish(api_client, candidate, body=f"Post {i}")
    first = feed(api_client, candidate, limit=2)["items"]
    second = feed(api_client, candidate, limit=2, offset=2)["items"]
    assert len({item["id"] for item in first + second}) == 4


def test_the_last_page_reports_no_more(api_client, candidate) -> None:
    """`has_more` comes from `total`, so a full final page is the last one."""
    for i in range(2):
        publish(api_client, candidate, body=f"Post {i}")
    page = feed(api_client, candidate, limit=2)
    assert (len(page["items"]), page["has_more"]) == (2, False)


def test_the_category_filter_narrows_the_total(api_client, candidate) -> None:
    """The chip count and the rows agree, because one `_feed_filters` builds both."""
    publish(api_client, candidate, category="learning", body="Notes.")
    publish(api_client, candidate, category="community", body="Hello.")
    publish(api_client, candidate, category="community", body="Again.")

    page = feed(api_client, candidate, category="learning")
    assert page["total"] == 1
    assert community_total(api_client, candidate) == 2


def community_total(api_client, account: Account) -> int:
    return feed(api_client, account, category="community")["total"]


def test_mine_returns_only_my_posts(api_client, candidate, other_candidate) -> None:
    """The list behind the client's "My Posts" screen; another author's never appear."""
    publish(api_client, candidate, body="Mine.")
    publish(api_client, other_candidate, body="Theirs.")

    page = feed(api_client, candidate, "/api/v1/posts/mine")
    assert page["total"] == 1
    assert [item["author"]["name"] for item in page["items"]] == [
        candidate.body["name"]
    ]


def test_the_feed_shows_another_authors_post_as_not_self(
    api_client, candidate, other_candidate
) -> None:
    """`is_self` is per-request, so one row renders differently for two readers."""
    created = publish(api_client, candidate, body="Shared.")
    page = feed(api_client, other_candidate)
    assert page["items"][0]["author"]["is_self"] is False
    assert page["items"][0]["id"] == created["id"]


def test_one_stolen_attachment_refuses_the_whole_post(
    api_client, candidate, other_candidate
) -> None:
    """No partial attachment: the failure happens before any row is written."""
    mine = upload_image(api_client, candidate)
    theirs = upload_image(api_client, other_candidate)
    response = api_client.post(
        "/api/v1/posts", json=body(media_ids=[mine, theirs]),
        headers=candidate.headers,
    )
    assert response.status_code == 403, response.text
    assert _rows(api_client) == []
    assert _links(api_client, mine) == []
# --- update (§9.1 "Owner only; {body?, title?}") ------------------------------


def patch(api_client, account: Account, post_id: str, **fields) -> dict:
    response = api_client.patch(
        f"/api/v1/posts/{post_id}", json=fields, headers=account.headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_a_patch_replaces_the_body_and_leaves_the_rest(api_client, candidate) -> None:
    """A patch is not a re-create: the untouched columns must survive it."""
    created = publish(api_client, candidate, title="First", body="Original.")
    updated = patch(api_client, candidate, created["id"], body="Edited.")
    assert updated["body"] == "Edited."
    assert updated["title"] == "First"
    assert updated["id"] == created["id"]


def test_a_title_can_be_cleared_with_an_explicit_null(api_client, candidate) -> None:
    """`model_fields_set` is what makes this possible.

    A blind `if payload.title is not None` would make a title impossible to
    remove, because `null` and "absent" would be indistinguishable.
    """
    created = publish(api_client, candidate, title="First")
    assert patch(api_client, candidate, created["id"], title=None)["title"] is None


def test_a_patch_cannot_change_the_kind(api_client, candidate) -> None:
    """§9.2 reserves derivation for creation, so editing text keeps a project one.

    Re-deriving on update would let a patch rewrite which block the feed renders.
    """
    created = publish(api_client, candidate, body=None, project={"title": "Mahaa"})
    patched = patch(api_client, candidate, created["id"], body="Now with words.")
    assert patched["kind"] == PostKind.PROJECT
    assert patched["project"] == {"title": "Mahaa"}


@pytest.mark.parametrize(
    "payload",
    [
        {"category": "learning"},
        {"media_ids": []},
        {"kind": "text"},
        {"project": {"title": "x"}},
        {"author_id": str(uuid.uuid4())},
        {"tags": ["a"]},
    ],
)
def test_a_patch_refuses_every_field_but_body_and_title(
    api_client, candidate, payload
) -> None:
    """§9.1 says `{body?, title?}`, so `extra="forbid"` is the whole rule."""
    created = publish(api_client, candidate)
    response = api_client.patch(
        f"/api/v1/posts/{created['id']}", json=payload, headers=candidate.headers
    )
    assert response.status_code == 422, (payload, response.text)


def test_a_stranger_cannot_patch_someone_elses_post(
    api_client, candidate, other_candidate
) -> None:
    """404, not 403 — a 403 would confirm the post exists (see `_assert_owner`)."""
    created = publish(api_client, candidate, body="Mine.")
    response = api_client.patch(
        f"/api/v1/posts/{created['id']}",
        json={"body": "Hijacked."},
        headers=other_candidate.headers,
    )
    assert response.status_code == 404, response.text
    assert _rows(api_client)[0].body == "Mine."


def test_patching_a_missing_post_is_404(api_client, candidate) -> None:
    response = api_client.patch(
        f"/api/v1/posts/{NOBODY}", json={"body": "x"}, headers=candidate.headers
    )
    assert response.status_code == 404, response.text


# --- soft delete (§9.3) --------------------------------------------------------


def delete(api_client, account: Account, post_id: str):
    return api_client.delete(f"/api/v1/posts/{post_id}", headers=account.headers)


def test_a_delete_answers_204_with_no_body(api_client, candidate) -> None:
    created = publish(api_client, candidate)
    response = delete(api_client, candidate, created["id"])
    assert response.status_code == 204, response.text
    assert response.content == b""


def test_the_soft_delete_leaves_the_feed_and_the_row(api_client, candidate) -> None:
    """§9.3 wants three faces — gone from both lists and from `/posts/{id}` — and
    the row still there, because "a published post's position and comments survive"."""
    created = publish(api_client, candidate)

    assert delete(api_client, candidate, created["id"]).status_code == 204
    assert feed(api_client, candidate)["total"] == 0
    assert feed(api_client, candidate, "/api/v1/posts/mine")["total"] == 0
    read_back = api_client.get(
        f"/api/v1/posts/{created['id']}", headers=candidate.headers
    )
    assert read_back.status_code == 404, read_back.text

    stored = _rows(api_client)[0]
    assert str(stored.id) == created["id"]
    assert stored.deleted_at is not None


def test_a_soft_deleted_post_leaves_another_authors_feed_too(
    api_client, candidate, other_candidate
) -> None:
    """The tombstone is invisible to everyone; it is not a per-viewer effect."""
    created = publish(api_client, candidate, body="Shared.")
    delete(api_client, candidate, created["id"])
    assert feed(api_client, other_candidate)["total"] == 0


def test_a_deleted_post_cannot_be_patched_or_deleted_again(
    api_client, candidate
) -> None:
    """A second delete is a 404, not an idempotent 204: no delete happened then.

    §18 covers keyed retries and this is not one.
    """
    created = publish(api_client, candidate)
    delete(api_client, candidate, created["id"])
    assert delete(api_client, candidate, created["id"]).status_code == 404
    response = api_client.patch(
        f"/api/v1/posts/{created['id']}",
        json={"body": "Back?"},
        headers=candidate.headers,
    )
    assert response.status_code == 404, response.text


def test_the_attachment_rows_survive_a_soft_delete(api_client, candidate) -> None:
    """The links are what a future undelete or a moderation read would need."""
    media_id = upload_image(api_client, candidate)
    created = publish(api_client, candidate, media_ids=[media_id])
    delete(api_client, candidate, created["id"])
    assert [str(link.media_id) for link in _links(api_client, created["id"])] == [
        media_id
    ]


def test_a_stranger_cannot_delete_someone_elses_post(
    api_client, candidate, other_candidate
) -> None:
    created = publish(api_client, candidate)
    assert delete(api_client, other_candidate, created["id"]).status_code == 404
    assert _rows(api_client)[0].deleted_at is None


# --- media deletion is reference-checked (§14.11) -----------------------------


def drop_asset(api_client, account: Account, media_id: str) -> int:
    """`DELETE /media/{id}` — the route whose reference check §14.11 requires."""
    return api_client.delete(
        f"/api/v1/media/{media_id}", headers=account.headers
    ).status_code


def test_an_asset_used_by_a_live_post_cannot_be_deleted(api_client, candidate) -> None:
    """The Phase 7 guard, now that `post_media` exists to be checked.

    `post_media.media_id` is RESTRICT, so the database refuses too — the service
    check exists to turn that refusal into a 409 the composer can act on rather
    than a 500.
    """
    media_id = upload_image(api_client, candidate)
    publish(api_client, candidate, media_ids=[media_id])

    response = api_client.delete(f"/api/v1/media/{media_id}", headers=candidate.headers)
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "conflict"


def test_an_unused_asset_still_deletes(api_client, candidate) -> None:
    """The guard must not block ordinary deletes, or the composer is unusable."""
    unused = upload_image(api_client, candidate)
    attached = upload_image(api_client, candidate)
    publish(api_client, candidate, media_ids=[attached])

    assert drop_asset(api_client, candidate, unused) == 204
    assert drop_asset(api_client, candidate, attached) == 409


def test_the_guard_follows_the_post_into_the_tombstone(api_client, candidate) -> None:
    """`_live_post_references` joins on `deleted_at IS NULL`.

    A soft-deleted post is not a live reference, so the asset becomes deletable
    again — which is the only way a user can ever reclaim the storage.
    """
    media_id = upload_image(api_client, candidate)
    created = publish(api_client, candidate, media_ids=[media_id])
    assert drop_asset(api_client, candidate, media_id) == 409
    delete(api_client, candidate, created["id"])
    assert drop_asset(api_client, candidate, media_id) == 204


def test_another_authors_post_does_not_pin_your_asset(
    api_client, candidate, other_candidate
) -> None:
    """The check must be scoped to the caller's own live posts.

    An unscoped `SELECT count(*)` here would let one user's post block every
    other user's delete of their own file.
    """
    media_id = upload_image(api_client, candidate)
    response = api_client.post(
        "/api/v1/posts",
        json=body(media_ids=[media_id]),
        headers=other_candidate.headers,
    )
    assert response.status_code == 403, response.text
    assert drop_asset(api_client, candidate, media_id) == 204
# --- the database enforces its half (§14.9) -----------------------------------
#
# The rules above are the service's. These are PostgreSQL's, and they are the ones
# that survive a bug in the service, a second writer, or a future bulk script.


def _user_id(db_session, account: Account):
    return uuid.UUID(str(account.id))


def test_the_database_refuses_a_post_with_no_payload(db_session, candidate) -> None:
    """The CHECK is weaker than §9.3's rule on purpose — see `models/posts.py`.

    It cannot mention `media`, because those rows are written after this one, so a
    post with only an image is legitimately rejected here. The service holds the
    rule §9.3 actually states.
    """
    assert_rejected(
        db_session,
        Post(
            author_id=_user_id(db_session, candidate),
            kind=PostKind.TEXT,
            category=PostCategory.COMMUNITY,
            body=None,
        ),
    )


def test_the_database_refuses_a_category_outside_the_enum(
    db_session, candidate
) -> None:
    """A closed CHECK, so a fifth chip can never be stored behind the client's back."""
    row = Post(
        author_id=_user_id(db_session, candidate),
        kind=PostKind.TEXT,
        category="ramblings",
        body="x",
    )
    assert_rejected(db_session, row)


def test_the_same_position_cannot_be_used_twice(db_session, candidate) -> None:
    """`position` is part of the **primary key**, so a clash is unrepresentable."""
    post = Post(
        author_id=_user_id(db_session, candidate),
        kind=PostKind.TEXT,
        category=PostCategory.COMMUNITY,
        body="x",
    )
    db_session.add(post)
    db_session.flush()
    media_ids = [uuid.uuid4() for _ in range(2)]
    for media_id in media_ids:
        db_session.add(PostMedia(post_id=post.id, media_id=media_id, position=0))
    with pytest.raises(REJECTION_ERRORS):
        with db_session.begin_nested():
            db_session.flush()
    db_session.rollback()


def test_the_post_media_primary_key_is_the_composite_one(db_session) -> None:
    """§14.9: PK ``(post_id, position)``, and **no** surrogate `id` column.

    `UUIDPrimaryKeyMixin` was deliberately dropped for this table; re-adding it
    would make the key ``(id, post_id, position)`` — a key §14.9 never described.
    """
    columns = {c.name for c in PostMedia.__table__.columns}
    assert columns == {"post_id", "media_id", "position", "created_at"}
    primary = [c.name for c in PostMedia.__table__.primary_key]
    assert sorted(primary) == ["position", "post_id"]


def test_the_feed_index_is_partial_on_live_rows(db_session) -> None:
    """The predicate is the whole reason for the index — see `models/posts.py`.

    Without `WHERE deleted_at IS NULL`, the index would carry tombstones and the
    feed's window would have to skip over them at every scan.
    """
    definitions = dict(
        db_session.execute(
            text("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'posts'")
        ).all()
    )
    live = definitions["ix_posts_created_at_id_live"]
    assert "deleted_at IS NULL" in live
    assert "created_at DESC" in live
    assert "id DESC" in live
    assert "ix_posts_author_id_created_at" in definitions


def test_the_media_deletion_reference_guard_is_not_a_cascade(db_session) -> None:
    """`media_id` is RESTRICT: the database must refuse too, not orphan the link."""
    links = {fk.parent.name: fk.ondelete for fk in PostMedia.__table__.foreign_keys}
    assert links == {"post_id": "CASCADE", "media_id": "RESTRICT"}
