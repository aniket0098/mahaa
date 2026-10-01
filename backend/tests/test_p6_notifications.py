"""Phase 6 — notifications.

**A notification is somebody's mail, so every test here is really a test about
addressing.** §16's rule is that no client-supplied user id is ever trusted, and
§13.2 makes ``actor`` a *person* on the row. So the tests that matter most are
the ones where a third account tries to read, count, or mark another's
notification as read — a leak here would be the worst bug this phase could ship,
and a suite that only ever uses one account cannot detect one (there is nothing
to steal if nobody else exists). C appears throughout.

**There is no route that creates one.** §13.1's honest V1 set is
``{connection_request, connection_accepted, message, system}``, and every one of
them is produced by a *different* domain as a side effect. There is deliberately
no ``POST /notifications``: a client that could create a notification could name
its own recipient and its own actor, and would have a spoofing primitive. The
producer tests below therefore drive connections and messaging through their real
routes and then assert on the rows, which is also the only way to test the claim
that matters most here — that the notification is written by the *same
transaction* as the thing it describes.

**Read state is monotonic.** There is no mark-unread verb and no request body, so
a client retrying a tap cannot un-read itself. The idempotency tests assert that
repeating a read is a 204 and not an error, because §18 requires retries of an
already-applied change to be no-ops.

**No mobile module exists.** §23's parity table records notifications as having
no client module and both screens as `StageScreen`, and §13 notes the app
deliberately carries no badge, dot, or count. So these tests are written against
§13.2 and the generated OpenAPI, never against a TypeScript type — and the count
endpoint is tested precisely because §22 orders it built *before* any badge.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text

from app.models import Message, Notification, User
from app.models.enums import NotificationType, UserStatus
from app.services import notifications as svc
from tests.conftest import REJECTION_ERRORS, register

#: An id that exists in no inbox. Only used where authentication or the route's
#: own parsing is what is under test.
NOBODY = str(uuid.UUID(int=0))

NOTIFICATION_ROUTES = [
    ("get", "/api/v1/notifications", None),
    ("get", "/api/v1/notifications/unread-count", None),
    ("post", f"/api/v1/notifications/{NOBODY}/read", None),
    ("post", "/api/v1/notifications/read-all", None),
]

ROUTE_IDS = [f"{method.upper()} {path}" for method, path, _ in NOTIFICATION_ROUTES]

#: §13.3's hard ceiling.
LIMIT_MAX = 50

# --- helpers -----------------------------------------------------------------


def _call(api_client, method: str, path: str, body=None, headers=None):
    kwargs = {} if headers is None else {"headers": headers}
    if body is not None:
        kwargs["json"] = body
    return getattr(api_client, method)(path, **kwargs)


def _page(api_client, account, **params) -> dict:
    response = api_client.get(
        "/api/v1/notifications", params=params or None, headers=account.headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def _count(api_client, account) -> int:
    response = api_client.get(
        "/api/v1/notifications/unread-count", headers=account.headers
    )
    assert response.status_code == 200, response.text
    return response.json()["count"]


def _mark(api_client, account, notification_id: str):
    return api_client.post(
        f"/api/v1/notifications/{notification_id}/read", headers=account.headers
    )


def _mark_all(api_client, account):
    return api_client.post("/api/v1/notifications/read-all", headers=account.headers)


def _emit(
    db_session, recipient, notification_type, actor=None, **kwargs
) -> Notification:
    """Write one notification through the one function that can write one.

    Used only to *set up* list/count/pagination tests. The producer tests
    deliberately do not use it — they go through connections and messaging,
    because "the server can emit" is not the claim; "the right one is emitted by
    the right operation, in its transaction" is.
    """

    return svc.emit(
        db_session,
        recipient_id=uuid.UUID(recipient.id),
        notification_type=notification_type,
        actor_id=uuid.UUID(actor.id) if actor else None,
        **kwargs,
    )


def _seed(db_session, account, actor, count: int, *, is_read: bool = False):
    """Create ``count`` notifications for ``account``, oldest first.

    Timestamps are pinned one second apart. The suite's session is a single
    rolled-back transaction, so PostgreSQL's ``now()`` gives every row the *same*
    value and the ``(created_at, id)`` ORDER BY falls through to a random uuid —
    which would make the ordering assertions test uuid luck rather than the
    query. Production does not have this problem (one transaction per request).
    """

    base = datetime(2024, 6, 1, tzinfo=UTC)
    created = []
    for index in range(count):
        row = _emit(
            db_session,
            account,
            NotificationType.SYSTEM,
            actor=actor,
            title=f"Notice {index}",
            data={"n": index},
        )
        row.created_at = base + timedelta(seconds=index)
        row.is_read = is_read
        created.append(row)
    db_session.commit()
    return created


def _types(api_client, account) -> list[str]:
    """Every notification type in the caller's inbox, newest first."""

    return [i["type"] for i in _page(api_client, account, limit=LIMIT_MAX)["items"]]


def _only_type(api_client, account, wanted: str) -> list[dict]:
    """The caller's notifications of one type.

    The messaging tests have to filter: setting them up requires an *accepted*
    connection, and that accept legitimately notifies the requester too. Filtering
    by type is what keeps the assertion about ``message`` rather than about the
    total, which would make every test here depend on §6.3's ordering.
    """

    return [
        i
        for i in _page(api_client, account, limit=LIMIT_MAX)["items"]
        if i["type"] == wanted
    ]


def _connect(api_client, a, b) -> str:
    """A, and B, with an **accepted** connection between them.

    Accepted rather than merely requested because §7.1's relationship rule is
    acceptance: a pending request is not enough to open a conversation, so a
    messaging producer test that stopped at ``_connect`` would be testing a 403.
    """

    sent = api_client.post(
        "/api/v1/connections", json={"user_id": b.id}, headers=a.headers
    )
    assert sent.status_code == 201, sent.text
    connection_id = sent.json()["id"]
    accepted = api_client.post(
        f"/api/v1/connections/{connection_id}/accept", headers=b.headers
    )
    assert accepted.status_code == 200, accepted.text
    return connection_id


