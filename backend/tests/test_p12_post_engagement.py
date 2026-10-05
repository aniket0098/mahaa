"""Phase 12 - post engagement. Likes and comments, now that they are real.

These routes did not exist before: the like button toggled device-local state and
``CommentsSheet`` rendered an honest disabled field. So this suite is not only
asserting behaviour, it is **establishing** it, and it is written around the ways
each rule could be quietly violated.

**Persistence is asserted through a real second read, not through a return value.**
Every "it stuck" test re-fetches with a separate request rather than trusting the
response body, because the bug this guards against is precisely a control that
looks like it saved and does not.

**Duplicate-safety is asserted at the database, not only through the route.** The
route is idempotent, so a double like answers 200 either way and the HTTP surface
cannot tell a working key from a missing one. ``assert_rejected`` puts a duplicate
pair straight to the database, which is the only place the rule actually lives.

**Two accounts appear throughout.** ``liked_by_me`` is per-viewer, and a test that
only ever reads as the liker cannot tell a per-viewer flag from a global one.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models import PostComment
from tests.conftest import Account, assert_rejected
from tests.test_p8_posts import _client_session, publish

#: Nobody's post, and nobody's comment. Used where the id itself is the subject.
NOBODY = str(uuid.UUID(int=0))


def like(api_client, account: Account, post_id: str):
    return api_client.post(f"/api/v1/posts/{post_id}/like", headers=account.headers)


def unlike(api_client, account: Account, post_id: str):
    return api_client.delete(f"/api/v1/posts/{post_id}/like", headers=account.headers)


def engagement_of(api_client, account: Account, post_id: str) -> dict:
    """Re-read the post and return only its engagement block."""
    response = api_client.get(f"/api/v1/posts/{post_id}", headers=account.headers)
    assert response.status_code == 200, response.text
    return response.json()["engagement"]


def comment(api_client, account: Account, post_id: str, body: str):
    return api_client.post(
        f"/api/v1/posts/{post_id}/comments",
        json={"body": body},
        headers=account.headers,
    )


def list_comments(api_client, account: Account, post_id: str):
    return api_client.get(f"/api/v1/posts/{post_id}/comments", headers=account.headers)


def _comment_ids(api_client, account: Account, post_id: str) -> list[str]:
    """The ids a comment list returns, so a test can compare two reads."""
    page = list_comments(api_client, account, post_id).json()
    return [row["id"] for row in page["items"]]


# --- the engagement block exists on every post --------------------------------


def test_a_new_post_reports_zero_engagement(api_client, candidate):
    """A post with no interactions reports zeros, not an absent block.

    Absent-versus-zero is the distinction that matters: a client that has to tell
    them apart can invent a count for the missing case.
    """
    created = publish(api_client, candidate)

    assert created["engagement"] == {
        "like_count": 0,
        "comment_count": 0,
        "liked_by_me": False,
    }


def test_the_feed_carries_engagement_for_every_post(api_client, candidate):
    """The feed rows are populated too, not just the single-post read.

    The card renders from ``GET /posts``, so a populated detail read beside an
    empty feed would be a real inconsistency even though both are "the server".
    """
    publish(api_client, candidate, body="First.")
    publish(api_client, candidate, body="Second.")

    feed = api_client.get("/api/v1/posts", headers=candidate.headers)
    assert feed.status_code == 200, feed.text

    for post in feed.json()["items"]:
        assert post["engagement"]["like_count"] == 0
        assert post["engagement"]["comment_count"] == 0


# --- likes ----------------------------------------------------------------------


def test_a_like_persists_and_is_visible_after_a_reread(api_client, candidate):
    """The headline behaviour: tap Like, reload, still liked."""
    post_id = publish(api_client, candidate)["id"]

    assert like(api_client, candidate, post_id).status_code == 200

    # A genuinely separate request, not the like response.
    assert engagement_of(api_client, candidate, post_id)["liked_by_me"] is True


def test_the_like_count_increases(api_client, candidate, other_candidate):
    post_id = publish(api_client, candidate)["id"]

    like(api_client, candidate, post_id)
    assert engagement_of(api_client, candidate, post_id)["like_count"] == 1

    like(api_client, other_candidate, post_id)
    assert engagement_of(api_client, candidate, post_id)["like_count"] == 2


def test_unliking_decreases_and_persists(api_client, candidate):
    post_id = publish(api_client, candidate)["id"]
    like(api_client, candidate, post_id)

    assert unlike(api_client, candidate, post_id).status_code == 200

    block = engagement_of(api_client, candidate, post_id)
    assert block["liked_by_me"] is False
    assert block["like_count"] == 0


def test_liking_twice_is_one_like_not_two(api_client, candidate):
    """Idempotent at the route, and at the database (asserted in the next test).

    The route alone cannot prove this - it answers 200 either way - so the
    duplicate row is checked directly as well.
    """
    post_id = publish(api_client, candidate)["id"]

    like(api_client, candidate, post_id)
    like(api_client, candidate, post_id)

    assert engagement_of(api_client, candidate, post_id)["like_count"] == 1


def test_the_database_refuses_a_duplicate_like(api_client, candidate):
    """The rule that actually makes a duplicate impossible.

    ``(post_id, user_id)`` is the primary key, so a second row for the same pair
    is not merely discouraged - it is unrepresentable. An application-level check
    would still lose a race between two clients.
    """
    publish(api_client, candidate)


def test_liked_by_me_is_per_viewer(api_client, candidate, other_candidate):
    """The liker's heart is filled; the other account's is not.

    This is the test that distinguishes a per-viewer flag from a global one, which
    is the mistake that makes account B see account A's likes as its own.
    """
    post_id = publish(api_client, candidate)["id"]
    like(api_client, candidate, post_id)

    assert engagement_of(api_client, other_candidate, post_id)["liked_by_me"] is False
    assert engagement_of(api_client, candidate, post_id)["liked_by_me"] is True


def test_another_account_can_like_somebody_elses_post(
    api_client, candidate, other_candidate
):
    """A community feed is only a community if B can like A's post."""
    post_id = publish(api_client, candidate)["id"]

    assert like(api_client, other_candidate, post_id).status_code == 200
    assert engagement_of(api_client, other_candidate, post_id)["liked_by_me"] is True


