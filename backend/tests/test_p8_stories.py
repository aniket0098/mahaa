"""Phase 8 (stories) — §10's routes, expiry, and the idempotent view.

**The mobile client is the contract for these three routes, and it is already
live.** `src/api/stories.ts` calls `GET /stories`, `GET /stories/{id}` and
`POST /stories/{id}/view`, and `src/app/(candidate)/home.tsx` fires the list on the
home screen. So these tests check the *wire* — exact field names, exact envelope —
rather than the Python objects, because a renamed field would pass every ORM-level
assertion and still blank the home screen.

**Expiry is tested at the boundary, not just in the middle.** §10.2 says the list
returns "**active** stories only" and that "the client sends no date filter, so the
server owns the window". A test that only used a story that expired an hour ago
would pass against a server that filtered `expires_at < now() + interval '1 hour'`.
So the interesting cases are one that expires in the near future and one that expired
a moment ago, and the expired one must be invisible to *both* the list and the
detail route — §10.2 wants an expired story indistinguishable from a deleted one.

**The idempotency guarantee is asserted twice: on the response and on the row
count.** §10.2 says re-viewing "returns ``already_recorded: true`` with the original
``viewed_at`` and does not insert a second row", and only checking the flag would
pass against a service that inserted a duplicate every time. The `viewed_at` equality
is the part that makes §18's retry contract hold.

**Rows are inserted through the ORM, not the route, wherever the timestamp is what
is under test.** The published routes always compute `expires_at` from "now", so a
test about expiry has to write the column directly — there is no other way to place a
row on either side of the boundary. The publication route itself is tested
separately, through HTTP.

**The publisher snapshot is asserted field-by-field, and for what it must NOT
contain.** It is a JSONB column read back out on every feed request, so an email or a
token in there would be a real leak. The test names the three allowed keys and then
checks the row's keys are exactly those.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text

from app.models import Story, StoryView
from app.models.enums import (
    StoryContentType,
    StoryPublisherKind,
    StoryStatus,
)
from tests.conftest import Account, assert_rejected
from tests.test_p7_media import png_bytes

#: Nobody's story. Only used where authentication or the id parse is the subject.
NOBODY = str(uuid.UUID(int=0))

STORY_ROUTES = [
    ("get", "/api/v1/stories", None),
    ("post", "/api/v1/stories", {}),
    ("get", f"/api/v1/stories/{NOBODY}", None),
    ("post", f"/api/v1/stories/{NOBODY}/view", None),
    ("delete", f"/api/v1/stories/{NOBODY}", None),
]


# --- helpers ------------------------------------------------------------------


def body(**overrides) -> dict:
    """A minimal valid ``POST /stories`` body — the [F] publication path.

    ``publisher_kind`` is left at its default so the common case does not have to
    spell it out; the tests that care pass it explicitly, including the one that
    asserts a company story is refused.
    """
    payload = {"content_type": "announcement", "caption": "Registration opens Monday."}
    payload.update(overrides)
    return payload


def publish(api_client, account: Account, **overrides) -> dict:
    """``POST /stories`` and assert it was created. Returns the JSON body."""
    response = api_client.post(
        "/api/v1/stories", json=body(**overrides), headers=account.headers
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
    """A real PDF, for the "a document is not story artwork" test."""
    response = api_client.post(
        "/api/v1/media?kind=document",
        content=b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
        headers={**account.headers, "Content-Type": "application/pdf"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _session(api_client):
    """The rolled-back session the TestClient's routes share. See `test_p8_posts`."""
    import app.db.session

    override = api_client.app.dependency_overrides[app.db.session.get_db]
    return next(override())


def seed_story(
    api_client,
    author: Account,
    *,
    caption: str = "A seeded story.",
    content_type: StoryContentType = StoryContentType.ANNOUNCEMENT,
    status: StoryStatus = StoryStatus.PUBLISHED,
    expires_in: timedelta = timedelta(hours=24),
    created_at: datetime | None = None,
    media_id=None,
) -> Story:
    """Write a story straight to the ORM, so `expires_at` and `created_at` are settable.

    The published routes compute the window from "now", which is right for production
    and useless for a test about the boundary: nothing under test can place a row on
    either side of it. Everything *else* still goes through HTTP.
    """
    session = _session(api_client)
    now = datetime.now(UTC)
    story = Story(
        author_id=uuid.UUID(str(author.id)),
        publisher_kind=StoryPublisherKind.PLATFORM,
        publisher={"name": author.body["name"], "logo_url": None, "verified": False},
        content_type=content_type,
        caption=caption,
        media_id=media_id,
        status=status,
        expires_at=now + expires_in,
        created_at=created_at or now,
        updated_at=now,
    )
    session.add(story)
    session.commit()
    session.refresh(story)
    return story


