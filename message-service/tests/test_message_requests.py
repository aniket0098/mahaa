"""The message-request workflow — create, list, count, accept, reject.

Everything in §3.2 of the phase brief lives here: recipient-only
authorization, transactional state transitions, 409 on an already-resolved
request, duplicate/concurrent creates converging on one row, and visibility
scoped to the intended recipient.

These tests need a local PostgreSQL (see ``conftest.py``); they skip with the
command that would fix them when there is none, and never hide a skip as a
pass.
"""

from __future__ import annotations

import uuid

import pytest
from conftest import REJECTION_ERRORS, headers_for

from app.models import MessageRequest, MessageRequestStatus

# --- helpers ---------------------------------------------------------------


def _create(api_client, sender, recipient, note=None, expect=201):
    body: dict = {"recipient_id": str(recipient)}
    if note is not None:
        body["note"] = note
    response = api_client.post(
        "/api/v1/message-requests", json=body, headers=headers_for(sender)
    )
    assert response.status_code == expect, response.text
    return response.json()


def _count(api_client, account) -> int:
    response = api_client.get(
        "/api/v1/message-requests/count", headers=headers_for(account)
    )
    assert response.status_code == 200, response.text
    return response.json()["pending"]


def _list(api_client, account, **params) -> dict:
    response = api_client.get(
        "/api/v1/message-requests", params=params or None, headers=headers_for(account)
    )
    assert response.status_code == 200, response.text
    return response.json()


def _respond(api_client, account, request_id, action, expect=200):
    response = api_client.post(
        f"/api/v1/message-requests/{request_id}/{action}",
        headers=headers_for(account),
    )
    assert response.status_code == expect, response.text
    return response.json() if expect != 204 else None


# --- create ----------------------------------------------------------------


def test_create_returns_201_with_the_real_sender_summary(
    api_client, user_factory
) -> None:
    sender = user_factory(name="Ada Lovelace", designation="Analyst")
    recipient = user_factory(name="Grace Hopper")

    created = _create(api_client, sender, recipient, note="Hi, a quick question")

    assert created["status"] == "pending"
    assert created["note"] == "Hi, a quick question"
    assert created["responded_at"] is None
    # The sender block is what the request card renders — real identity fields
    # read from `users`, never invented by the client.
    assert created["sender"]["name"] == "Ada Lovelace"
    assert created["sender"]["designation"] == "Analyst"
    assert created["sender"]["user_id"] == str(sender)
    assert created["sender"]["public_id"].startswith("MJ-")


def test_create_is_idempotent_while_pending_and_never_duplicates(
    api_client, user_factory
) -> None:
    """The double-tap case: 201 the first time, 200 with the *same* record
    afterwards, and exactly one row — the partial unique index is what makes
    two simultaneous creates converge rather than race."""

    sender = user_factory()
    recipient = user_factory()

    first = _create(api_client, sender, recipient, note="Hello")
    second = _create(api_client, sender, recipient, note="Hello again", expect=200)

    assert second["id"] == first["id"]
    assert _count(api_client, recipient) == 1


def test_self_request_is_422_with_a_field_error(api_client, user_factory) -> None:
    me = user_factory()
    response = api_client.post(
        "/api/v1/message-requests",
        json={"recipient_id": str(me)},
        headers=headers_for(me),
    )

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert any(detail["field"] == "body.recipient_id" for detail in error["details"])


