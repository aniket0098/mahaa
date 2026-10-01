"""Phase 5 — messaging. The A/B/C triangle on every rule.

**A and B are connected; C is not in the thread.** §22.1 makes the relationship
requirement explicit — "messaging between strangers needs a relationship rule" — so
the ``thread`` fixture does the real work of opening a connection and accepting it
before a conversation can exist. Nothing here stubs that relationship away, because
the rule *is* what is being tested.

A test with one account cannot tell a working membership check from a missing one.
There is nothing to steal if nobody else exists, so C is present throughout: C must
be refused on every endpoint, and must not be able to learn that A and B have a
thread at all.

**No mobile module exists.** §7.1 records that there is no
``src/api/messages.ts``/``conversations.ts`` and that both messages screens are
`StageScreen` notices, so these tests are written against §7.3 and the generated
OpenAPI rather than against a TypeScript type.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import Conversation, ConversationMember, Message, User
from app.models.enums import UserStatus
from tests.conftest import REJECTION_ERRORS, register

#: Nobody's conversation or message. Only used where authentication or membership is
#: decided before the id is looked up.
NOBODY = str(uuid.UUID(int=0))

MESSAGING_ROUTES = [
    ("get", "/api/v1/conversations", None),
    ("post", "/api/v1/conversations", {"user_id": NOBODY}),
    ("get", f"/api/v1/conversations/{NOBODY}", None),
    ("get", f"/api/v1/conversations/{NOBODY}/messages", None),
    ("post", f"/api/v1/conversations/{NOBODY}/messages", {"body": "hi"}),
    ("post", f"/api/v1/conversations/{NOBODY}/read", {"message_id": NOBODY}),
    ("delete", f"/api/v1/messages/{NOBODY}", None),
]

ROUTE_IDS = [f"{method.upper()} {path}" for method, path, _ in MESSAGING_ROUTES]

#: The longest body the schema accepts, for the boundary tests.
MAX_BODY = 4000


# --- helpers -----------------------------------------------------------------


def _call(api_client, method: str, path: str, body=None, headers=None):
    kwargs = {} if headers is None else {"headers": headers}
    if body is not None:
        kwargs["json"] = body
    return getattr(api_client, method)(path, **kwargs)


def _connect(api_client, a, b) -> str:
    """Give A and B an **accepted** connection, through the real Phase 4 routes."""

    sent = api_client.post(
        "/api/v1/connections", json={"user_id": b.id}, headers=a.headers
    )
    assert sent.status_code == 201, sent.text
    accepted = api_client.post(
        f"/api/v1/connections/{sent.json()['id']}/accept", headers=b.headers
    )
    assert accepted.status_code == 200, accepted.text
    return sent.json()["id"]


def _open(api_client, a, b) -> dict:
    created = api_client.post(
        "/api/v1/conversations", json={"user_id": b.id}, headers=a.headers
    )
    assert created.status_code == 201, created.text
    return created.json()


def _send(api_client, account, conversation_id: str, body: str, **extra) -> dict:
    response = api_client.post(
        f"/api/v1/conversations/{conversation_id}/messages",
        json={"body": body, **extra},
        headers=account.headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _messages(api_client, account, conversation_id: str, **params) -> dict:
    response = api_client.get(
        f"/api/v1/conversations/{conversation_id}/messages",
        params=params or None,
        headers=account.headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


def _conversations(api_client, account, **params) -> list[dict]:
    response = api_client.get(
        "/api/v1/conversations", params=params or None, headers=account.headers
    )
    assert response.status_code == 200, response.text
    return response.json()["items"]


def _unread(api_client, account, conversation_id: str) -> int:
    body = api_client.get(
        f"/api/v1/conversations/{conversation_id}", headers=account.headers
    ).json()
    return body["unread_count"]


def _rows(db_session, model):
    """Every row of a table, as ORM objects.

    ORM rather than a Core select so a test can read ``row.id``; a single-column
    Core select yields bare values, which is an easy trap.
    """

    return list(db_session.scalars(select(model)))


def _pin_in_order(db_session, message_ids: list[str]) -> None:
    """Give messages distinct, increasing timestamps, in the order listed.

    The suite's session is a single rolled-back transaction, so PostgreSQL's
    ``now()`` gives every message the *same* value and the ORDER BY tiebreak falls
    to a random uuid. Production does not have this problem — one message per
    request means one transaction each — so pinning here is what makes the ordering
    assertions test the ORDER BY rather than uuid luck.
    """

    base = datetime(2024, 1, 1, tzinfo=UTC)
    for index, raw in enumerate(message_ids):
        message = db_session.get(Message, uuid.UUID(raw))
        message.created_at = base + timedelta(seconds=index)
    db_session.commit()


# --- fixtures ----------------------------------------------------------------


@pytest.fixture()
def stranger(api_client):
    """User C. The account that must never reach A and B's thread."""

    return register(api_client, f"stranger.{uuid.uuid4().hex[:12]}@example.com")


@pytest.fixture()
def thread(api_client, candidate, other_candidate):
    """A and B, connected, with one conversation open between them."""

    _connect(api_client, candidate, other_candidate)
    return _open(api_client, candidate, other_candidate)
# --- authentication ----------------------------------------------------------


@pytest.mark.parametrize("method,path,body", MESSAGING_ROUTES, ids=ROUTE_IDS)
def test_every_messaging_route_needs_a_token(api_client, method, path, body) -> None:
    response = _call(api_client, method, path, body)

    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "not_authenticated"