def rows(api_client) -> list[Story]:
    return list(_session(api_client).scalars(select(Story)))


# --- transport: authentication and envelope -----------------------------------


@pytest.mark.parametrize(("method", "path", "payload"), STORY_ROUTES)
def test_every_story_route_needs_a_token(api_client, method, path, payload) -> None:
    """§10.1: a story is visible to "any authenticated candidate" — so signed in.

    §10.2 is explicit that there is no per-viewer ACL in V1, which makes these routes
    about *authentication* and nothing else; a public read would make the whole
    member-visible architecture pointless.
    """
    kwargs = {"json": payload} if payload is not None else {}
    response = getattr(api_client, method)(path, **kwargs)
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "not_authenticated"


def test_a_malformed_story_id_is_a_404_not_a_422(api_client, candidate) -> None:
    """`parse_id` treats a bad id as "no such record" — never a UUID oracle.

    A 422 would confirm the string was *supposed* to be a UUID, which tells a caller
    something a plain 404 does not. Phases 6, 7 and 8-posts all assert this, so
    stories is held to the same bar.
    """
    for raw in ("not-a-uuid", "12345", "null", "0000"):
        response = api_client.get(f"/api/v1/stories/{raw}", headers=candidate.headers)
        assert response.status_code == 404, (raw, response.text)
        assert response.json()["error"]["code"] == "not_found"

        viewed = api_client.post(
            f"/api/v1/stories/{raw}/view", headers=candidate.headers
        )
        assert viewed.status_code == 404, (raw, viewed.text)


def test_an_unknown_story_id_is_a_404(api_client, candidate) -> None:
    """Both [M] reads of a story that does not exist.

    The view route is POST-only, so it is exercised with POST: a `GET` there is a 405
    from the router, which says nothing about the id and is asserted separately.
    """
    response = api_client.get(f"/api/v1/stories/{NOBODY}", headers=candidate.headers)
    assert response.status_code == 404, response.text

    viewed = api_client.post(
        f"/api/v1/stories/{NOBODY}/view", headers=candidate.headers
    )
    assert viewed.status_code == 404, viewed.text


def test_the_view_route_is_post_only(api_client, candidate) -> None:
    """§10.1's method table, asserted rather than assumed.

    A `GET /stories/{id}/view` is a 405, not a story read: recording a view is a
    write, and letting it happen on a read would mark a story viewed because
    somebody prefetched a detail screen.
    """
    response = api_client.get(
        f"/api/v1/stories/{NOBODY}/view", headers=candidate.headers
    )
    assert response.status_code == 405, response.text


def test_the_empty_feed_is_the_fastapi_envelope(api_client, candidate) -> None:
    """`{items, total, page, page_size, pages}` — §17/§25.6's second envelope.

    Asserting the whole object is the point: the client reads `page_size` and `pages`
    off this response, and an offset-shaped envelope would hand it `undefined` for
    both while every ORM-level assertion still passed.
    """
    response = api_client.get("/api/v1/stories", headers=candidate.headers)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 20,
        "pages": 0,
    }


# --- creation (the [F] publication path) ---------------------------------------


def test_a_story_is_created_with_the_servers_publisher(api_client, candidate) -> None:
    """§10.1's shape, field for field, as the client's `mapStory` expects it."""
    created = publish(api_client, candidate)
    assert set(created) == {
        "id",
        "content_type",
        "caption",
        "status",
        "publisher",
        "opportunity",
        "viewed",
        "created_at",
    }
    assert created["publisher"] == {
        "name": candidate.body["name"],
        "logo_url": None,
        "verified": False,
        "kind": "platform",
    }
    assert created["opportunity"] is None
    assert created["viewed"] is False
    assert created["status"] == "published"