def test_unknown_recipient_is_404(api_client, user_factory) -> None:
    sender = user_factory()
    response = api_client.post(
        "/api/v1/message-requests",
        json={"recipient_id": str(uuid.uuid4())},
        headers=headers_for(sender),
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_whitespace_note_is_refused_rather_than_stored(api_client, user_factory) -> None:
    sender = user_factory()
    recipient = user_factory()
    response = api_client.post(
        "/api/v1/message-requests",
        json={"recipient_id": str(recipient), "note": "   "},
        headers=headers_for(sender),
    )

    assert response.status_code == 422


def test_a_sender_id_in_the_body_is_422_not_a_silently_ignored_key(
    api_client, user_factory
) -> None:
    """There is no field that can name the sender; `extra=forbid` makes one a
    422 instead of an impersonation."""

    sender = user_factory()
    victim = user_factory()
    recipient = user_factory()
    response = api_client.post(
        "/api/v1/message-requests",
        json={"recipient_id": str(recipient), "sender_id": str(victim)},
        headers=headers_for(sender),
    )

    assert response.status_code == 422


def test_limit_below_one_is_422(api_client, user_factory) -> None:
    account = user_factory()
    response = api_client.get(
        "/api/v1/message-requests",
        params={"limit": 0},
        headers=headers_for(account),
    )

    assert response.status_code == 422


# --- visibility and counts -------------------------------------------------


def test_only_the_recipient_sees_the_request_and_the_count(
    api_client, user_factory
) -> None:
    sender = user_factory(name="Ada Lovelace")
    recipient = user_factory(name="Grace Hopper")

    created = _create(api_client, sender, recipient, note="Hello")

    mine = _list(api_client, recipient)
    assert [item["id"] for item in mine["items"]] == [created["id"]]
    assert mine["pending_count"] == 1

    theirs = _list(api_client, sender)
    assert theirs["items"] == []
    assert theirs["pending_count"] == 0

    assert _count(api_client, recipient) == 1
    assert _count(api_client, sender) == 0


def test_count_is_derived_from_the_server_not_from_the_page(
    api_client, user_factory
) -> None:
    """The tab badge must survive pagination: three pending requests report 3
    even when one page holds a single item."""

    recipient = user_factory()
    for _ in range(3):
        _create(api_client, user_factory(), recipient)

    page = _list(api_client, recipient, limit=1)

    assert len(page["items"]) == 1
    assert page["pending_count"] == 3
    assert _count(api_client, recipient) == 3


# --- accept / reject -------------------------------------------------------


def test_accept_settles_the_request_for_the_recipient_and_updates_the_count(
    api_client, user_factory
) -> None:
    sender = user_factory()
    recipient = user_factory()
    created = _create(api_client, sender, recipient)

    resolved = _respond(api_client, recipient, created["id"], "accept")

    assert resolved["status"] == "accepted"
    assert resolved["responded_at"] is not None
    assert _count(api_client, recipient) == 0
    # It leaves the pending list and lands in the accepted one — the client
    # refreshes both from real state, never from an optimistic guess.
    assert _list(api_client, recipient)["items"] == []
    accepted = _list(api_client, recipient, status="accepted")
    assert [item["id"] for item in accepted["items"]] == [created["id"]]


def test_reject_settles_the_request_and_updates_the_count(
    api_client, user_factory
) -> None:
    sender = user_factory()
    recipient = user_factory()
    created = _create(api_client, sender, recipient)

    resolved = _respond(api_client, recipient, created["id"], "reject")

    assert resolved["status"] == "rejected"
    assert resolved["responded_at"] is not None
    assert _count(api_client, recipient) == 0


def test_a_second_answer_is_409_and_changes_nothing(api_client, user_factory) -> None:
    """The duplicate-action case: a double tap, or a stale list re-sent, gets
    a conflict — never a silent second transition."""

    sender = user_factory()
    recipient = user_factory()
    created = _create(api_client, sender, recipient)

    _respond(api_client, recipient, created["id"], "accept")
    response = api_client.post(
        f"/api/v1/message-requests/{created['id']}/accept",
        headers=headers_for(recipient),
    )

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "conflict"
    assert "already accepted" in error["message"].lower()
    # Still accepted, still exactly once.
    accepted = _list(api_client, recipient, status="accepted")
    assert [item["id"] for item in accepted["items"]] == [created["id"]]


def test_reject_after_accept_is_409(api_client, user_factory) -> None:
    sender = user_factory()
    recipient = user_factory()
    created = _create(api_client, sender, recipient)
    _respond(api_client, recipient, created["id"], "accept")

    response = api_client.post(
        f"/api/v1/message-requests/{created['id']}/reject",
        headers=headers_for(recipient),
    )

    assert response.status_code == 409


# --- authorization ---------------------------------------------------------


def test_a_stranger_cannot_accept_and_gets_the_same_404_as_a_missing_id(
    api_client, user_factory
) -> None:
    """404, never 403: a 403 would confirm the id exists."""

    sender = user_factory()
    recipient = user_factory()
    stranger = user_factory()
    created = _create(api_client, sender, recipient)

    response = api_client.post(
        f"/api/v1/message-requests/{created['id']}/accept",
        headers=headers_for(stranger),
    )
    missing = api_client.post(
        f"/api/v1/message-requests/{uuid.uuid4()}/accept",
        headers=headers_for(stranger),
    )

    assert response.status_code == 404
    assert missing.status_code == 404
    assert response.json()["error"]["message"] == missing.json()["error"]["message"]
    # And nothing changed: the real recipient still has it.
    assert _count(api_client, recipient) == 1


def test_the_sender_cannot_accept_their_own_request(api_client, user_factory) -> None:
    sender = user_factory()
    recipient = user_factory()
    created = _create(api_client, sender, recipient)

    response = api_client.post(
        f"/api/v1/message-requests/{created['id']}/accept",
        headers=headers_for(sender),
    )

    assert response.status_code == 404
    assert _count(api_client, recipient) == 1


def test_a_malformed_id_is_404_not_422(api_client, user_factory) -> None:
    account = user_factory()
    response = api_client.post(
        "/api/v1/message-requests/not-a-uuid/accept", headers=headers_for(account)
    )

    assert response.status_code == 404


# --- database backstops ----------------------------------------------------


def test_the_schema_refuses_a_duplicate_pending_pair(db_session, user_factory) -> None:
    """The constraint that settles a true race: whatever the service layer
    misses, the database still cannot hold two pending rows for one pair."""

    sender = user_factory()
    recipient = user_factory()
    db_session.add(MessageRequest(sender_id=sender, recipient_id=recipient, note="one"))
    db_session.flush()

    db_session.add(MessageRequest(sender_id=sender, recipient_id=recipient, note="two"))
    with pytest.raises(REJECTION_ERRORS):
        db_session.flush()
    db_session.rollback()


def test_the_schema_refuses_a_self_request(db_session, user_factory) -> None:
    me = user_factory()
    db_session.add(MessageRequest(sender_id=me, recipient_id=me))

    with pytest.raises(REJECTION_ERRORS):
        db_session.flush()
    db_session.rollback()


def test_the_schema_refuses_pending_with_a_responded_timestamp(
    db_session, user_factory
) -> None:
    """The CHECK that keeps `status` and `responded_at` from ever disagreeing,
    no matter which code path writes the row."""

    sender = user_factory()
    recipient = user_factory()
    db_session.add(
        MessageRequest(
            sender_id=sender,
            recipient_id=recipient,
            status=MessageRequestStatus.PENDING.value,
            responded_at="2026-10-09T00:00:00+00:00",
        )
    )

    with pytest.raises(REJECTION_ERRORS):
        db_session.flush()
    db_session.rollback()


def test_the_schema_refuses_an_unknown_status(db_session, user_factory) -> None:
    sender = user_factory()
    recipient = user_factory()
    db_session.add(MessageRequest(sender_id=sender, recipient_id=recipient, status="maybe"))

    with pytest.raises(REJECTION_ERRORS):
        db_session.flush()
    db_session.rollback()