def _request(api_client, a, b) -> str:
    """A pending request only — no accept. For the request-notification tests."""

    sent = api_client.post(
        "/api/v1/connections", json={"user_id": b.id}, headers=a.headers
    )
    assert sent.status_code == 201, sent.text
    return sent.json()["id"]


def _open_conversation(api_client, a, b) -> str:
    opened = api_client.post(
        "/api/v1/conversations", json={"user_id": b.id}, headers=a.headers
    )
    assert opened.status_code == 201, opened.text
    return opened.json()["id"]


def _settle(api_client, account, connection_id: str, verb: str) -> dict:
    response = api_client.post(
        f"/api/v1/connections/{connection_id}/{verb}", headers=account.headers
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- fixtures ----------------------------------------------------------------


@pytest.fixture()
def stranger(api_client):
    """User C. An account that must never see, count, or mark another's mail."""

    return register(api_client, f"stranger.{uuid.uuid4().hex[:12]}@example.com")


@pytest.fixture()
def seeded(db_session, candidate, other_candidate):
    """``candidate`` holding three unread notifications from ``other_candidate``."""

    _seed(db_session, candidate, other_candidate, 3)
    return db_session
# --- authentication ----------------------------------------------------------


@pytest.mark.parametrize("method,path,body", NOTIFICATION_ROUTES, ids=ROUTE_IDS)
def test_every_notification_route_needs_a_token(api_client, method, path, body) -> None:
    response = _call(api_client, method, path, body)

    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "not_authenticated"


def test_a_forged_token_is_rejected(api_client) -> None:
    headers = {"Authorization": "Bearer not-a-real-token"}

    assert api_client.get("/api/v1/notifications", headers=headers).status_code == 401
    for path in (
        "/api/v1/notifications/unread-count",
        f"/api/v1/notifications/{NOBODY}/read",
        "/api/v1/notifications/read-all",
    ):
        method = "get" if path.endswith("unread-count") else "post"
        response = getattr(api_client, method)(path, headers=headers)
        assert response.status_code == 401, path


def test_there_is_no_route_that_creates_a_notification(api_client, candidate) -> None:
    """The absence is the feature, so it is asserted rather than assumed.

    §16: no client-supplied user id is ever trusted. A create endpoint would let
    a client name its own recipient *and* its own actor, which is a spoofing
    primitive the rest of this suite spends hundreds of lines preventing.
    """

    for path in ("/api/v1/notifications", "/api/v1/notifications/"):
        response = api_client.post(
            path,
            json={"type": "system", "title": "Trust me"},
            headers=candidate.headers,
        )
        # 405, not 404: the path exists for GET, so FastAPI answers "wrong verb".
        # That is itself the proof — there is no POST handler to receive a body.
        assert response.status_code in (404, 405), (path, response.status_code)

    # ...and nothing was written by trying.
    assert _count(api_client, candidate) == 0


def test_there_is_no_route_that_deletes_a_notification(
    api_client, seeded, candidate
) -> None:
    """§13.4 recommends a 90-day retention job, not a client delete verb.

    Nothing in §13 asks for one, and adding it would give any account the ability
    to remove evidence of something somebody else did to them.
    """

    target = _page(api_client, candidate)["items"][0]["id"]
    for method in ("delete", "put", "patch"):
        response = getattr(api_client, method)(
            f"/api/v1/notifications/{target}", headers=candidate.headers
        )
        # 404, not 405: there is no `/notifications/{id}` path at all, only
        # `POST /notifications/{id}/read`. Either way the row is untouched.
        assert response.status_code in (404, 405), (method, response.status_code)

    assert _page(api_client, candidate)["total"] == 3
# --- shape (§13.2) -----------------------------------------------------------


def test_a_notification_carries_exactly_the_specified_fields(
    api_client, seeded, candidate, other_candidate
) -> None:
    """§13.2's shape, verbatim. ``actor`` is nested, not flattened."""

    item = _page(api_client, candidate)["items"][0]

    assert set(item) == {
        "id",
        "type",
        "actor",
        "target_type",
        "target_id",
        "title",
        "body",
        "data",
        "is_read",
        "created_at",
    }
    # §13.2: `actor{user_id, name, avatar_url}` — three fields, not a
    # UserSummary. A handle or a role would be a disclosure §13.2 does not ask
    # for, on the most widely-read object in the product.
    assert set(item["actor"]) == {"user_id", "name", "avatar_url"}
    assert item["actor"]["user_id"] == other_candidate.id
    assert isinstance(item["actor"]["name"], str) and item["actor"]["name"]
    # No media rows exist yet, so `avatar_url` is null rather than absent.
    assert item["actor"]["avatar_url"] is None


def test_an_actor_may_be_absent_and_still_renders(
    api_client, db_session, candidate
) -> None:
    """§13.2: "a system notification has no actor".

    The key must be *present* with a null value — the same "not shown" vs "shown
    and empty" distinction §5.3 makes for a public profile. A client that checked
    for the key's absence would have to treat a deleted actor as a system notice,
    and the two render differently.
    """

    svc.emit(
        db_session,
        recipient_id=uuid.UUID(candidate.id),
        notification_type=NotificationType.SYSTEM,
        title="Scheduled maintenance",
    )
    item = _page(api_client, candidate)["items"][0]

    assert "actor" in item
    assert item["actor"] is None
    assert item["type"] == "system"


def test_the_registry_is_only_what_the_platform_can_produce() -> None:
    """§13.1: types that are not producible "must not be modelled as live".

    ``incoming_call``, ``missed_call``, ``post_interaction`` and ``opportunity``
    are all listed in §13.1 and all absent here, because calls (§8), posts (§9)
    and opportunities do not exist yet. Modelling them would be a lie the client
    could build a switch on.
    """

    producible = {t.value for t in NotificationType}
    assert producible == {
        "connection_request",
        "connection_accepted",
        "message",
        "system",
    }
    for premature in (
        "incoming_call",
        "missed_call",
        "post_interaction",
        "opportunity",
    ):
        assert premature not in producible


def test_the_database_refuses_a_type_outside_the_registry(
    db_session, candidate
) -> None:
    """The CHECK is enforced by PostgreSQL, not only by the Python enum.

    The point is that the constraint exists at all, so a future edit that drops it
    fails here rather than silently widening the vocabulary to whatever a bug
    manages to write.
    """

    row = Notification(
        user_id=uuid.UUID(candidate.id),
        type="incoming_call",  # not in the registry
        title="Should not be storable",
        data={},
        is_read=False,
    )
    db_session.add(row)
    with pytest.raises(REJECTION_ERRORS):
        with db_session.begin_nested():
            db_session.flush()
    if row in db_session:
        db_session.expunge(row)


def test_the_title_ceiling_is_the_column_width() -> None:
    """§14.7 declares ``title text``; the model narrows it to 200 characters.

    The bound is why ``NOTIFICATION_TITLE_MAX`` exists, so this pins the one
    number the service validates against rather than leaving it implicit in two
    places.
    """

    assert svc.NOTIFICATION_TITLE_MAX == 200
# --- isolation (§16) ---------------------------------------------------------


def test_a_stranger_sees_an_empty_inbox(api_client, seeded, stranger) -> None:
    """Recipient scoping is in the query, so there is nothing to leak."""

    page = _page(api_client, stranger)
    assert page["items"] == []
    assert page["total"] == 0
    assert _count(api_client, stranger) == 0


def test_the_inbox_contains_only_my_own_notifications(
    api_client, seeded, stranger, candidate
) -> None:
    """A and B both have mail. Neither page may contain the other's."""

    _seed(seeded, stranger, candidate, 1)

    mine = _page(api_client, candidate)["items"]
    theirs = _page(api_client, stranger)["items"]

    assert len(mine) == 3
    assert len(theirs) == 1
    assert {i["id"] for i in mine}.isdisjoint({i["id"] for i in theirs})


def test_another_account_cannot_mark_my_notification_read(
    api_client, seeded, stranger, candidate
) -> None:
    """404, not 403, and not 204. §16: the answer must not confirm it exists."""

    target = _page(api_client, candidate)["items"][0]["id"]

    response = _mark(api_client, stranger, target)

    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "not_found"
    # Still unread, and still mine.
    assert _page(api_client, candidate)["items"][0]["is_read"] is False
    assert _count(api_client, candidate) == 3


def test_someone_elses_row_answers_exactly_like_a_missing_one(
    api_client, db_session, candidate, stranger
) -> None:
    """Two different situations, byte-identical answers.

    A distinct status or message for "exists but is not yours" is a membership
    oracle: it turns the read endpoint into a way to confirm that an arbitrary id
    belongs to a real notification.
    """

    _seed(db_session, candidate, candidate, 1)
    theirs = _page(api_client, candidate)["items"][0]["id"]

    stolen = _mark(api_client, stranger, theirs)
    absent = _mark(api_client, stranger, str(uuid.uuid4()))

    assert stolen.status_code == absent.status_code == 404
    # Compared with `request_id` set aside: it is per-request by design, so it is
    # the one field two identical answers are *expected* to differ on. Everything
    # a caller could learn about the row must match — status, code, message, and
    # the `details` that would otherwise leak why the lookup failed.
    left, right = stolen.json()["error"], absent.json()["error"]
    assert left.pop("request_id") != right.pop("request_id")
    assert left == right


def test_a_malformed_id_is_a_404_not_a_500(api_client, candidate) -> None:
    """`parse_id` turns junk into the same answer, so no route leaks a 500."""

    for raw in ("not-a-uuid", "12345", "0000"):
        response = _mark(api_client, candidate, raw)
        assert response.status_code == 404, (raw, response.text)
        assert response.json()["error"]["code"] == "not_found"


def test_read_all_touches_only_my_own_rows(
    api_client, db_session, candidate, stranger
) -> None:
    _seed(db_session, candidate, stranger, 3)
    _seed(db_session, stranger, candidate, 2)

    assert _mark_all(api_client, candidate).status_code == 204

    assert _count(api_client, candidate) == 0
    assert _count(api_client, stranger) == 2  # untouched


def test_an_employer_has_a_mailbox_too(
    api_client, db_session, candidate, employer
) -> None:
    """No role restriction: the routes use ``CurrentUser``, not ``CandidateUser``.

    §13's events are not candidate-only — a college official receives connection
    requests and an employer receives messages, and both are notified.
    """

    _seed(db_session, employer, candidate, 2)

    page = _page(api_client, employer)
    assert page["total"] == 2
    assert _count(api_client, employer) == 2
    assert _page(api_client, candidate)["total"] == 0
# --- ordering and pagination (§13.3) -----------------------------------------


def test_the_list_is_newest_first(api_client, seeded, candidate) -> None:
    """§13.3: ``(created_at, id) DESC``."""

    items = _page(api_client, candidate)["items"]
    stamps = [i["created_at"] for i in items]

    assert stamps == sorted(stamps, reverse=True)
    assert [i["data"]["n"] for i in items] == [2, 1, 0]


def test_rows_sharing_a_timestamp_still_order_deterministically(
    api_client, seeded, candidate
) -> None:
    """The ``id`` half of the sort key earns its place here.

    ``created_at`` is not unique, so without the tiebreak two rows sharing a
    timestamp could come back in a different order on a re-read — which is the
    duplicate-across-pages bug keyset exists to prevent. All three rows below are
    given the *same* timestamp on purpose.
    """

    rows = seeded.scalars(
        select(Notification).where(
            Notification.user_id == uuid.UUID(candidate.id)
        )
    ).all()
    stamp = rows[0].created_at
    for row in rows:
        row.created_at = stamp
    seeded.commit()

    first = [i["id"] for i in _page(api_client, candidate, limit=50)["items"]]
    second = [i["id"] for i in _page(api_client, candidate, limit=50)["items"]]

    assert first == second
    # Ties broken by id descending, as §13.3 specifies.
    expected = [str(r.id) for r in sorted(rows, key=lambda r: r.id, reverse=True)]
    assert first == expected


def test_total_is_the_full_count_not_the_page_length(
    api_client, db_session, candidate, other_candidate
) -> None:
    """§13.3 and §17 both insist: ``total`` is the whole filtered set.

    This is the number a "3 new" badge is computed from, so deriving it from the
    page would make the badge lie the moment the inbox outgrew one page.
    """

    _seed(db_session, candidate, other_candidate, 7)

    page = _page(api_client, candidate, limit=3)

    assert len(page["items"]) == 3
    assert page["total"] == 7
    assert page["limit"] == 3


def test_paging_walks_the_whole_inbox_without_repeating_or_skipping(
    api_client, db_session, candidate, other_candidate
) -> None:
    """The keyset property, end to end. Every row exactly once, newest first."""

    _seed(db_session, candidate, other_candidate, 7)

    seen: list[str] = []
    cursor = None
    for _ in range(10):  # more iterations than there are pages
        page = _page(api_client, candidate, limit=2, cursor=cursor)
        seen.extend(i["id"] for i in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    everything = [i["id"] for i in _page(api_client, candidate, limit=50)["items"]]
    assert seen == everything
    assert len(seen) == len(set(seen)) == 7
    assert cursor is None
def test_an_exact_final_page_reports_no_more_rows(
    api_client, db_session, candidate, other_candidate
) -> None:
    """The bug ``limit + 1`` exists to prevent.

    With 4 rows and ``limit=4`` the page is exactly full. Inferring ``has_more``
    from ``len(items) == limit`` says ``True``, hands back a cursor, and sends the
    client to a page that is empty by definition — a loop a client cannot detect
    the end of. Fetching one row past the limit answers the question properly.
    """

    _seed(db_session, candidate, other_candidate, 4)

    page = _page(api_client, candidate, limit=4)

    assert len(page["items"]) == 4
    assert page["has_more"] is False
    assert page["next_cursor"] is None


def test_a_short_page_reports_no_more_rows(api_client, seeded, candidate) -> None:
    page = _page(api_client, candidate, limit=50)

    assert len(page["items"]) == 3
    assert page["has_more"] is False
    assert page["next_cursor"] is None


def test_the_last_partial_page_ends_the_walk(
    api_client, db_session, candidate, other_candidate
) -> None:
    """5 rows, pages of 2: 2, 2, 1 — and the third page must not claim more."""

    _seed(db_session, candidate, other_candidate, 5)

    first = _page(api_client, candidate, limit=2)
    second = _page(api_client, candidate, limit=2, cursor=first["next_cursor"])
    third = _page(api_client, candidate, limit=2, cursor=second["next_cursor"])

    assert len(first["items"]) == len(second["items"]) == 2
    assert first["has_more"] and second["has_more"]
    assert len(third["items"]) == 1
    assert third["has_more"] is False
    assert third["next_cursor"] is None


def test_an_empty_inbox_is_a_well_formed_empty_page(api_client, candidate) -> None:
    page = _page(api_client, candidate)

    assert page["items"] == []
    assert page["total"] == 0
    assert page["has_more"] is False
    assert page["next_cursor"] is None


def test_the_limit_ceiling_is_enforced(api_client, candidate) -> None:
    """§13.3: ``limit`` ≤ 50. The boundary itself must be accepted."""

    assert _page(api_client, candidate, limit=LIMIT_MAX)["limit"] == LIMIT_MAX

    for over in (LIMIT_MAX + 1, 500):
        response = api_client.get(
            "/api/v1/notifications", params={"limit": over}, headers=candidate.headers
        )
        assert response.status_code == 422, (over, response.text)


def test_a_zero_or_negative_limit_is_refused(api_client, candidate) -> None:
    for bad in (0, -1):
        response = api_client.get(
            "/api/v1/notifications", params={"limit": bad}, headers=candidate.headers
        )
        assert response.status_code == 422, (bad, response.text)


def test_a_corrupt_cursor_is_a_client_error_not_a_500(api_client, candidate) -> None:
    """A cursor is opaque and client-supplied, so it is untrusted input.

    It carries a binary encoding; a client that mangles it must not be able to
    reach a decode error that surfaces as a 500 with a traceback.
    """

    for junk in ("!!!not-base64!!!", "e30=", "null", "%%%%"):
        response = api_client.get(
            "/api/v1/notifications",
            params={"cursor": junk},
            headers=candidate.headers,
        )
        assert response.status_code in (400, 422), (
            junk,
            response.status_code,
            response.text,
        )


def test_rows_older_than_the_cursor_are_excluded(api_client, seeded, candidate) -> None:
    """The boundary is exclusive: no row is returned on two pages."""

    first = _page(api_client, candidate, limit=2)
    boundary = first["items"][-1]["id"]
    second = _page(api_client, candidate, limit=50, cursor=first["next_cursor"])

    assert boundary not in {i["id"] for i in second["items"]}


def test_marking_read_does_not_move_a_row_across_a_cursor(
    api_client, seeded, candidate
) -> None:
    """Read state must not disturb paging.

    ``is_read`` is not part of the sort key and never becomes part of it, so
    reading a row cannot shift it under a cursor the client is already holding —
    the property that lets a client keep paging while the user taps rows.
    """

    first = _page(api_client, candidate, limit=2)
    expected = [i["id"] for i in _page(api_client, candidate, limit=50)["items"][2:]]

    assert _mark(api_client, candidate, first["items"][0]["id"]).status_code == 204

    after = _page(api_client, candidate, limit=2, cursor=first["next_cursor"])
    assert [i["id"] for i in after["items"]] == expected
# --- unread filtering and counting -------------------------------------------


def test_unread_only_narrows_items_and_total_together(
    api_client, seeded, candidate
) -> None:
    """The filter applies to both, so the two always describe one set (§13.3)."""

    items = _page(api_client, candidate)["items"]
    _mark(api_client, candidate, items[0]["id"])
    _mark(api_client, candidate, items[1]["id"])

    page = _page(api_client, candidate, unread_only=True)

    assert len(page["items"]) == 1
    assert page["total"] == 1
    assert page["items"][0]["id"] == items[2]["id"]
    assert all(i["is_read"] is False for i in page["items"])


def test_the_unread_count_matches_the_unread_filter(
    api_client, seeded, candidate
) -> None:
    """§22 wants the count before any badge. It must agree with the list it
    summarises, or the badge and the screen behind it disagree."""

    _mark(api_client, candidate, _page(api_client, candidate)["items"][0]["id"])

    assert _count(api_client, candidate) == 2
    assert _page(api_client, candidate, unread_only=True)["total"] == 2


def test_the_count_is_zero_for_an_empty_inbox(api_client, candidate) -> None:
    assert _count(api_client, candidate) == 0


def test_a_read_notification_leaves_the_unread_list(
    api_client, seeded, candidate
) -> None:
    items = _page(api_client, candidate)["items"]

    assert _mark(api_client, candidate, items[0]["id"]).status_code == 204

    remaining = _page(api_client, candidate, unread_only=True)["items"]
    assert [i["id"] for i in remaining] == [items[1]["id"], items[2]["id"]]


def test_unread_only_on_a_clean_inbox_is_empty_not_the_whole_list(
    api_client, seeded, candidate
) -> None:
    """The filter is applied even when it excludes everything.

    A short-circuit that returned the unfiltered page for "no unread rows" would
    look plausible in a screenshot and be completely wrong.
    """

    for item in _page(api_client, candidate)["items"]:
        _mark(api_client, candidate, item["id"])

    page = _page(api_client, candidate, unread_only=True)

    assert page["items"] == []
    assert page["total"] == 0
    # The unfiltered list still has them.
    assert _page(api_client, candidate)["total"] == 3


def test_the_unread_count_endpoint_returns_only_the_number(
    api_client, seeded, candidate
) -> None:
    """A bare object, not an envelope.

    A count endpoint that also returned the list would make the badge a second
    read of the same rows, and would tempt a client to build the list from it —
    which is the second read §13 says the count endpoint exists to avoid.
    """

    body = api_client.get(
        "/api/v1/notifications/unread-count", headers=candidate.headers
    ).json()

    assert set(body) == {"count"}
    assert body["count"] == 3
# --- marking read (§18 idempotency) -----------------------------------------


def test_marking_one_read_is_204_and_hides_it_from_the_count(
    api_client, seeded, candidate
) -> None:
    target = _page(api_client, candidate)["items"][0]["id"]

    response = _mark(api_client, candidate, target)

    assert response.status_code == 204
    assert response.content == b""  # §13's 204 routes carry no body
    assert _count(api_client, candidate) == 2


def test_marking_the_same_row_twice_is_a_no_op_not_an_error(
    api_client, seeded, candidate
) -> None:
    """§18: a retry of an already-applied change must not fail.

    A client that taps a row and never sees the 204 will retry. Answering 404 the
    second time would be a correct-looking response that breaks that client.
    """

    target = _page(api_client, candidate)["items"][0]["id"]

    first = _mark(api_client, candidate, target)
    second = _mark(api_client, candidate, target)

    assert first.status_code == second.status_code == 204
    assert _count(api_client, candidate) == 2


def test_there_is_no_way_to_mark_a_notification_unread(
    api_client, seeded, candidate
) -> None:
    """Read state is monotonic by construction: no verb, no field.

    This is why repeating a read is safe rather than a lost update.
    """

    target = _page(api_client, candidate)["items"][0]["id"]
    _mark(api_client, candidate, target)

    attempts = (
        api_client.post(
            f"/api/v1/notifications/{target}/unread", headers=candidate.headers
        ),
        api_client.put(
            f"/api/v1/notifications/{target}",
            json={"is_read": False},
            headers=candidate.headers,
        ),
        api_client.patch(
            f"/api/v1/notifications/{target}",
            json={"is_read": False},
            headers=candidate.headers,
        ),
    )
    for response in attempts:
        assert response.status_code in (404, 405), response.status_code

    assert _page(api_client, candidate)["items"][0]["is_read"] is True


def test_read_all_is_idempotent(api_client, seeded, candidate) -> None:
    first = _mark_all(api_client, candidate)
    second = _mark_all(api_client, candidate)

    assert first.status_code == second.status_code == 204
    assert _count(api_client, candidate) == 0
    # And read, not deleted: the rows are still listed.
    assert _page(api_client, candidate)["total"] == 3


def test_read_all_does_not_delete_anything(api_client, seeded, candidate) -> None:
    """The rows are the recipient's mail. Marking is a flag, not a removal."""

    before = _page(api_client, candidate)["total"]

    _mark_all(api_client, candidate)

    after = _page(api_client, candidate)
    assert after["total"] == before
    assert all(i["is_read"] for i in after["items"])
    assert all(i["id"] for i in after["items"])


def test_read_all_on_an_empty_inbox_is_a_204(api_client, candidate) -> None:
    """A retried "mark everything read" after a full sync must not 404."""

    assert _mark_all(api_client, candidate).status_code == 204


def test_a_missing_notification_is_404(api_client, candidate) -> None:
    response = _mark(api_client, candidate, str(uuid.uuid4()))

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
# --- deletion and retention (§13.4) -----------------------------------------


def test_deleting_an_actor_keeps_the_notification_and_nulls_the_actor(
    api_client, seeded, candidate, other_candidate
) -> None:
    """§13.4: "the recipient still needs to know something happened".

    ``actor_id`` is ``SET NULL``, so the row survives its actor's account and
    renders as ``actor: null`` — anonymous, not absent.
    """

    before = _page(api_client, candidate)["items"][0]
    assert before["actor"]["user_id"] == other_candidate.id

    seeded.delete(seeded.get(User, uuid.UUID(other_candidate.id)))
    seeded.commit()

    after = _page(api_client, candidate)["items"][0]
    assert after["id"] == before["id"]
    assert "actor" in after
    assert after["actor"] is None
    assert after["title"] == before["title"]
    assert after["type"] == before["type"]
    # Still counted: an unread notice about a gone account is still unread.
    assert _count(api_client, candidate) == 3


def test_deleting_the_recipient_takes_their_mail_with_it(
    api_client, db_session, candidate, other_candidate
) -> None:
    """``user_id`` is CASCADE, the opposite of the actor — and correctly so.

    A notification is the recipient's own; nobody has a legitimate interest in
    another account's inbox, so the account's deletion takes it along.
    """

    doomed = register(api_client, f"doomed.{uuid.uuid4().hex[:12]}@example.com")
    _seed(db_session, candidate, other_candidate, 2)
    _seed(db_session, doomed, candidate, 2)
    doomed_id = uuid.UUID(doomed.id)

    db_session.delete(db_session.get(User, doomed_id))
    db_session.commit()

    survivors = db_session.scalars(
        select(Notification).where(Notification.user_id == doomed_id)
    ).all()
    assert survivors == []
    # And the deleted account's row deletion did not touch anybody else's mail.
    assert _page(api_client, candidate)["total"] == 2


def test_a_notification_survives_the_deletion_of_what_it_points_at(
    api_client, db_session, candidate, other_candidate
) -> None:
    """§13.4: "a notification points at a row that may later be deleted".

    ``target_id`` has no foreign key for exactly this reason — the deep-link
    target is another domain's row and is allowed to be gone. The id below points
    at nothing at all, and the row is written anyway.
    """

    dangling = str(uuid.uuid4())
    _emit(
        db_session,
        candidate,
        NotificationType.CONNECTION_REQUEST,
        actor=other_candidate,
        target_type="connection",
        target_id=dangling,
        title="Wants to connect",
        data={"connection_id": dangling},
    )

    item = _page(api_client, candidate)["items"][0]
    assert item["target_id"] == dangling
    assert item["target_type"] == "connection"


def test_the_page_envelope_reports_a_real_total_and_flags(
    api_client, seeded, candidate
) -> None:
    """The five envelope fields a keyset page owes its client."""

    page = _page(api_client, candidate)

    assert set(page) == {"items", "total", "limit", "next_cursor", "has_more"}
    assert page["total"] == 3
    assert page["limit"] == svc.NOTIFICATION_PAGE_DEFAULT
    assert page["has_more"] is False
    assert page["next_cursor"] is None
# --- producers (§6.3 and §7) -------------------------------------------------


def test_a_new_request_notifies_the_addressee_only(
    api_client, candidate, other_candidate, stranger
) -> None:
    """§6.3. The recipient is the addressee; the requester learns nothing about
    a request they made themselves."""

    _request(api_client, candidate, other_candidate)

    received = _page(api_client, other_candidate)["items"]
    assert len(received) == 1
    assert received[0]["type"] == "connection_request"
    assert received[0]["actor"]["user_id"] == candidate.id

    # The requester has no notification, and nobody else was told.
    assert _page(api_client, candidate)["total"] == 0
    assert _page(api_client, stranger)["total"] == 0


def test_accepting_notifies_the_requester_and_the_roles_reverse(
    api_client, candidate, other_candidate
) -> None:
    """§6.3: "each side is told about the other's action".

    The recipient is now the **requester** and the actor is the **addressee** —
    exactly reversed from the request notification, which is what makes the two
    complementary rather than two copies of the same message.
    """

    connection_id = _request(api_client, candidate, other_candidate)
    _settle(api_client, other_candidate, connection_id, "accept")

    requester_inbox = _page(api_client, candidate)["items"]
    assert len(requester_inbox) == 1
    assert requester_inbox[0]["type"] == "connection_accepted"
    assert requester_inbox[0]["actor"]["user_id"] == other_candidate.id

    # The addressee already knows: they did it. Still exactly one notification.
    assert _page(api_client, other_candidate)["total"] == 1


def test_declining_notifies_the_requester_of_nothing(
    api_client, candidate, other_candidate
) -> None:
    """§13.1 lists only ``connection_request`` and ``connection_accepted`` as
    producible. A decline is the addressee declining, and they know."""

    connection_id = _request(api_client, candidate, other_candidate)
    _settle(api_client, other_candidate, connection_id, "decline")

    assert _page(api_client, candidate)["total"] == 0
    assert _page(api_client, other_candidate)["total"] == 1  # only the request


def test_a_repeated_request_does_not_duplicate_the_notification(
    api_client, candidate, other_candidate
) -> None:
    """§18: a retried send is idempotent, and so is its side effect.

    The second ``POST /connections`` answers 200 with the same record because
    nothing was created — so there is no second event to notify about. Emission
    lives *after* that guard, which is why no unique constraint is needed here.
    """

    _request(api_client, candidate, other_candidate)
    repeat = api_client.post(
        "/api/v1/connections",
        json={"user_id": other_candidate.id},
        headers=candidate.headers,
    )
    assert repeat.status_code == 200, repeat.text

    assert _page(api_client, other_candidate)["total"] == 1


def test_a_repeated_accept_does_not_duplicate_the_notification(
    api_client, candidate, other_candidate
) -> None:
    """Accepting an already-accepted connection is a no-op, and emits nothing.

    This is the case that rules out a ``(user_id, type, target_id)`` unique index
    as the idempotency mechanism: §18 also revives a declined connection, and that
    genuinely must notify again. Only the state machine knows which repeat is
    silent and which is a new event.
    """

    connection_id = _request(api_client, candidate, other_candidate)
    _settle(api_client, other_candidate, connection_id, "accept")
    _settle(api_client, other_candidate, connection_id, "accept")

    assert _page(api_client, candidate)["total"] == 1


def test_reviving_a_declined_connection_notifies_again(
    api_client, candidate, other_candidate
) -> None:
    """The other half of why no unique index: this repeat *is* a new event.

    §18 lets a declined connection be revived. The addressee was told nothing last
    time (a decline is theirs to know), so a revived request is the first thing
    they have to be told about.
    """

    connection_id = _request(api_client, candidate, other_candidate)
    _settle(api_client, other_candidate, connection_id, "decline")
    revived = api_client.post(
        "/api/v1/connections",
        json={"user_id": other_candidate.id},
        headers=candidate.headers,
    )
    assert revived.status_code == 200, revived.text

    inbox = _page(api_client, other_candidate)["items"]
    assert len(inbox) == 2
    assert {i["type"] for i in inbox} == {"connection_request"}


def test_a_request_notification_points_at_the_connection(
    api_client, candidate, other_candidate
) -> None:
    """§13.2: ``data`` is the client's deep link — an id, and nothing that could
    carry rendered text."""

    connection_id = _request(api_client, candidate, other_candidate)

    item = _page(api_client, other_candidate)["items"][0]

    assert item["target_type"] == "connection"
    assert item["target_id"] == connection_id
    assert item["data"] == {"connection_id": connection_id}
    # The title is the server's wording, so a copy change is a deployment.
    assert isinstance(item["title"], str) and item["title"]
    assert item["is_read"] is False
def test_a_new_message_notifies_the_recipient_with_the_conversation(
    api_client, candidate, other_candidate
) -> None:
    """§13.1's ``message`` type, produced by §7 with no client involvement."""

    _connect(api_client, candidate, other_candidate)
    conversation_id = _open_conversation(api_client, candidate, other_candidate)

    sent = api_client.post(
        f"/api/v1/conversations/{conversation_id}/messages",
        json={"body": "Hello there"},
        headers=candidate.headers,
    )
    assert sent.status_code == 201, sent.text

    received = _only_type(api_client, other_candidate, "message")
    assert len(received) == 1
    assert received[0]["actor"]["user_id"] == candidate.id
    assert received[0]["target_type"] == "conversation"
    assert received[0]["target_id"] == conversation_id


def test_a_message_notification_never_carries_the_message_body(
    api_client, candidate, other_candidate
) -> None:
    """§13.2: ``data`` is "never a rendered message".

    The notification list renders while the app is locked. Copying the body here
    would duplicate every private message into a second table, and the identifiers
    are enough to open the thread.
    """

    _connect(api_client, candidate, other_candidate)
    conversation_id = _open_conversation(api_client, candidate, other_candidate)
    secret = "My bank PIN is 4021"
    api_client.post(
        f"/api/v1/conversations/{conversation_id}/messages",
        json={"body": secret},
        headers=candidate.headers,
    )

    item = _only_type(api_client, other_candidate, "message")[0]

    assert secret not in str(item["data"])
    assert secret not in (item["body"] or "")
    assert set(item["data"]) == {"conversation_id"}


def test_a_retried_message_does_not_notify_twice(
    api_client, candidate, other_candidate
) -> None:
    """§18's ``client_message_id``. The retry returns the winner's row, so the
    notification was already emitted by the commit that created it."""

    _connect(api_client, candidate, other_candidate)
    conversation_id = _open_conversation(api_client, candidate, other_candidate)
    payload = {"body": "Only once", "client_message_id": str(uuid.uuid4())}

    first = api_client.post(
        f"/api/v1/conversations/{conversation_id}/messages",
        json=payload,
        headers=candidate.headers,
    )
    second = api_client.post(
        f"/api/v1/conversations/{conversation_id}/messages",
        json=payload,
        headers=candidate.headers,
    )

    assert first.status_code == 201, first.text
    assert second.status_code == 200, second.text
    # One `message` notification, despite two POSTs. The connection noise from
    # `_connect` is a different type and is filtered out by `_only_type`.
    assert len(_only_type(api_client, other_candidate, "message")) == 1


def test_the_sender_is_not_notified_of_their_own_message(
    api_client, candidate, other_candidate
) -> None:
    """The recipient is derived from the conversation, never from the request.

    ``MessageCreate`` has no recipient field, and the sender is ``viewer`` alone,
    so there is no input a client could use to notify itself.
    """

    _connect(api_client, candidate, other_candidate)
    conversation_id = _open_conversation(api_client, candidate, other_candidate)
    api_client.post(
        f"/api/v1/conversations/{conversation_id}/messages",
        json={"body": "Talking to myself"},
        headers=candidate.headers,
    )

    assert _only_type(api_client, candidate, "message") == []
    assert len(_only_type(api_client, other_candidate, "message")) == 1


def test_every_second_message_notifies_again(
    api_client, candidate, other_candidate
) -> None:
    """Two messages are two events. Idempotency must not become deduplication."""

    _connect(api_client, candidate, other_candidate)
    conversation_id = _open_conversation(api_client, candidate, other_candidate)
    for index in range(2):
        response = api_client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            json={"body": f"Message {index}"},
            headers=candidate.headers,
        )
        assert response.status_code == 201, response.text

    assert len(_only_type(api_client, other_candidate, "message")) == 2
# --- transactionality (§6.3's shared commit) --------------------------------


def test_the_message_and_its_notification_are_written_by_one_transaction(
    api_client, db_session, candidate, other_candidate
) -> None:
    """The strongest claim this phase makes, tested directly.

    ``emit`` never commits: it stages a row on the caller's session and returns.
    So if the message and the notification are both written, they were written by
    the same commit — and if the operation rolls back, the notification goes with
    it. A message that can exist without its notification is a message delivered
    to an inbox that does not know about it.
    """

    _connect(api_client, candidate, other_candidate)
    conversation_id = _open_conversation(api_client, candidate, other_candidate)
    api_client.post(
        f"/api/v1/conversations/{conversation_id}/messages",
        json={"body": "Transactional"},
        headers=candidate.headers,
    )

    messages = db_session.scalars(select(Message)).all()
    assert len(messages) == 1

    notifications = db_session.scalars(
        select(Notification).where(
            Notification.user_id == uuid.UUID(other_candidate.id),
            Notification.type == NotificationType.MESSAGE,
        )
    ).all()
    assert len(notifications) == 1

    row = notifications[0]
    assert row.target_id == uuid.UUID(conversation_id)
    assert row.data == {"conversation_id": conversation_id}
    assert row.is_read is False


def test_emit_never_commits_on_its_own(db_session, candidate, other_candidate) -> None:
    """The property the transactional claim rests on, asserted in isolation.

    If ``emit`` committed, the notification would be durable before the operation
    that caused it had succeeded — and a later failure would leave a notification
    describing something that never happened.
    """

    svc.emit(
        db_session,
        recipient_id=uuid.UUID(other_candidate.id),
        notification_type=NotificationType.SYSTEM,
        actor_id=uuid.UUID(candidate.id),
        title="Staged, not committed",
    )
    db_session.rollback()

    survivors = db_session.scalars(
        select(Notification).where(
            Notification.user_id == uuid.UUID(other_candidate.id)
        )
    ).all()
    assert survivors == []


def test_a_rolled_back_operation_leaves_no_notification(
    db_session, candidate, other_candidate
) -> None:
    """The other half of transactional: a failure takes the side effect with it.

    ``emit`` stages and returns rather than committing, so an exception raised by
    the originating operation discards the notification along with everything
    else. There is no separate transaction that could survive it.
    """

    before = len(db_session.scalars(select(Notification)).all())

    with pytest.raises(RuntimeError):
        with db_session.begin_nested():
            svc.emit(
                db_session,
                recipient_id=uuid.UUID(other_candidate.id),
                notification_type=NotificationType.SYSTEM,
                title="Never committed",
            )
            raise RuntimeError("the operation this notification described failed")

    assert len(db_session.scalars(select(Notification)).all()) == before


def test_a_failed_connection_request_notifies_nobody(
    api_client, candidate, stranger
) -> None:
    """A request to a user who does not exist is a 404 before any row is made.

    Emission happens inside ``_persist``, so the guard that runs before it also
    runs before the notification — there is no path where the request fails and a
    notification is left behind claiming it happened.
    """

    response = api_client.post(
        "/api/v1/connections",
        json={"user_id": str(uuid.uuid4())},
        headers=candidate.headers,
    )
    assert response.status_code == 404, response.text

    assert _page(api_client, candidate)["total"] == 0
    assert _page(api_client, stranger)["total"] == 0


def test_a_self_connection_notifies_nobody(api_client, candidate) -> None:
    """§6.3's first guard: you cannot connect to yourself, so nobody is told."""

    response = api_client.post(
        "/api/v1/connections", json={"user_id": candidate.id}, headers=candidate.headers
    )

    assert response.status_code == 422, response.text
    assert _page(api_client, candidate)["total"] == 0
# --- suspension and index usage ----------------------------------------------


def test_a_suspended_account_is_forbidden_not_signed_out(
    api_client, db_session, candidate, other_candidate
) -> None:
    """A suspension is 403, not 401 and not a silent empty inbox.

    Deliberate: answering "no notifications" would look exactly like a working
    account with a clean inbox, and the client would render it as empty rather
    than signing the person out.
    """

    _seed(db_session, candidate, other_candidate, 1)
    suspended = register(api_client, f"suspended.{uuid.uuid4().hex[:12]}@example.com")
    db_session.get(User, uuid.UUID(suspended.id)).status = UserStatus.SUSPENDED
    db_session.commit()

    # Raw calls, not the `_page`/`_count` helpers: those assert 200 internally,
    # which is precisely the response a suspended account must *not* get.
    responses = (
        api_client.get("/api/v1/notifications", headers=suspended.headers),
        api_client.get("/api/v1/notifications/unread-count", headers=suspended.headers),
        api_client.post("/api/v1/notifications/read-all", headers=suspended.headers),
    )
    for response in responses:
        assert response.status_code == 403, response.text
        assert response.json()["error"]["code"] == "forbidden"


def _explain(db_session, sql: str, **params) -> str:
    """Plan a query with sequential scans switched off.

    A three-row table is smaller than one index page, so the planner picks a
    sequential scan every time and a plan assertion would prove nothing. Turning
    ``enable_seqscan`` off makes the planner report what it *could* use, which is
    the question actually being asked: does an index exist that matches this
    query's predicate and sort key? On a real table that has data, the planner
    reaches the same conclusion on cost.
    """

    db_session.execute(text("SET LOCAL enable_seqscan = off"))
    return " ".join(db_session.execute(text(f"EXPLAIN {sql}"), params).scalars().all())


def test_the_unread_query_is_served_by_the_partial_index(
    db_session, candidate, other_candidate
) -> None:
    """§13.2 requires a partial index for the unread query; this proves it is
    usable, which is the part no other test here can see.

    The planner only chooses a partial index when its predicate is provably
    implied by the query's ``WHERE``. If the index's predicate text and the
    ``is_read = false`` filter ever drift apart, this stops being a partial-index
    scan — which is invisible to every functional assertion in this file.
    """

    _seed(db_session, candidate, other_candidate, 3)

    plan = _explain(
        db_session,
        "SELECT count(*) FROM notifications WHERE user_id = :uid AND is_read = false",
        uid=uuid.UUID(candidate.id),
    )

    assert "ix_notifications_user_id_created_at_unread" in plan, plan


def test_the_ordered_list_is_served_by_the_full_index(
    db_session, candidate, other_candidate
) -> None:
    """The full index is the list's sort key, and it is not interchangeable with
    the partial one — this one holds read rows too."""

    _seed(db_session, candidate, other_candidate, 3)

    plan = _explain(
        db_session,
        "SELECT id FROM notifications WHERE user_id = :uid "
        "ORDER BY created_at DESC, id DESC LIMIT 20",
        uid=uuid.UUID(candidate.id),
    )

    assert "ix_notifications_user_id_created_at_id" in plan, plan


def test_both_indexes_exist_and_only_the_partial_one_has_a_predicate(
    db_session,
) -> None:
    """§14.7 names exactly two indexes, and the difference between them is the
    predicate.

    Asserted against the catalog so a dropped index fails here rather than
    silently making every read a sequential scan in production, where the table
    is large and the test data is not.
    """

    rows = db_session.execute(
        text(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE tablename = 'notifications'"
        )
    ).all()
    definitions = dict(rows)

    assert "ix_notifications_user_id_created_at_unread" in definitions
    assert "ix_notifications_user_id_created_at_id" in definitions
    assert "WHERE (is_read = false)" in definitions[
        "ix_notifications_user_id_created_at_unread"
    ]
    assert "WHERE" not in definitions["ix_notifications_user_id_created_at_id"]


def test_the_read_rows_leave_the_unread_index(
    db_session, candidate, other_candidate
) -> None:
    """The point of a partial index, checked as a fact about the data rather
    than a plan string: reading a row takes it out of the unread set."""

    created = _seed(db_session, candidate, other_candidate, 4)
    recipient = uuid.UUID(candidate.id)

    def unread() -> int:
        return db_session.execute(
            text(
                "SELECT count(*) FROM notifications n "
                "WHERE n.user_id = :uid AND n.is_read = false"
            ),
            {"uid": recipient},
        ).scalar_one()

    assert unread() == 4

    created[0].is_read = True
    db_session.commit()

    assert unread() == 3
    # Still in the inbox — the partial index is not the table.
    rows = db_session.scalars(
        select(Notification).where(Notification.user_id == recipient)
    ).all()
    assert len(rows) == 4