def test_the_publisher_payload_holds_only_display_fields(api_client, candidate) -> None:
    """The allow-list is asserted, not assumed.

    `publisher` is JSONB read back out on every feed request, so this is the test
    that says "no email, no role, no id, no credential material". Checking the stored
    row's keys is stronger than checking the response, because the response is built
    by the same code that wrote it.
    """
    publish(api_client, candidate)
    stored = rows(api_client)[0].publisher
    assert set(stored) == {"name", "logo_url", "verified"}
    forbidden = {"email", "id", "role", "password", "password_hash", "token", "phone"}
    assert not (set(stored) & forbidden)


def test_the_publisher_snapshot_survives_a_later_name_change(
    api_client, candidate
) -> None:
    """A snapshot is a snapshot: renaming the account does not rewrite history.

    This is the property that makes storing a payload defensible rather than a
    shortcut, so it is asserted instead of left as a comment.
    """
    created = publish(api_client, candidate)
    renamed = api_client.patch(
        "/api/v1/users/me", json={"name": "Renamed Later"}, headers=candidate.headers
    )
    assert renamed.status_code == 200, renamed.text

    fetched = api_client.get(
        f"/api/v1/stories/{created['id']}", headers=candidate.headers
    ).json()
    assert fetched["publisher"]["name"] == candidate.body["name"]


def test_the_publisher_logo_is_the_served_path(api_client, candidate) -> None:
    """§14.11's relative `served_at`, resolved the way `/users/me` resolves it."""
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
    assert created["publisher"]["logo_url"] == expected
    assert created["publisher"]["logo_url"].startswith("/api/v1/media/")


def test_verified_is_always_false(api_client, candidate) -> None:
    """§9.2's rule applied to publishers: the client renders a badge from this.

    V1 has no publisher verification signal, so `True` would be a false credential
    claim rendered as a badge in a student-facing feed.
    """
    assert publish(api_client, candidate)["publisher"]["verified"] is False


@pytest.mark.parametrize(
    "payload",
    [
        body(content_type="rumour"),
        body(caption=""),
        body(caption="x" * 2001),
        body(expires_in_hours=0),
        body(expires_in_hours=8761),
    ],
)
def test_invalid_input_is_422(api_client, candidate, payload) -> None:
    """§10.1's closed vocabularies and the schema's bounds."""
    response = api_client.post(
        "/api/v1/stories", json=payload, headers=candidate.headers
    )
    assert response.status_code == 422, response.text
    assert rows(api_client) == []


def test_a_supplied_author_or_publisher_is_refused(api_client, candidate) -> None:
    """`extra="forbid"` makes impersonation a parse error, not a silent drop.

    Same argument §9.3 makes for posts: refusing to parse the field at all is
    stronger than ignoring it.
    """
    for field in ("author_id", "publisher", "viewed", "id"):
        response = api_client.post(
            "/api/v1/stories", json=body(**{field: "x"}), headers=candidate.headers
        )
        assert response.status_code == 422, (field, response.text)