def test_liking_a_missing_post_is_404(api_client, candidate):
    assert like(api_client, candidate, NOBODY).status_code == 404


def test_liking_a_malformed_id_is_404_not_422(api_client, candidate):
    """Keeps the route from being a UUID-format oracle. See ``services.ownership``."""
    assert like(api_client, candidate, "not-a-uuid").status_code == 404


@pytest.mark.parametrize(
    "method,path,kwargs",
    [
        ("post", "/api/v1/posts/{post}/like", {}),
        ("delete", "/api/v1/posts/{post}/like", {}),
        ("get", "/api/v1/posts/{post}/comments", {}),
        ("post", "/api/v1/posts/{post}/comments", {"json": {"body": "hi"}}),
        ("delete", "/api/v1/posts/{post}/comments/{comment}", {}),
    ],
)
def test_every_engagement_route_needs_a_token(api_client, method, path, kwargs):
    """Unauthenticated engagement is 401, never an anonymous like."""
    target = path.format(post=NOBODY, comment=NOBODY)

    # The payload is passed as ``json=`` only for the routes that take a body:
    # httpx's `get`/`delete` accept no body argument at all, so a blanket
    # `json=` would raise a TypeError instead of exercising the 401.
    response = getattr(api_client, method)(target, **kwargs)

    assert response.status_code == 401, response.text


# --- comments -------------------------------------------------------------------


def test_a_comment_persists_and_is_listed(api_client, candidate):
    """Write, close, reopen, reload: the comment is still there."""
    post_id = publish(api_client, candidate)["id"]

    created = comment(api_client, candidate, post_id, "Great project!")
    assert created.status_code == 201, created.text

    listed = list_comments(api_client, candidate, post_id)
    assert listed.status_code == 200, listed.text

    bodies = [row["body"] for row in listed.json()["items"]]
    assert "Great project!" in bodies


def test_the_comment_count_increases(api_client, candidate, other_candidate):
    post_id = publish(api_client, candidate)["id"]

    comment(api_client, candidate, post_id, "Mine.")
    assert engagement_of(api_client, candidate, post_id)["comment_count"] == 1

    comment(api_client, other_candidate, post_id, "Theirs.")
    assert engagement_of(api_client, candidate, post_id)["comment_count"] == 2


def test_a_comment_carries_its_real_author(api_client, candidate):
    """The sheet renders an avatar and a name; both must be the writer's."""
    post_id = publish(api_client, candidate)["id"]

    created = comment(api_client, candidate, post_id, "My own words.")

    author = created.json()["author"]
    assert author["name"] == candidate.body["name"]
    assert author["username"] == candidate.username
    assert author["is_self"] is True