def test_a_forged_token_is_rejected(api_client) -> None:
    headers = {"Authorization": "Bearer not-a-real-token"}

    assert api_client.get("/api/v1/conversations", headers=headers).status_code == 401
    assert (
        api_client.post(
            "/api/v1/conversations",
            json={"user_id": str(uuid.uuid4())},
            headers=headers,
        ).status_code
        == 401
    )


def test_a_suspended_account_is_forbidden_not_unauthenticated(
    api_client, thread, candidate, db_session
) -> None:
    """Phase 2's rule, reused verbatim. No second account-status system here."""

    user = db_session.get(User, uuid.UUID(candidate.id))
    user.status = UserStatus.SUSPENDED
    db_session.commit()

    response = api_client.get("/api/v1/conversations", headers=candidate.headers)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_any_role_may_message(api_client, employer) -> None:
    """Messaging is not a candidate-record feature: an employer answers candidates."""

    assert _conversations(api_client, employer) == []


# --- opening a conversation --------------------------------------------------


def test_opening_a_conversation_creates_it_with_both_members(
    api_client, candidate, other_candidate
) -> None:
    _connect(api_client, candidate, other_candidate)

    created = _open(api_client, candidate, other_candidate)

    assert created["id"]
    assert created["created_by"] == candidate.id
    assert created["created_at"]
    assert created["last_message_at"] is None
    assert created["last_message"] is None
    assert created["unread_count"] == 0
    assert created["muted"] is False and created["archived"] is False
    assert {member["user_id"] for member in created["members"]} == {
        candidate.id,
        other_candidate.id,
    }