def test_a_company_story_is_refused_until_companies_exist(
    api_client, candidate
) -> None:
    """§14.10 wants a company story to always name a real company; Phase 8 cannot.

    Accepting it would store `kind: 'company'` with nothing behind it, and the feed
    renders that badge. Refusing keeps the stored vocabulary honest until the career
    domain lands.
    """
    response = api_client.post(
        "/api/v1/stories",
        json=body(publisher_kind="company"),
        headers=candidate.headers,
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"
    assert rows(api_client) == []


def _window(api_client, account: Account, **overrides) -> timedelta:
    """Publish and return `expires_at` measured against the **application** clock.

    Measuring against the stored `created_at` looks simpler and is wrong: the tests
    run inside one long-lived outer transaction, and PostgreSQL's `now()` is
    `transaction_timestamp()`, frozen at that transaction's start. So a stored
    `created_at` can predate the publish call by however long the test has been
    running, and `expires_at - created_at` then comes out *longer* than the window
    that was requested. Capturing the clock here measures the actual contract —
    "`expires_in_hours` from now" — instead of an artefact of the harness.
    """
    before = datetime.now(UTC)
    created = publish(api_client, account, **overrides)
    after = datetime.now(UTC)
    stored = next(r for r in rows(api_client) if str(r.id) == created["id"])
    # True if `expires_at` was computed from an instant inside [before, after].
    assert (
        before + timedelta(hours=overrides.get("expires_in_hours", 24))
        <= (stored.expires_at)
        <= after + timedelta(hours=overrides.get("expires_in_hours", 24))
    )
    return stored.expires_at - after


def test_the_default_window_is_the_specified_24_hours(api_client, candidate) -> None:
    """§10.2's "`created_at + interval '24h'`" is the window the column defaults to."""
    window = _window(api_client, candidate)
    assert timedelta(hours=23, minutes=59) < window <= timedelta(hours=24)


def test_the_window_is_adjustable_without_a_migration(api_client, candidate) -> None:
    """§10.2's reason for storing `expires_at` instead of deriving it.

    A per-publisher window that could not vary would leave the column decorative and
    the index on it pointless.
    """
    window = _window(api_client, candidate, expires_in_hours=2)
    assert timedelta(hours=1, minutes=59) < window <= timedelta(hours=2)


# --- media integration (Phase 7 reused, never reimplemented) -------------------


def test_a_story_can_carry_its_own_image(api_client, candidate) -> None:
    media_id = upload_image(api_client, candidate)
    publish(api_client, candidate, media_id=media_id)
    assert str(rows(api_client)[0].media_id) == media_id


def test_a_story_may_be_text_only(api_client, candidate) -> None:
    """§10.1 requires a caption, not artwork — an announcement can stand alone."""
    publish(api_client, candidate)
    assert rows(api_client)[0].media_id is None


def test_another_accounts_media_is_403(api_client, candidate, other_candidate) -> None:
    """Phase 7's IDOR rule: the caller named a specific asset and was refused."""
    media_id = upload_image(api_client, other_candidate)
    response = api_client.post(
        "/api/v1/stories", json=body(media_id=media_id), headers=candidate.headers
    )
    assert response.status_code == 403, response.text
    assert rows(api_client) == []


def test_media_that_does_not_exist_is_404(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/stories",
        json=body(media_id=str(uuid.uuid4())),
        headers=candidate.headers,
    )
    assert response.status_code == 404, response.text
    assert rows(api_client) == []


def test_a_document_cannot_be_story_artwork(api_client, candidate) -> None:
    """`POSTABLE_KINDS` is `{image, video}`: a story bubble renders artwork."""
    document_id = upload_document(api_client, candidate)
    response = api_client.post(
        "/api/v1/stories",
        json=body(media_id=document_id),
        headers=candidate.headers,
    )
    assert response.status_code == 422, response.text
    assert rows(api_client) == []


def test_media_used_by_an_active_story_cannot_be_deleted(api_client, candidate) -> None:
    """§14.11's "confirm no live post/**story** references the asset".

    `stories.media_id` is RESTRICT, so the database refuses too; the service check
    exists to turn that refusal into a 409 the caller can act on rather than a 500.
    """
    media_id = upload_image(api_client, candidate)
    publish(api_client, candidate, media_id=media_id)

    response = api_client.delete(f"/api/v1/media/{media_id}", headers=candidate.headers)
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "conflict"


def test_an_expired_story_stops_pinning_its_media(api_client, candidate) -> None:
    """The check and the RESTRICT FK must agree, or storage is stranded forever.

    An expired story is invisible, so its artwork is unreachable; `_detach_inactive_
    stories` clears the FK and the bytes are reclaimable. Without it this is a 500 —
    the same failure mode `_tombstoned_links` fixes for posts.
    """
    media_id = upload_image(api_client, candidate)
    seed_story(api_client, candidate, media_id=media_id, expires_in=timedelta(hours=-1))

    response = api_client.delete(f"/api/v1/media/{media_id}", headers=candidate.headers)
    assert response.status_code == 204, response.text


def test_another_storys_media_does_not_pin_yours(
    api_client, candidate, other_candidate
) -> None:
    """The check is scoped to the caller's own rows.

    An unscoped ``SELECT count(*)`` here would let one publisher's story block
    everybody's delete of their own file.
    """
    media_id = upload_image(api_client, candidate)
    response = api_client.post(
        "/api/v1/stories",
        json=body(media_id=media_id),
        headers=other_candidate.headers,
    )
    assert response.status_code == 403, response.text
    assert (
        api_client.delete(
            f"/api/v1/media/{media_id}", headers=candidate.headers
        ).status_code
        == 204
    )


# --- expiry (§10.2) ------------------------------------------------------------


def feed(api_client, account: Account, **params) -> dict:
    response = api_client.get("/api/v1/stories", headers=account.headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_the_feed_returns_only_active_stories(api_client, candidate) -> None:
    """§10.2: "``GET /stories`` returns **active** stories only".

    All three shapes of inactive row are in one test because the specification names
    two independent reasons a story is not active — the window closed, or the
    publisher withdrew it — and a feed filtering only on expiry would keep serving an
    archived story.
    """
    live = seed_story(api_client, candidate, caption="Live.")
    seed_story(
        api_client, candidate, caption="Expired.", expires_in=timedelta(hours=-1)
    )
    seed_story(
        api_client, candidate, caption="Just expired.", expires_in=timedelta(seconds=-1)
    )
    seed_story(api_client, candidate, caption="Archived.", status=StoryStatus.ARCHIVED)

    page = feed(api_client, candidate)
    assert page["total"] == 1
    assert [item["id"] for item in page["items"]] == [str(live.id)]


def test_an_expired_story_is_a_404_on_the_detail_route(api_client, candidate) -> None:
    """§10.2 wants an expired story indistinguishable from a deleted one."""
    story = seed_story(api_client, candidate, expires_in=timedelta(hours=-1))
    response = api_client.get(f"/api/v1/stories/{story.id}", headers=candidate.headers)
    assert response.status_code == 404, response.text


def test_an_archived_story_is_a_404_on_the_detail_route(api_client, candidate) -> None:
    story = seed_story(api_client, candidate, status=StoryStatus.ARCHIVED)
    response = api_client.get(f"/api/v1/stories/{story.id}", headers=candidate.headers)
    assert response.status_code == 404, response.text


def test_an_expired_story_still_has_its_row(api_client, candidate) -> None:
    """Expiry is a **query-time** filter, not a deletion — §10.2 asks for no sweeper.

    A story nobody can see is indistinguishable from one that was deleted, so there
    is nothing to gain from deleting it, and §10.2's retention job is explicitly a
    separate, later concern.
    """
    story = seed_story(api_client, candidate, expires_in=timedelta(hours=-1))
    assert [str(row.id) for row in rows(api_client)] == [str(story.id)]


def test_the_expiry_boundary_is_exclusive(api_client, candidate) -> None:
    """`expires_at > now()` — §10.2's exact predicate.

    A story whose window has *just* closed is already gone, so `<` instead of `<=`
    would keep serving it for one extra instant.
    """
    seed_story(api_client, candidate, caption="Gone.", expires_in=timedelta(seconds=-1))
    assert feed(api_client, candidate)["total"] == 0


def test_an_expiry_in_the_future_is_still_visible(api_client, candidate) -> None:
    """The other side of the boundary."""
    seed_story(
        api_client, candidate, caption="Almost gone.", expires_in=timedelta(days=1)
    )
    assert feed(api_client, candidate)["total"] == 1


# --- the feed: ordering, visibility, pagination --------------------------------


def test_the_feed_is_newest_first_and_never_repeats(api_client, candidate) -> None:
    """`(created_at DESC, id DESC)` — the total order an offset feed needs.

    The ids are collected across both pages and checked for overlap, because
    "newest first" alone passes even when the ordering is unstable.
    """
    base = datetime.now(UTC)
    for i in range(4):
        seed_story(
            api_client,
            candidate,
            caption=f"Story {i}",
            created_at=base - timedelta(minutes=i),
        )

    first = feed(api_client, candidate, page=1, page_size=2)["items"]
    second = feed(api_client, candidate, page=2, page_size=2)["items"]
    assert [item["caption"] for item in first] == ["Story 0", "Story 1"]
    assert len({item["id"] for item in first + second}) == 4


def test_total_is_a_real_count_not_the_page_length(api_client, candidate) -> None:
    """`pages` comes from the unfiltered total, or the pager lies."""
    for i in range(5):
        seed_story(api_client, candidate, caption=f"Story {i}")

    page = feed(api_client, candidate, page_size=2)
    assert (page["total"], len(page["items"])) == (5, 2)
    assert page["pages"] == 3


def test_the_last_page_reports_the_real_page_count(api_client, candidate) -> None:
    """`ceil(total / page_size)`, so a full final page is the last one."""
    for i in range(4):
        seed_story(api_client, candidate, caption=f"Story {i}")

    last = feed(api_client, candidate, page=2, page_size=2)
    assert (len(last["items"]), last["page"], last["pages"]) == (2, 2, 2)


def test_a_page_past_the_end_is_empty_not_an_error(api_client, candidate) -> None:
    """A pager that overshoots must not 404 — the client scrolls past the end."""
    seed_story(api_client, candidate)
    page = feed(api_client, candidate, page=99, page_size=20)
    assert page["items"] == []
    assert page["total"] == 1
    assert page["pages"] == 1


def test_an_expired_story_does_not_inflate_the_total(api_client, candidate) -> None:
    """The COUNT shares the active filter, so `total` and `pages` cannot disagree."""
    seed_story(api_client, candidate, caption="Live.")
    seed_story(
        api_client, candidate, caption="Expired.", expires_in=timedelta(hours=-1)
    )
    page = feed(api_client, candidate, page_size=1)
    assert (page["total"], page["pages"], len(page["items"])) == (1, 1, 1)


def test_every_authenticated_account_sees_the_same_feed(
    api_client, candidate, other_candidate
) -> None:
    """§10.1: a story is visible to any authenticated candidate, no ACL in V1."""
    seed_story(api_client, candidate, caption="Shared.")
    mine = feed(api_client, candidate)["items"][0]
    theirs = feed(api_client, other_candidate)["items"][0]

    assert mine["id"] == theirs["id"]
    assert mine["caption"] == theirs["caption"]
    assert mine["viewed"] is False and theirs["viewed"] is False


def test_viewed_is_per_viewer_not_per_story(
    api_client, candidate, other_candidate
) -> None:
    """§10.1 returns `viewed` "so the ring can render without a second request",
    which is only useful if it reflects *this* viewer."""
    story = seed_story(api_client, candidate, caption="Shared.")
    api_client.post(f"/api/v1/stories/{story.id}/view", headers=candidate.headers)

    assert feed(api_client, candidate)["items"][0]["viewed"] is True
    assert feed(api_client, other_candidate)["items"][0]["viewed"] is False


# --- views (§10.2's idempotency) -----------------------------------------------


def view(api_client, account: Account, story_id) -> dict:
    response = api_client.post(
        f"/api/v1/stories/{story_id}/view", headers=account.headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def view_rows(api_client) -> list[StoryView]:
    return list(_session(api_client).scalars(select(StoryView)))


def test_the_first_view_is_recorded(api_client, candidate) -> None:
    """§10.1's four fields, and the flag that distinguishes a first view."""
    story = seed_story(api_client, candidate)
    result = view(api_client, candidate, story.id)
    assert set(result) == {"story_id", "viewed", "already_recorded", "viewed_at"}
    assert result["story_id"] == str(story.id)
    assert result["viewed"] is True
    assert result["already_recorded"] is False


def test_a_second_view_is_idempotent(api_client, candidate) -> None:
    """§10.2: "does not insert a second row", asserted on the row count too.

    Checking only `already_recorded` would pass against a service that reported the
    flag honestly and inserted a duplicate anyway, so the count is the real proof.
    """
    story = seed_story(api_client, candidate)
    first = view(api_client, candidate, story.id)
    second = view(api_client, candidate, story.id)

    assert second["already_recorded"] is True
    # §10.2 requires "the original `viewed_at`" on a repeat.
    assert second["viewed_at"] == first["viewed_at"]
    assert second["viewed"] is True
    assert len(view_rows(api_client)) == 1


def test_three_views_still_leave_one_row(api_client, candidate) -> None:
    """§18's keyed-retry contract, exercised more than twice."""
    story = seed_story(api_client, candidate)
    results = [view(api_client, candidate, story.id) for _ in range(3)]
    assert [r["already_recorded"] for r in results] == [False, True, True]
    assert len({r["viewed_at"] for r in results}) == 1


def test_a_view_cannot_be_forged_for_another_viewer(api_client, candidate) -> None:
    """The viewer is the authenticated principal, never a request field.

    There is no `viewer_id` in the route's inputs at all, which is the strongest
    form of that rule — there is nothing for a caller to tamper with.
    """
    story = seed_story(api_client, candidate)
    response = api_client.post(
        f"/api/v1/stories/{story.id}/view",
        json={"viewer_id": str(uuid.uuid4())},
        headers=candidate.headers,
    )
    assert response.status_code in (200, 422), response.text
    assert [str(r.viewer_id) for r in view_rows(api_client)] == [str(candidate.id)]


def test_two_viewers_each_get_their_own_row(
    api_client, candidate, other_candidate
) -> None:
    """The PK is `(story_id, viewer_id)`, so a second viewer is a second row."""
    story = seed_story(api_client, candidate)
    view(api_client, candidate, story.id)
    assert view(api_client, other_candidate, story.id)["already_recorded"] is False

    assert sorted(str(r.viewer_id) for r in view_rows(api_client)) == sorted(
        [str(candidate.id), str(other_candidate.id)]
    )


def test_viewing_an_expired_story_is_404_and_writes_nothing(
    api_client, candidate
) -> None:
    """No view row can exist for a story the viewer was never shown."""
    story = seed_story(api_client, candidate, expires_in=timedelta(hours=-1))
    response = api_client.post(
        f"/api/v1/stories/{story.id}/view", headers=candidate.headers
    )
    assert response.status_code == 404, response.text
    assert view_rows(api_client) == []


def test_viewing_an_archived_story_is_404(api_client, candidate) -> None:
    story = seed_story(api_client, candidate, status=StoryStatus.ARCHIVED)
    response = api_client.post(
        f"/api/v1/stories/{story.id}/view", headers=candidate.headers
    )
    assert response.status_code == 404, response.text


# --- deletion ([F] in §10.1) ---------------------------------------------------


def drop(api_client, account: Account, story_id):
    return api_client.delete(f"/api/v1/stories/{story_id}", headers=account.headers)


def test_the_publisher_can_delete_their_story(api_client, candidate) -> None:
    story = seed_story(api_client, candidate)
    response = drop(api_client, candidate, story.id)
    assert response.status_code == 204, response.text
    assert response.content == b""
    assert rows(api_client) == []


def test_a_delete_is_hard_and_cascades_its_views(api_client, candidate) -> None:
    """§10.2: "Deleting a story cascades its views."

    And it is a **hard** delete, unlike posts: §14.10 lists no `deleted_at` on
    `stories`, so there is no tombstone to leave behind.
    """
    story = seed_story(api_client, candidate)
    view(api_client, candidate, story.id)
    assert len(view_rows(api_client)) == 1

    drop(api_client, candidate, story.id)
    assert rows(api_client) == []
    assert view_rows(api_client) == []


def test_a_stranger_cannot_delete_a_story(
    api_client, candidate, other_candidate
) -> None:
    """404, not 403: a 403 would confirm the story exists."""
    story = seed_story(api_client, candidate)
    assert drop(api_client, other_candidate, story.id).status_code == 404
    assert [str(row.id) for row in rows(api_client)] == [str(story.id)]


def test_deleting_twice_is_404(api_client, candidate) -> None:
    """§18 covers keyed retries and this is not one, so no idempotent 204."""
    story = seed_story(api_client, candidate)
    assert drop(api_client, candidate, story.id).status_code == 204
    assert drop(api_client, candidate, story.id).status_code == 404
    assert drop(api_client, candidate, "not-a-uuid").status_code == 404


# --- the database enforces its half (§14.10) -----------------------------------
#
# The rules above are the service's. These are PostgreSQL's, and they are the ones
# that survive a bug in the service, a second writer, or a bulk script.


def test_the_story_views_primary_key_is_the_composite_one(db_session) -> None:
    """§14.10: PK ``(story_id, viewer_id)``, and **no** surrogate ``id``.

    ``UUIDPrimaryKeyMixin`` was deliberately dropped for this table; re-adding it
    would make the key ``(id, story_id, viewer_id)`` — three columns for a row whose
    identity is fully described by who viewed what.
    """
    columns = {c.name for c in StoryView.__table__.columns}
    assert columns == {"story_id", "viewer_id", "viewed_at"}
    assert sorted(c.name for c in StoryView.__table__.primary_key) == [
        "story_id",
        "viewer_id",
    ]


def test_the_same_pair_cannot_be_viewed_twice(db_session, candidate) -> None:
    """The PK is the idempotency guarantee, enforced by the database itself."""
    story = Story(
        author_id=uuid.UUID(str(candidate.id)),
        publisher_kind=StoryPublisherKind.PLATFORM,
        publisher={"name": "x", "logo_url": None, "verified": False},
        content_type=StoryContentType.ANNOUNCEMENT,
        caption="x",
        status=StoryStatus.PUBLISHED,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db_session.add(story)
    db_session.flush()

    viewer_id = uuid.UUID(str(candidate.id))
    db_session.add(StoryView(story_id=story.id, viewer_id=viewer_id))
    db_session.flush()
    assert_rejected(db_session, StoryView(story_id=story.id, viewer_id=viewer_id))


def test_the_database_refuses_a_blank_caption(db_session, candidate) -> None:
    """§14.10 says `caption NOT NULL`; whitespace is not a caption a reader can see."""
    assert_rejected(
        db_session,
        Story(
            author_id=uuid.UUID(str(candidate.id)),
            publisher_kind=StoryPublisherKind.PLATFORM,
            publisher={"name": "x", "logo_url": None, "verified": False},
            content_type=StoryContentType.ANNOUNCEMENT,
            caption="   ",
            status=StoryStatus.PUBLISHED,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        ),
    )


def test_the_database_refuses_a_value_outside_each_enum(db_session, candidate) -> None:
    """The three closed vocabularies are CHECKs, not service conventions.

    Each case needs its own transaction: the first rejection happens as a
    ``LookupError`` raised by SQLAlchemy's enum binding *before* the flush, which
    leaves the session in ``PendingRollbackError``. That is still the vocabulary being
    enforced — just one layer above the CHECK — so the assertion is that a value
    outside the registry cannot be stored, by whichever layer refuses it.
    """
    for column, bad in (
        ("publisher_kind", "recruiter"),
        ("content_type", "rumour"),
        ("status", "deleted"),
    ):
        row = Story(
            author_id=uuid.UUID(str(candidate.id)),
            publisher_kind=StoryPublisherKind.PLATFORM,
            publisher={"name": "x", "logo_url": None, "verified": False},
            content_type=StoryContentType.ANNOUNCEMENT,
            caption="x",
            status=StoryStatus.PUBLISHED,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        setattr(row, column, bad)
        assert_rejected(db_session, row)
        db_session.rollback()


def test_both_expiry_indexes_exist(db_session) -> None:
    """§14.10 names ``(expires_at)`` and ``(expires_at, created_at DESC)``.

    They are not interchangeable: the first serves the ``expires_at > now()`` filter
    alone, and the second is the composite the feed's ordering is derived from.
    """
    definitions = dict(
        db_session.execute(
            text(
                "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'stories'"
            )
        ).all()
    )
    assert "ix_stories_expires_at" in definitions
    composite = definitions["ix_stories_expires_at_created_at"]
    assert "expires_at" in composite
    assert "created_at DESC" in composite


def test_the_media_foreign_key_is_restrict(db_session) -> None:
    """§14.10: `media_id` FK media_assets **RESTRICT**, as `post_media.media_id` is.

    CASCADE here would let a media delete silently strip the artwork off a live story.
    """
    links = {fk.parent.name: fk.ondelete for fk in Story.__table__.foreign_keys}
    assert links["media_id"] == "RESTRICT"
    assert links["author_id"] == "CASCADE"


def test_a_story_and_its_views_go_when_the_account_does(db_session, candidate) -> None:
    """`author_id` is CASCADE and `story_views.viewer_id` is CASCADE (§14.10).

    Asserted by observing the rows actually disappear, not by re-inserting the story
    afterwards — the rollback in the earlier version of this test undid the delete
    and therefore proved nothing.
    """
    story = Story(
        author_id=uuid.UUID(str(candidate.id)),
        publisher_kind=StoryPublisherKind.PLATFORM,
        publisher={"name": "x", "logo_url": None, "verified": False},
        content_type=StoryContentType.ANNOUNCEMENT,
        caption="x",
        status=StoryStatus.PUBLISHED,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db_session.add(story)
    db_session.flush()
    db_session.add(StoryView(story_id=story.id, viewer_id=uuid.UUID(str(candidate.id))))
    db_session.flush()
    assert db_session.scalar(select(func.count()).select_from(StoryView)) == 1

    db_session.execute(
        text("DELETE FROM users WHERE id = :uid"), {"uid": uuid.UUID(str(candidate.id))}
    )

    assert db_session.scalar(select(func.count()).select_from(Story)) == 0
    assert db_session.scalar(select(func.count()).select_from(StoryView)) == 0
    db_session.rollback()


def test_deleting_a_missing_story_is_404(api_client, candidate) -> None:
    assert drop(api_client, candidate, NOBODY).status_code == 404
    assert drop(api_client, candidate, "not-a-uuid").status_code == 404