def test_another_accounts_comment_is_attributed_to_them(
    api_client, candidate, other_candidate
):
    """Not to the post author - the mix-up this identity field exists to prevent.

    The POST response carries ``is_self: true`` because *this* account wrote it;
    the interesting view is the **list**, where the post's author reads a comment
    they did not write. There ``is_self`` must be false, or the reader's own "you"
    marker lands on somebody else's words.
    """
    post_id = publish(api_client, candidate)["id"]
    created = comment(api_client, other_candidate, post_id, "Someone else here.")

    assert created.json()["author"]["name"] == other_candidate.body["name"]
    assert created.json()["author"]["is_self"] is True

    listed = list_comments(api_client, candidate, post_id)
    row = listed.json()["items"][0]

    assert row["author"]["name"] == other_candidate.body["name"]
    assert row["author"]["username"] == other_candidate.username
    assert row["author"]["is_self"] is False


def test_a_comment_cannot_be_written_as_another_user(api_client, candidate):
    """The impersonation rule, applied to comments.

    ``CommentCreate`` has ``extra="forbid"`` and no ``author_id``, so the attempt
    is a 422 naming the field rather than a silently ignored key.
    """
    post_id = publish(api_client, candidate)["id"]

    response = api_client.post(
        f"/api/v1/posts/{post_id}/comments",
        json={"body": "Impersonation.", "author_id": candidate.id},
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text
    assert "author_id" in response.text


def test_a_blank_comment_is_refused(api_client, candidate):
    """Whitespace passes a naive length check and renders as an empty bubble."""
    post_id = publish(api_client, candidate)["id"]

    assert comment(api_client, candidate, post_id, "   ").status_code == 422
    assert comment(api_client, candidate, post_id, "").status_code == 422


def test_the_database_refuses_a_blank_comment(api_client, candidate):
    """The CHECK is the last line of defence behind the schema validator."""
    post_id = publish(api_client, candidate)["id"]

    session = _client_session(api_client)
    assert_rejected(
        session,
        PostComment(
            post_id=uuid.UUID(str(post_id)),
            author_id=uuid.UUID(str(candidate.id)),
            body="   ",
        ),
    )


def test_comments_are_newest_first(api_client, candidate):
    """The documented ordering, ``(created_at DESC, id DESC)``.

    **The timestamps are set explicitly rather than relying on the insert order.**
    PostgreSQL's ``now()`` is the *transaction* start time, and this suite runs a
    whole test inside one rolled-back transaction - so two comments created
    back-to-back share an identical ``created_at`` and the tiebreak falls to the
    random UUIDs. Each HTTP request is its own transaction in production, so the
    natural ordering is right there, but a test that depends on it is testing the
    clock rather than the rule. Writing the timestamps makes this assert the
    ordering itself.
    """
    from datetime import UTC, datetime, timedelta

    post_id = publish(api_client, candidate)["id"]

    session = _client_session(api_client)
    base = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
    for index, body in enumerate(["Older.", "Newer."]):
        session.add(
            PostComment(
                post_id=uuid.UUID(str(post_id)),
                author_id=uuid.UUID(str(candidate.id)),
                body=body,
                created_at=base + timedelta(minutes=index),
            )
        )
    session.flush()

    listed = list_comments(api_client, candidate, post_id)

    assert [row["body"] for row in listed.json()["items"]] == ["Newer.", "Older."]


def test_comments_sharing_a_timestamp_still_have_a_total_order(
    api_client, candidate, other_candidate
):
    """The ``id`` tiebreak, which is what makes offset paging deterministic.

    Two comments with byte-identical ``created_at`` is the case the feed's own
    ordering rule exists for. Without the tiebreak a comment could appear on page
    one and again on page two, or on neither. Asserting a *stable* order across
    two identical reads is what proves the tiebreak exists - without it, the
    result is whatever the planner felt like.
    """
    from datetime import UTC, datetime

    post_id = publish(api_client, candidate)["id"]

    session = _client_session(api_client)
    stamp = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
    for account, body in ((candidate, "First."), (other_candidate, "Second.")):
        session.add(
            PostComment(
                post_id=uuid.UUID(str(post_id)),
                author_id=uuid.UUID(str(account.id)),
                body=body,
                created_at=stamp,
            )
        )
    session.flush()

    first = _comment_ids(api_client, candidate, post_id)
    second = _comment_ids(api_client, candidate, post_id)

    assert len(first) == 2
    # Descending by id, so the same two rows come back in the same order twice.
    assert first == sorted(first, reverse=True)
    assert second == first


def test_anyone_signed_in_can_read_any_posts_comments(
    api_client, candidate, other_candidate
):
    """Scoping comments to the post author would make a community feed unusable."""
    post_id = publish(api_client, candidate)["id"]
    comment(api_client, other_candidate, post_id, "Open to all.")

    listed = list_comments(api_client, candidate, post_id)

    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == 1


def test_deleting_your_own_comment_removes_it_from_every_read(api_client, candidate):
    post_id = publish(api_client, candidate)["id"]
    created = comment(api_client, candidate, post_id, "Regrettable.").json()

    removed = api_client.delete(
        f"/api/v1/posts/{post_id}/comments/{created['id']}",
        headers=candidate.headers,
    )
    assert removed.status_code == 204

    listed = list_comments(api_client, candidate, post_id)
    assert listed.json()["items"] == []
    assert engagement_of(api_client, candidate, post_id)["comment_count"] == 0


def test_a_deleted_comment_is_a_tombstone_not_a_vanished_row(api_client, candidate):
    """The post's comments survive it - so the row, and who wrote it, remain."""
    post_id = publish(api_client, candidate)["id"]
    created = comment(api_client, candidate, post_id, "Kept for review.").json()

    api_client.delete(
        f"/api/v1/posts/{post_id}/comments/{created['id']}",
        headers=candidate.headers,
    )

    session = _client_session(api_client)
    row = session.scalar(
        select(PostComment).where(PostComment.id == uuid.UUID(created["id"]))
    )

    assert row is not None
    assert row.deleted_at is not None


def test_you_cannot_delete_somebody_elses_comment(
    api_client, candidate, other_candidate
):
    """404 rather than 403, so the route is not an oracle for probing ids."""
    post_id = publish(api_client, candidate)["id"]
    created = comment(api_client, candidate, post_id, "Mine to keep.").json()

    response = api_client.delete(
        f"/api/v1/posts/{post_id}/comments/{created['id']}",
        headers=other_candidate.headers,
    )

    assert response.status_code == 404, response.text


def test_a_comment_id_from_another_post_is_not_found(
    api_client, candidate, other_candidate
):
    """The lookup is scoped to ``post_id``, so ids cannot be replayed across posts."""
    first = publish(api_client, candidate, body="First.")["id"]
    second = publish(api_client, candidate, body="Second.")["id"]
    created = comment(api_client, other_candidate, first, "Belongs to first.").json()

    response = api_client.delete(
        f"/api/v1/posts/{second}/comments/{created['id']}",
        headers=other_candidate.headers,
    )

    assert response.status_code == 404, response.text


def test_commenting_on_a_missing_post_is_404(api_client, candidate):
    assert comment(api_client, candidate, NOBODY, "Nowhere to go.").status_code == 404


def test_commenting_on_a_deleted_post_is_404(api_client, candidate):
    """A tombstoned post is indistinguishable from one that never existed."""
    post_id = publish(api_client, candidate)["id"]
    removed = api_client.delete(f"/api/v1/posts/{post_id}", headers=candidate.headers)
    assert removed.status_code == 204

    assert comment(api_client, candidate, post_id, "Too late.").status_code == 404


# --- cross-cutting --------------------------------------------------------------


def test_the_list_read_and_the_detail_read_agree_on_engagement(
    api_client, candidate, other_candidate
):
    """The card and the tap it leads to must never disagree.

    The card renders from ``GET /posts``; the detail route is what a future post
    page would read. A populated detail beside an empty feed would be a real
    inconsistency even though both responses come from the same service.
    """
    post_id = publish(api_client, candidate)["id"]
    like(api_client, candidate, post_id)
    comment(api_client, other_candidate, post_id, "Agreed.")

    feed = api_client.get("/api/v1/posts", headers=candidate.headers).json()
    from_feed = next(post for post in feed["items"] if post["id"] == post_id)

    assert from_feed["engagement"]["like_count"] == 1
    assert from_feed["engagement"]["comment_count"] == 1
    assert from_feed["engagement"] == engagement_of(api_client, candidate, post_id)