def test_the_target_may_open_the_same_conversation_back(
    api_client, candidate, other_candidate
) -> None:
    """One thread, not two. ``direct_key`` is the pair's identity, not the asker's."""

    _connect(api_client, candidate, other_candidate)
    first = _open(api_client, candidate, other_candidate)

    response = api_client.post(
        "/api/v1/conversations",
        json={"user_id": candidate.id},
        headers=other_candidate.headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["id"] == first["id"]


def test_opening_the_same_conversation_twice_reuses_it(
    api_client, thread, candidate, other_candidate, db_session
) -> None:
    """§7.3 says "open (or reuse)": a repeat is 200, not 201 and not a second row."""

    response = api_client.post(
        "/api/v1/conversations",
        json={"user_id": other_candidate.id},
        headers=candidate.headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["id"] == thread["id"]
    assert len(_rows(db_session, Conversation)) == 1
    assert len(_rows(db_session, ConversationMember)) == 2


def test_a_self_conversation_is_422(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/conversations",
        json={"user_id": candidate.id},
        headers=candidate.headers,
    )

    assert response.status_code == 422
    assert "body.user_id" in response.text


def test_an_unknown_target_is_404(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/conversations",
        json={"user_id": str(uuid.uuid4())},
        headers=candidate.headers,
    )

    assert response.status_code == 404
    assert _conversations(api_client, candidate) == []


def test_a_public_id_is_not_accepted_as_a_target(
    api_client, candidate, other_candidate
) -> None:
    response = api_client.post(
        "/api/v1/conversations",
        json={"user_id": other_candidate.body["public_id"]},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_an_unknown_field_on_a_conversation_is_422(
    api_client, candidate, other_candidate
) -> None:
    """``extra="forbid"`` stops a client inventing a third participant."""

    response = api_client.post(
        "/api/v1/conversations",
        json={"user_id": other_candidate.id, "members": [str(uuid.uuid4())]},
        headers=candidate.headers,
    )

    assert response.status_code == 422

# --- the relationship requirement (§22.1) ------------------------------------


def test_two_strangers_cannot_open_a_conversation(api_client, candidate, stranger):
    """C has no connection with A, so there is nothing to have a thread about."""

    response = api_client.post(
        "/api/v1/conversations",
        json={"user_id": stranger.id},
        headers=candidate.headers,
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_a_pending_request_is_not_enough_to_message(api_client, candidate, stranger):
    """Phase 4's ``pending`` is not acceptance. A request is not a relationship."""

    sent = api_client.post(
        "/api/v1/connections", json={"user_id": stranger.id}, headers=candidate.headers
    )
    assert sent.status_code == 201

    response = api_client.post(
        "/api/v1/conversations",
        json={"user_id": stranger.id},
        headers=candidate.headers,
    )

    assert response.status_code == 403


def test_a_declined_request_is_not_enough_to_message(api_client, candidate, stranger):
    sent = api_client.post(
        "/api/v1/connections", json={"user_id": stranger.id}, headers=candidate.headers
    )
    api_client.post(
        f"/api/v1/connections/{sent.json()['id']}/decline", headers=stranger.headers
    )

    response = api_client.post(
        "/api/v1/conversations",
        json={"user_id": stranger.id},
        headers=candidate.headers,
    )

    assert response.status_code == 403


def test_a_removed_connection_still_leaves_the_conversation_readable(
    api_client, thread, candidate, other_candidate
) -> None:
    """§7.4 makes **membership** the authority on an existing conversation.

    Re-checking the connection on every read would mean deleting a connection
    silently locked somebody out of history the platform is still holding. The
    specification asks for no write-time re-check either, so this is the literal
    rule — and the phase report flags the trade rather than pretending the
    specification settled it.
    """

    connection_id = api_client.get(
        "/api/v1/connections", headers=candidate.headers
    ).json()[0]["id"]
    removed = api_client.delete(
        f"/api/v1/connections/{connection_id}", headers=candidate.headers
    )
    assert removed.status_code == 204

    for account in (candidate, other_candidate):
        response = api_client.get(
            f"/api/v1/conversations/{thread['id']}", headers=account.headers
        )
        assert response.status_code == 200, response.text


def _disable_messages(api_client, account) -> None:
    response = api_client.put(
        "/api/v1/profile/privacy",
        json={
            "profile_visibility": "public",
            "discoverable": True,
            "allow_messages": False,
            "show_email": True,
            "show_phone": False,
        },
        headers=account.headers,
    )
    assert response.status_code == 200, response.text


def test_a_target_who_disabled_messages_is_refused_before_a_row_exists(
    api_client, candidate, other_candidate
) -> None:
    """§7.5: the refusal must happen *before* the conversation is created."""

    _connect(api_client, candidate, other_candidate)
    _disable_messages(api_client, other_candidate)

    response = api_client.post(
        "/api/v1/conversations",
        json={"user_id": other_candidate.id},
        headers=candidate.headers,
    )

    assert response.status_code == 403
    assert _conversations(api_client, candidate) == []


def test_the_two_refusals_are_indistinguishable(
    api_client, candidate, other_candidate, stranger
) -> None:
    """"Not connected" and "they disabled messages" must be the same answer.

    If they differed — even only in wording — a sender could probe the private
    setting by trying somebody they are not connected to and comparing the two.
    That is precisely what §7.5 forbids.
    """

    _connect(api_client, candidate, other_candidate)
    _disable_messages(api_client, other_candidate)

    disabled = api_client.post(
        "/api/v1/conversations",
        json={"user_id": other_candidate.id},
        headers=candidate.headers,
    )
    not_connected = api_client.post(
        "/api/v1/conversations",
        json={"user_id": stranger.id},
        headers=candidate.headers,
    )

    assert disabled.status_code == not_connected.status_code == 403
    assert (
        disabled.json()["error"]["message"]
        == not_connected.json()["error"]["message"]
    )
    assert disabled.json()["error"]["code"] == not_connected.json()["error"]["code"]


def test_messages_are_allowed_by_default(api_client, candidate, other_candidate):
    """The column default is true, and a missing privacy row must not block."""

    _connect(api_client, candidate, other_candidate)
    assert _open(api_client, candidate, other_candidate)["id"]


# --- the list, and IDOR ------------------------------------------------------


def test_the_list_starts_empty(api_client, candidate) -> None:
    page = api_client.get("/api/v1/conversations", headers=candidate.headers).json()

    assert page == {"items": [], "next_cursor": None, "has_more": False}


def test_a_member_sees_their_conversation(
    api_client, thread, candidate, other_candidate
) -> None:
    """Both members see it, and only their own view of it."""

    for account in (candidate, other_candidate):
        items = _conversations(api_client, account)
        assert [item["id"] for item in items] == [thread["id"]]


def test_an_unrelated_user_sees_nothing(api_client, thread, stranger) -> None:
    """C must not learn that A and B have a thread at all."""

    assert _conversations(api_client, stranger) == []


def test_the_list_never_includes_another_users_conversation(
    api_client, thread, stranger
) -> None:
    """Membership is a join, not a filter applied afterwards."""

    assert all(
        item["id"] != thread["id"]
        for item in _conversations(api_client, stranger)
    )


def test_the_list_is_newest_activity_first(
    api_client, db_session, candidate, other_candidate, stranger
) -> None:
    """Set the timestamps explicitly: ``now()`` is the *transaction* timestamp, so
    three rows written by one test would tie and the ordering would go untested."""

    _connect(api_client, candidate, other_candidate)
    first = _open(api_client, candidate, other_candidate)
    _connect(api_client, candidate, stranger)
    second = _open(api_client, candidate, stranger)

    _set_last_message(db_session, second["id"], "2024-06-01T00:00:00+00:00")
    _set_last_message(db_session, first["id"], "2024-01-01T00:00:00+00:00")

    assert [item["id"] for item in _conversations(api_client, candidate)] == [
        second["id"],
        first["id"],
    ]


def _set_last_message(db_session, conversation_id: str, iso: str) -> None:
    """Backdate a conversation's activity, because the API only moves it forward.

    Writes through ``db_session`` ? the very session the API dependency overrides
    to ? rather than opening a second connection, which would not see the rows this
    test has written and would not be rolled back with them.
    """

    conversation = db_session.get(Conversation, uuid.UUID(conversation_id))
    conversation.last_message_at = datetime.fromisoformat(iso)
    conversation.last_message_id = uuid.uuid4()
    db_session.commit()


def test_a_conversation_with_no_messages_sorts_last(
    api_client, thread, candidate, stranger
) -> None:
    """``NULLS LAST``: a fresh thread has no activity, so it belongs at the end."""

    _send(api_client, candidate, thread["id"], "hello")
    _connect(api_client, candidate, stranger)
    fresh = _open(api_client, candidate, stranger)

    items = _conversations(api_client, candidate)

    assert [item["id"] for item in items] == [thread["id"], fresh["id"]]
    assert items[-1]["last_message_at"] is None


# --- detail and IDOR ---------------------------------------------------------


def test_a_member_can_read_the_detail(api_client, thread, candidate) -> None:
    body = api_client.get(
        f"/api/v1/conversations/{thread['id']}", headers=candidate.headers
    ).json()

    assert body["id"] == thread["id"]
    assert body["created_by"] == candidate.id
    assert len(body["members"]) == 2


def test_an_unrelated_user_gets_404_not_403(api_client, thread, stranger) -> None:
    """404, not 403: a 403 would confirm the thread exists."""

    response = api_client.get(
        f"/api/v1/conversations/{thread['id']}", headers=stranger.headers
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("raw", ["nonsense", NOBODY])
def test_a_malformed_or_absent_conversation_id_is_404(
    api_client, candidate, raw
) -> None:
    """``parse_id`` makes the route no UUID-format oracle."""

    for path in (
        f"/api/v1/conversations/{raw}",
        f"/api/v1/conversations/{raw}/messages",
    ):
        response = api_client.get(path, headers=candidate.headers)
        assert response.status_code == 404, path


def test_another_members_conversation_is_404(api_client, thread, stranger) -> None:
    """A *real* id C is not in answers exactly like an id that does not exist."""

    real = api_client.get(
        f"/api/v1/conversations/{thread['id']}", headers=stranger.headers
    )
    absent = api_client.get(
        f"/api/v1/conversations/{NOBODY}", headers=stranger.headers
    )

    assert real.status_code == absent.status_code == 404
    assert real.json()["error"]["message"] == absent.json()["error"]["message"]


def test_an_unrelated_user_cannot_list_messages(api_client, thread, stranger) -> None:
    response = api_client.get(
        f"/api/v1/conversations/{thread['id']}/messages", headers=stranger.headers
    )

    assert response.status_code == 404


def test_an_unrelated_user_cannot_send(
    api_client, thread, candidate, stranger
) -> None:
    response = api_client.post(
        f"/api/v1/conversations/{thread['id']}/messages",
        json={"body": "let me in"},
        headers=stranger.headers,
    )

    assert response.status_code == 404
    assert _messages(api_client, candidate, thread["id"])["items"] == []


# --- sending -----------------------------------------------------------------


def test_a_member_can_send(api_client, thread, candidate) -> None:
    sent = _send(api_client, candidate, thread["id"], "Hello, is this role still open?")

    assert sent["id"]
    assert sent["conversation_id"] == thread["id"]
    assert sent["body"] == "Hello, is this role still open?"
    assert sent["sender"]["user_id"] == candidate.id
    assert sent["created_at"]
    assert sent["deleted_at"] is None
    assert sent["client_message_id"] is None


def test_the_sender_is_always_the_caller(api_client, thread, candidate, stranger):
    """The write model has no sender field, and ``extra="forbid"`` closes the door.

    The strongest form of "you cannot spoof a sender" is that there is nowhere to
    put one — not that the server politely ignores it.
    """

    response = api_client.post(
        f"/api/v1/conversations/{thread['id']}/messages",
        json={"body": "spoofed", "sender_id": stranger.id},
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text
    assert "sender_id" in response.text
    assert _messages(api_client, candidate, thread["id"])["items"] == []


def test_no_spelling_of_sender_is_accepted(
    api_client, thread, candidate, stranger
) -> None:
    """Not just ``sender_id``: there is no name for "who sent this" that works."""

    for field in ("sender_id", "sender_user_id", "from_user_id", "user_id"):
        response = api_client.post(
            f"/api/v1/conversations/{thread['id']}/messages",
            json={"body": "spoofed", field: stranger.id},
            headers=candidate.headers,
        )
        assert response.status_code == 422, field


def test_the_recipient_can_reply(api_client, thread, other_candidate) -> None:
    sent = _send(api_client, other_candidate, thread["id"], "Yes, send it over.")

    assert sent["sender"]["user_id"] == other_candidate.id


def test_an_unknown_field_on_a_message_is_422(
    api_client, thread, candidate
) -> None:
    """``created_at`` is server-owned; a client cannot backdate a message."""

    response = api_client.post(
        f"/api/v1/conversations/{thread['id']}/messages",
        json={"body": "hi", "created_at": "2020-01-01T00:00:00Z"},
        headers=candidate.headers,
    )

    assert response.status_code == 422


@pytest.mark.parametrize("body", ["", " ", "   ", "\n", "\t\t "])
def test_a_blank_message_is_422(api_client, thread, candidate, body) -> None:
    """Whitespace-only is refused, not stored as an empty bubble forever."""

    response = api_client.post(
        f"/api/v1/conversations/{thread['id']}/messages",
        json={"body": body},
        headers=candidate.headers,
    )

    assert response.status_code == 422, repr(body)
    assert _messages(api_client, candidate, thread["id"])["items"] == []


def test_a_body_at_the_limit_is_accepted(api_client, thread, candidate) -> None:
    sent = _send(api_client, candidate, thread["id"], "x" * MAX_BODY)

    assert len(sent["body"]) == MAX_BODY


def test_a_body_over_the_limit_is_422_not_truncated(
    api_client, thread, candidate
) -> None:
    """Over-limit must be refused outright. Silent truncation loses the message."""

    response = api_client.post(
        f"/api/v1/conversations/{thread['id']}/messages",
        json={"body": "x" * (MAX_BODY + 1)},
        headers=candidate.headers,
    )

    assert response.status_code == 422
    assert _messages(api_client, candidate, thread["id"])["items"] == []


def test_a_missing_body_is_422(api_client, thread, candidate) -> None:
    response = api_client.post(
        f"/api/v1/conversations/{thread['id']}/messages",
        json={},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_sending_advances_the_conversation_pointer(
    api_client, thread, candidate
) -> None:
    sent = _send(api_client, candidate, thread["id"], "first")

    body = api_client.get(
        f"/api/v1/conversations/{thread['id']}", headers=candidate.headers
    ).json()

    # `last_message` *is* the pointer: the read model carries the message rather
    # than a bare id that would need a second request to interpret.
    assert body["last_message"]["id"] == sent["id"]
    assert body["last_message_at"] is not None


# --- reading, ordering and pagination ----------------------------------------


def test_a_new_thread_has_no_messages(api_client, thread, candidate) -> None:
    page = _messages(api_client, candidate, thread["id"])

    assert page == {"items": [], "next_cursor": None, "has_more": False}


def test_messages_come_back_oldest_to_newest(
    api_client, db_session, thread, candidate, other_candidate
) -> None:
    """Ascending within the page, whatever order they were sent in."""

    sent = []
    for index in range(4):
        sent.append(_send(api_client, candidate, thread["id"], f"a{index}"))
        sent.append(_send(api_client, other_candidate, thread["id"], f"b{index}"))
    _pin_in_order(db_session, [item["id"] for item in sent])

    page = _messages(api_client, candidate, thread["id"])

    assert [item["body"] for item in page["items"]] == [
        "a0", "b0", "a1", "b1", "a2", "b2", "a3", "b3",
    ]


def test_ordering_is_deterministic_under_identical_timestamps(
    api_client, db_session, thread, candidate
) -> None:
    """The id tiebreak is what makes a thread stable, not the timestamps.

    Every message here is written in one transaction, so ``now()`` gives them all
    the same value. An ordering that relied on the timestamp alone would be
    arbitrary between two identical requests.
    """

    sent = [
        _send(api_client, candidate, thread["id"], f"m{index}") for index in range(5)
    ]
    # Pin every message to the *same* instant, so the id tiebreak is provably what
    # decides the order and two identical requests must agree.
    same = datetime(2024, 1, 1, tzinfo=UTC)
    for item in sent:
        db_session.get(Message, uuid.UUID(item["id"])).created_at = same
    db_session.commit()

    page = _messages(api_client, candidate, thread["id"])
    by_id = sorted(item["id"] for item in sent)

    assert [item["id"] for item in page["items"]] == by_id
    assert _messages(api_client, candidate, thread["id"])["items"] == page["items"]


def test_a_page_is_bounded_and_older_history_is_reachable(
    api_client, db_session, thread, candidate
) -> None:
    sent = [
        _send(api_client, candidate, thread["id"], f"m{index}") for index in range(5)
    ]
    _pin_in_order(db_session, [item["id"] for item in sent])

    first = _messages(api_client, candidate, thread["id"], limit=2)

    assert [item["body"] for item in first["items"]] == ["m3", "m4"]
    assert first["has_more"] is True
    assert first["next_cursor"]


def test_paging_backwards_covers_every_message_exactly_once(
    api_client, db_session, thread, candidate
) -> None:
    """No duplicates across pages, no gaps, and it terminates."""

    sent = [
        _send(api_client, candidate, thread["id"], f"m{index}") for index in range(7)
    ]
    _pin_in_order(db_session, [item["id"] for item in sent])

    pages: list[list[str]] = []
    cursor = None
    for _ in range(10):  # bounded: a broken cursor would loop forever
        params = {"limit": 3}
        if cursor:
            params["cursor"] = cursor
        page = _messages(api_client, candidate, thread["id"], **params)
        pages.append([item["body"] for item in page["items"]])
        if not page["has_more"]:
            break
        cursor = page["next_cursor"]

    # Every page is oldest-to-newest within itself...
    for page in pages:
        assert page == sorted(page, key=lambda b: int(b[1:]))
    # ...and walking backwards covers the whole thread exactly once.
    seen = [body for page in pages for body in page]
    assert sorted(seen, key=lambda b: int(b[1:])) == [f"m{i}" for i in range(7)]
    assert len(seen) == len(set(seen)), "a message appeared on two pages"


def test_a_page_within_bounds_and_no_more_is_flagged(
    api_client, thread, candidate
) -> None:
    _send(api_client, candidate, thread["id"], "only one")

    page = _messages(api_client, candidate, thread["id"], limit=2)

    assert page["has_more"] is False
    assert page["next_cursor"] is None
    assert len(page["items"]) == 1


@pytest.mark.parametrize("bogus", ["not-a-cursor", "YWJjZGVm", "!!!!"])
def test_a_forged_cursor_is_422(api_client, thread, candidate, bogus) -> None:
    """Answering an empty page would let a client loop forever on nonsense."""

    response = api_client.get(
        f"/api/v1/conversations/{thread['id']}/messages",
        params={"cursor": bogus},
        headers=candidate.headers,
    )

    assert response.status_code == 422, bogus
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("limit", [0, -1, 101, 10000])
def test_a_limit_outside_the_bounds_is_422(
    api_client, thread, candidate, limit
) -> None:
    response = api_client.get(
        f"/api/v1/conversations/{thread['id']}/messages",
        params={"limit": limit},
        headers=candidate.headers,
    )

    assert response.status_code == 422, limit


def test_the_conversation_list_pages_on_activity(
    api_client, db_session, thread, candidate, stranger
) -> None:
    _send(api_client, candidate, thread["id"], "a")
    _connect(api_client, candidate, stranger)
    second = _open(api_client, candidate, stranger)
    _set_last_message(db_session, second["id"], "2020-01-01T00:00:00+00:00")

    first = api_client.get(
        "/api/v1/conversations", params={"limit": 1}, headers=candidate.headers
    ).json()

    assert [item["id"] for item in first["items"]] == [thread["id"]]
    assert first["has_more"] is True
    assert first["next_cursor"]

    second_page = api_client.get(
        "/api/v1/conversations",
        params={"limit": 1, "cursor": first["next_cursor"]},
        headers=candidate.headers,
    ).json()

    assert [item["id"] for item in second_page["items"]] == [second["id"]]
    assert second_page["has_more"] is False


def test_an_empty_cursor_is_treated_as_absent(api_client, thread, candidate) -> None:
    """``?cursor=`` is what a string-built query produces for "no cursor"."""

    _send(api_client, candidate, thread["id"], "hello")

    response = api_client.get(
        f"/api/v1/conversations/{thread['id']}/messages",
        params={"cursor": ""},
        headers=candidate.headers,
    )

    assert response.status_code == 200, response.text
    assert [item["body"] for item in response.json()["items"]] == ["hello"]


# --- read state --------------------------------------------------------------


def test_a_new_conversation_has_nothing_unread(api_client, thread, candidate) -> None:
    assert _unread(api_client, candidate, thread["id"]) == 0


def test_a_received_message_is_unread_for_the_recipient(
    api_client, db_session, thread, candidate, other_candidate
) -> None:
    first = _send(api_client, candidate, thread["id"], "one")
    second = _send(api_client, candidate, thread["id"], "two")
    _pin_in_order(db_session, [first["id"], second["id"]])

    assert _unread(api_client, other_candidate, thread["id"]) == 2


def test_a_sender_does_not_see_their_own_message_as_unread(
    api_client, db_session, thread, candidate, other_candidate
) -> None:
    """You cannot unread what you just wrote ? but theirs still counts."""

    mine = _send(api_client, candidate, thread["id"], "mine")
    theirs = _send(api_client, other_candidate, thread["id"], "theirs")
    _pin_in_order(db_session, [mine["id"], theirs["id"]])

    assert _unread(api_client, candidate, thread["id"]) == 1, "theirs is unread"
    assert _unread(api_client, other_candidate, thread["id"]) == 1, "mine is unread"


def test_marking_read_clears_the_unread_count(
    api_client, db_session, thread, candidate, other_candidate
) -> None:
    first = _send(api_client, candidate, thread["id"], "one")
    second = _send(api_client, candidate, thread["id"], "two")
    _pin_in_order(db_session, [first["id"], second["id"]])

    marked = api_client.post(
        f"/api/v1/conversations/{thread['id']}/read",
        json={"message_id": second["id"]},
        headers=other_candidate.headers,
    )

    assert marked.status_code == 204
    assert marked.content == b""
    assert _unread(api_client, other_candidate, thread["id"]) == 0


def test_the_read_pointer_only_moves_forwards(
    api_client, db_session, thread, candidate, other_candidate
) -> None:
    """A stale client re-sending an old id must not un-read everything after it."""

    first = _send(api_client, candidate, thread["id"], "one")
    second = _send(api_client, candidate, thread["id"], "two")
    newest = _send(api_client, candidate, thread["id"], "three")
    _pin_in_order(db_session, [first["id"], second["id"], newest["id"]])

    api_client.post(
        f"/api/v1/conversations/{thread['id']}/read",
        json={"message_id": newest["id"]},
        headers=other_candidate.headers,
    )
    assert _unread(api_client, other_candidate, thread["id"]) == 0

    # Re-marking an older message must not resurrect the two after it.
    api_client.post(
        f"/api/v1/conversations/{thread['id']}/read",
        json={"message_id": first["id"]},
        headers=other_candidate.headers,
    )

    assert _unread(api_client, other_candidate, thread["id"]) == 0


def test_unread_counts_only_newer_messages(
    api_client, db_session, thread, candidate, other_candidate
) -> None:
    old_msg = _send(api_client, candidate, thread["id"], "old")
    second = _send(api_client, candidate, thread["id"], "new")
    newest = _send(api_client, candidate, thread["id"], "newest")
    _pin_in_order(db_session, [old_msg["id"], second["id"], newest["id"]])

    api_client.post(
        f"/api/v1/conversations/{thread['id']}/read",
        json={"message_id": second["id"]},
        headers=other_candidate.headers,
    )

    assert _unread(api_client, other_candidate, thread["id"]) == 1


def test_marking_read_a_message_from_another_conversation_is_404(
    api_client, thread, candidate, stranger
) -> None:
    """A message id must not be usable to poke at a thread the caller is not in."""

    _send(api_client, candidate, thread["id"], "mine")
    _connect(api_client, candidate, stranger)
    other = _open(api_client, candidate, stranger)
    theirs = _send(api_client, stranger, other["id"], "theirs")

    response = api_client.post(
        f"/api/v1/conversations/{thread['id']}/read",
        json={"message_id": theirs["id"]},
        headers=candidate.headers,
    )

    assert response.status_code == 404


def test_an_unrelated_user_cannot_mark_read(api_client, thread, stranger) -> None:
    response = api_client.post(
        f"/api/v1/conversations/{thread['id']}/read",
        json={"message_id": NOBODY},
        headers=stranger.headers,
    )

    assert response.status_code == 404


def test_mark_read_needs_a_message_id(api_client, thread, candidate) -> None:
    """§7.3 says "mark read **up to a point**" — a point is required."""

    response = api_client.post(
        f"/api/v1/conversations/{thread['id']}/read",
        json={},
        headers=candidate.headers,
    )

    assert response.status_code == 422


# --- soft delete -------------------------------------------------------------


def test_the_sender_can_soft_delete_its_message(api_client, thread, candidate) -> None:
    sent = _send(api_client, candidate, thread["id"], "oops, wrong chat")

    response = api_client.delete(
        f"/api/v1/messages/{sent['id']}", headers=candidate.headers
    )

    assert response.status_code == 204
    assert response.content == b""


def test_a_deleted_message_becomes_a_tombstone_that_keeps_its_place(
    api_client, db_session, thread, candidate, other_candidate
) -> None:
    """§14.6: the row keeps its slot. It must not vanish and reorder the thread."""

    first = _send(api_client, candidate, thread["id"], "keep me")
    middle = _send(api_client, candidate, thread["id"], "delete me")
    last = _send(api_client, candidate, thread["id"], "keep me too")
    _pin_in_order(db_session, [first["id"], middle["id"], last["id"]])

    api_client.delete(f"/api/v1/messages/{middle['id']}", headers=candidate.headers)

    items = _messages(api_client, other_candidate, thread["id"])["items"]

    assert [item["id"] for item in items] == [first["id"], middle["id"], last["id"]]
    assert items[1]["body"] is None, "the deleted text must not be served"
    assert items[1]["deleted_at"] is not None
    assert items[0]["body"] == "keep me"
    assert items[2]["body"] == "keep me too"


def test_a_member_cannot_delete_a_message_they_did_not_send(
    api_client, thread, candidate, other_candidate
) -> None:
    """Only the sender. B is *in* the thread and may not delete A's words."""

    sent = _send(api_client, candidate, thread["id"], "A's message")

    response = api_client.delete(
        f"/api/v1/messages/{sent['id']}", headers=other_candidate.headers
    )

    assert response.status_code == 404
    assert (
        _messages(api_client, other_candidate, thread["id"])["items"][0]["body"]
        == "A's message"
    )


def test_an_unrelated_user_cannot_delete(
    api_client, thread, candidate, stranger
) -> None:
    sent = _send(api_client, candidate, thread["id"], "private")

    response = api_client.delete(
        f"/api/v1/messages/{sent['id']}", headers=stranger.headers
    )

    assert response.status_code == 404
    assert (
        _messages(api_client, candidate, thread["id"])["items"][0]["body"] == "private"
    )


@pytest.mark.parametrize("raw", ["nonsense", NOBODY])
def test_a_malformed_message_id_is_404(api_client, candidate, raw) -> None:
    response = api_client.delete(f"/api/v1/messages/{raw}", headers=candidate.headers)

    assert response.status_code == 404


def test_deleting_twice_is_a_no_op(api_client, thread, candidate) -> None:
    sent = _send(api_client, candidate, thread["id"], "oops")

    first = api_client.delete(
        f"/api/v1/messages/{sent['id']}", headers=candidate.headers
    )
    second = api_client.delete(
        f"/api/v1/messages/{sent['id']}", headers=candidate.headers
    )

    assert first.status_code == 204
    assert second.status_code == 204
    item = _messages(api_client, candidate, thread["id"])["items"][0]
    assert item["body"] is None
    assert item["deleted_at"] is not None


def test_a_tombstone_is_still_counted_as_read_by_the_others(
    api_client, thread, candidate, other_candidate
) -> None:
    """Deleting is not a way to make a message unread again."""

    sent = _send(api_client, candidate, thread["id"], "one")
    api_client.post(
        f"/api/v1/conversations/{thread['id']}/read",
        json={"message_id": sent["id"]},
        headers=other_candidate.headers,
    )
    api_client.delete(f"/api/v1/messages/{sent['id']}", headers=candidate.headers)

    assert _unread(api_client, other_candidate, thread["id"]) == 0


# --- concurrency and race handling -------------------------------------------


def test_rapid_sends_leave_the_pointer_on_the_newest(
    api_client, db_session, thread, candidate
) -> None:
    """The activity pointer only ever moves forwards.

    Messages committed in the same instant can finish out of order, so the
    comparison is ``>=`` rather than ``>``: a later-arriving *older* message must
    not drag the conversation back to it.
    """

    sent = [
        _send(api_client, candidate, thread["id"], f"m{index}") for index in range(5)
    ]
    _pin_in_order(db_session, [item["id"] for item in sent])

    body = api_client.get(
        f"/api/v1/conversations/{thread['id']}", headers=candidate.headers
    ).json()
    newest = _messages(api_client, candidate, thread["id"])["items"][-1]

    # The pointer names the newest message. Its own timestamp was written at send
    # time, before this test backdated the rows, so it is not comparable here.
    assert body["last_message"]["id"] == newest["id"]


def test_the_pointer_always_names_a_message_in_the_conversation(
    api_client, db_session, thread, candidate, other_candidate
) -> None:
    sent = [
        _send(api_client, candidate, thread["id"], f"m{index}") for index in range(4)
    ]
    _pin_in_order(db_session, [item["id"] for item in sent])

    for account in (candidate, other_candidate):
        body = api_client.get(
            f"/api/v1/conversations/{thread['id']}", headers=account.headers
        ).json()
        assert body["last_message"]["conversation_id"] == thread["id"]


def test_a_racing_duplicate_conversation_returns_the_winner(
    api_client, thread, candidate, other_candidate, db_session, monkeypatch
) -> None:
    """Force the application check to miss, and prove the index catches the race.

    Two clients can both ask "does a conversation exist?" and both hear no. This
    stubs the *pre-write* lookup only; the unique index is the real guard, and the
    loser gets the winner's row rather than a 500.
    """

    from app.services import messaging as messaging_service

    real_lookup = messaging_service._load_by_direct_key
    seen = {"n": 0}

    def _misses_the_first_time_only(*args, **kwargs):
        """Simulate the race: the pre-write lookup misses, recovery finds it."""

        seen["n"] += 1
        return None if seen["n"] == 1 else real_lookup(*args, **kwargs)

    monkeypatch.setattr(
        messaging_service, "_load_by_direct_key", _misses_the_first_time_only
    )

    response = api_client.post(
        "/api/v1/conversations",
        json={"user_id": other_candidate.id},
        headers=candidate.headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["id"] == thread["id"]
    assert len(_rows(db_session, Conversation)) == 1
    assert len(_rows(db_session, ConversationMember)) == 2


# --- the database is the real guard -----------------------------------------


def test_the_database_refuses_a_duplicate_direct_key(
    api_client, thread, candidate, db_session
) -> None:
    """Two threads for one pair is what §7.4 forbids, and it is a data rule."""

    first = db_session.get(Conversation, uuid.UUID(thread["id"]))
    db_session.add(
        Conversation(created_by=uuid.UUID(candidate.id), direct_key=first.direct_key)
    )

    with pytest.raises(REJECTION_ERRORS):
        db_session.commit()
    db_session.rollback()


def test_the_database_refuses_a_duplicate_client_message_id(
    api_client, thread, candidate, db_session
) -> None:
    sent = _send(
        api_client, candidate, thread["id"], "once", client_message_id="dup-key"
    )

    db_session.add(
        Message(
            conversation_id=uuid.UUID(thread["id"]),
            sender_id=uuid.UUID(candidate.id),
            body="twice",
            client_message_id="dup-key",
        )
    )

    with pytest.raises(REJECTION_ERRORS):
        db_session.commit()
    db_session.rollback()
    assert [row.id for row in _rows(db_session, Message)] == [uuid.UUID(sent["id"])]


def test_the_database_allows_many_unkeyed_messages(
    api_client, thread, candidate, db_session
) -> None:
    """NULLs are distinct in a unique index — the reason the rule is usable at all."""

    for index in range(3):
        _send(api_client, candidate, thread["id"], f"m{index}")
    db_session.add(
        Message(
            conversation_id=uuid.UUID(thread["id"]),
            sender_id=uuid.UUID(candidate.id),
            body="a fourth",
        )
    )
    db_session.commit()

    assert len(_rows(db_session, Message)) == 4


def test_a_duplicate_membership_row_is_impossible(
    api_client, thread, db_session
) -> None:
    """The composite primary key *is* the membership rule."""

    db_session.add(
        ConversationMember(
            conversation_id=uuid.UUID(thread["id"]),
            user_id=uuid.UUID(thread["created_by"]),
        )
    )

    with pytest.raises(REJECTION_ERRORS):
        db_session.commit()
    db_session.rollback()


def test_an_account_with_messages_cannot_be_hard_deleted(
    api_client, thread, candidate, other_candidate, db_session
) -> None:
    """``sender_id`` is RESTRICT: an account deletion must not silently remove a
    conversation somebody else is still reading."""

    sent = _send(api_client, candidate, thread["id"], "still here")

    db_session.delete(db_session.get(User, uuid.UUID(candidate.id)))

    with pytest.raises(REJECTION_ERRORS):
        db_session.commit()
    db_session.rollback()

    # The thread and its words are untouched.
    items = _messages(api_client, other_candidate, thread["id"])["items"]
    assert [item["id"] for item in items] == [sent["id"]]
    assert items[0]["body"] == "still here"


def test_deleting_a_conversation_cascades_to_its_messages(
    api_client, thread, candidate, db_session
) -> None:
    """A conversation has no meaning without its messages, so CASCADE is right."""

    _send(api_client, candidate, thread["id"], "goes away too")

    db_session.delete(db_session.get(Conversation, uuid.UUID(thread["id"])))
    db_session.commit()

    assert _rows(db_session, Message) == []
    assert _rows(db_session, ConversationMember) == []


# --- privacy -----------------------------------------------------------------


def test_a_message_exposes_no_private_fields(
    api_client, thread, candidate
) -> None:
    """The sender is the minimal ``UserSummary``; there is no field to leak.

    A message is the most exposed object in the product, so this asserts the shape
    rather than trusting it. If a field were ever added to ``UserSummary`` it would
    appear in every conversation row too — which is why the set is checked exactly.
    """

    sent = _send(api_client, candidate, thread["id"], "hello")

    assert set(sent) == {
        "id",
        "conversation_id",
        "sender",
        "body",
        "client_message_id",
        "created_at",
        "edited_at",
        "deleted_at",
    }
    assert set(sent["sender"]) == {
        "user_id",
        "public_id",
        "username",
        "name",
        "role",
        "avatar_url",
    }
    text = str(sent).lower()
    for forbidden in (
        "email",
        "phone",
        "password",
        "argon2",
        "headline",
        "summary",
    ):
        assert forbidden not in text, forbidden


def test_conversation_members_expose_no_private_fields(
    api_client, thread, candidate
) -> None:
    detail = api_client.get(
        f"/api/v1/conversations/{thread['id']}", headers=candidate.headers
    ).json()

    for member in detail["members"]:
        assert set(member) == {
            "user_id",
            "public_id",
            "username",
            "name",
            "role",
            "avatar_url",
        }
    assert "email" not in str(detail).lower()


def test_a_private_profile_does_not_change_a_message(
    api_client, thread, candidate, other_candidate
) -> None:
    """Byte-identical before and after the sender tightens their privacy.

    Not a test that privacy is honoured — a test that this endpoint is
    structurally incapable of ignoring it, because those fields are not in the
    response shape at all.
    """

    before = _send(api_client, candidate, thread["id"], "unchanged")

    api_client.put(
        "/api/v1/profile/privacy",
        json={
            "profile_visibility": "private",
            "discoverable": False,
            "allow_messages": True,
            "show_email": False,
            "show_phone": False,
        },
        headers=candidate.headers,
    )

    items = _messages(api_client, other_candidate, thread["id"])["items"]

    assert items[0] == before
