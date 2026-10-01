"""Phase 4 — connections. The A/B/C triangle on every rule.

Every security test here uses three accounts — A, B and an unrelated C — because
a test with one account cannot tell a working ownership check from a missing one.
There is nothing to steal if nobody else exists.

The naming is deliberate and used throughout: **A** sends the request, **B** is the
addressee, **C** is a stranger who must never be able to touch the row. The
service's own docstring explains why a wrong participant is a 404 and not a 403.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models import Connection
from app.models.enums import ConnectionStatus
from app.services import connections as svc
from tests.conftest import REJECTION_ERRORS, register

#: Nobody's connection. Used only where authentication or participation is decided
#: before the id is ever looked up.
NOBODY = str(uuid.UUID(int=0))

CONNECTION_ROUTES = [
    ("get", "/api/v1/connections", None),
    ("post", "/api/v1/connections", {"user_id": NOBODY}),
    ("post", f"/api/v1/connections/{NOBODY}/accept", None),
    ("post", f"/api/v1/connections/{NOBODY}/decline", None),
    ("post", f"/api/v1/connections/{NOBODY}/cancel", None),
    ("delete", f"/api/v1/connections/{NOBODY}", None),
]

ROUTE_IDS = [f"{method.upper()} {path}" for method, path, _ in CONNECTION_ROUTES]

VERBS = ["accept", "decline", "cancel"]


# --- helpers -----------------------------------------------------------------


def _call(api_client, method: str, path: str, body=None, headers=None):
    kwargs = {} if headers is None else {"headers": headers}
    if body is not None:
        kwargs["json"] = body
    return getattr(api_client, method)(path, **kwargs)


def _send(api_client, sender, target) -> dict:
    """Create a pending request, asserting 201 so a caller cannot forget to check."""

    response = _send_raw(api_client, sender, target)
    assert response.status_code == 201, response.text
    return response.json()


def _send_raw(api_client, sender, target):
    return api_client.post(
        "/api/v1/connections",
        json={"user_id": target.id},
        headers=sender.headers,
    )


def _verb(api_client, account, connection_id: str, verb: str):
    return api_client.post(
        f"/api/v1/connections/{connection_id}/{verb}", headers=account.headers
    )


def _mine(api_client, account, status: str | None = None) -> list[dict]:
    response = api_client.get(
        "/api/v1/connections",
        params={"status": status} if status else None,
        headers=account.headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


def _rows(db_session) -> list[Connection]:
    return list(db_session.scalars(select(Connection)))


def _answered_now():
    """A settled timestamp, for rows written straight to the database.

    Aware, because the column is ``timestamptz`` and a naive value would mean a
    different instant depending on the session's timezone.
    """

    return datetime.now(UTC)


@pytest.fixture()
def stranger(api_client) -> object:
    """User C. The account that must never be able to touch A↔B."""

    return register(api_client, f"stranger.{uuid.uuid4().hex[:12]}@example.com")


# --- authentication ----------------------------------------------------------


@pytest.mark.parametrize("method,path,body", CONNECTION_ROUTES, ids=ROUTE_IDS)
def test_every_connection_route_needs_a_token(api_client, method, path, body) -> None:
    response = _call(api_client, method, path, body)

    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "not_authenticated"


def test_a_forged_token_is_rejected(api_client) -> None:
    """A token that does not verify must be a 401, on every verb."""

    headers = {"Authorization": "Bearer not-a-real-token"}

    assert api_client.get("/api/v1/connections", headers=headers).status_code == 401
    create = api_client.post(
        "/api/v1/connections",
        json={"user_id": str(uuid.uuid4())},
        headers=headers,
    )
    assert create.status_code == 401
    for verb in VERBS:
        response = api_client.post(
            f"/api/v1/connections/{NOBODY}/{verb}", headers=headers
        )
        assert response.status_code == 401, verb


def test_a_candidate_may_use_connections(api_client, candidate) -> None:
    assert _mine(api_client, candidate) == []


def test_an_employer_may_connect(api_client, employer) -> None:
    """Not candidate-only: a recruiter connecting with a candidate is the point.

    The Phase 3 profile routes are candidate-only because an education timeline is
    a candidate record. A relationship is not, so ``/connections`` uses
    ``CurrentUser`` and an employer is refused by nothing here.
    """

    assert _mine(api_client, employer) == []


def test_a_college_may_connect(api_client) -> None:
    college = register(
        api_client, f"college.{uuid.uuid4().hex[:12]}@example.com", role="college"
    )

    assert _mine(api_client, college) == []


# --- send --------------------------------------------------------------------


def test_sending_a_request_creates_it(api_client, candidate, other_candidate) -> None:
    created = _send(api_client, candidate, other_candidate)

    assert created["id"]
    assert created["status"] == "pending"
    # The caller's own side of the request. The server sends this so the client
    # never has to infer it from a user id.
    assert created["is_outgoing"] is True
    # `user` is the *other* person, never the caller.
    assert created["user"]["user_id"] == other_candidate.id
    assert created["user"]["public_id"] == other_candidate.body["public_id"]
    assert created["user"]["name"] == other_candidate.body["name"]
    assert created["responded_at"] is None
    assert created["created_at"]


def test_the_recipient_sees_the_same_row_as_incoming(
    api_client, candidate, other_candidate
) -> None:
    sent = _send(api_client, candidate, other_candidate)

    theirs = _mine(api_client, other_candidate)

    assert len(theirs) == 1
    assert theirs[0]["id"] == sent["id"]
    # Same row, opposite direction — this is the field that decides which buttons
    # the client may draw, and it must differ per viewer, not per row.
    assert theirs[0]["is_outgoing"] is False
    assert theirs[0]["user"]["user_id"] == candidate.id


def test_an_unknown_target_is_404(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/connections",
        json={"user_id": str(uuid.uuid4())},
        headers=candidate.headers,
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert _mine(api_client, candidate) == []


def test_a_malformed_user_id_is_422(api_client, candidate) -> None:
    """A body field, so the failure names the field rather than 404-ing a UUID."""

    response = api_client.post(
        "/api/v1/connections",
        json={"user_id": "not-a-uuid"},
        headers=candidate.headers,
    )

    assert response.status_code == 422
    assert "user_id" in response.text


def test_a_self_request_is_422_not_a_database_error(
    api_client, candidate
) -> None:
    """Prefer a business error the form can render over a CHECK violation.

    The database would also refuse it — ``requester_id <> addressee_id`` — but as
    an integrity error from inside the transaction, which the client would show as
    a server fault.
    """

    response = api_client.post(
        "/api/v1/connections",
        json={"user_id": candidate.id},
        headers=candidate.headers,
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert "body.user_id" in response.text
    assert _mine(api_client, candidate) == []


def test_a_missing_body_is_422(api_client, candidate) -> None:
    assert (
        api_client.post("/api/v1/connections", headers=candidate.headers).status_code
        == 422
    )


def test_an_unknown_field_is_422(api_client, candidate, other_candidate) -> None:
    """`extra="forbid"`: a client cannot smuggle a status in through the body."""

    response = api_client.post(
        "/api/v1/connections",
        json={"user_id": other_candidate.id, "status": "accepted"},
        headers=candidate.headers,
    )

    assert response.status_code == 422
    assert _mine(api_client, candidate) == []


def test_a_public_id_is_not_accepted_as_a_target(
    api_client, candidate, other_candidate
) -> None:
    """``user_id`` is the internal id; a handle is an input that finds a person."""

    response = api_client.post(
        "/api/v1/connections",
        json={"user_id": other_candidate.body["public_id"]},
        headers=candidate.headers,
    )

    assert response.status_code == 422


# --- duplicates, reverse direction, revive -----------------------------------


def test_a_duplicate_request_is_idempotent(
    api_client, db_session, candidate, other_candidate
) -> None:
    """A double tap is not a second relationship, and not an error either.

    200 rather than 201: nothing was created. A 201 would tell the client it made
    something new when the row it already holds is the one it gets back.
    """

    first = _send(api_client, candidate, other_candidate)

    repeat = _send_raw(api_client, candidate, other_candidate)

    assert repeat.status_code == 200, repeat.text
    assert repeat.json()["id"] == first["id"]
    assert len(_rows(db_session)) == 1
    assert len(_mine(api_client, candidate)) == 1


def test_a_reverse_request_is_409(api_client, candidate, other_candidate) -> None:
    """B answering A's request is Accept or Decline, not a second request.

    Silently reversing the row would rewrite A's *outgoing* request into B's,
    which is not B's decision to make.
    """

    _send(api_client, candidate, other_candidate)

    reverse = _send_raw(api_client, other_candidate, candidate)

    assert reverse.status_code == 409
    assert reverse.json()["error"]["code"] == "conflict"
    # A's request is untouched, and still outgoing for A.
    assert _mine(api_client, candidate)[0]["is_outgoing"] is True
    assert _mine(api_client, other_candidate)[0]["is_outgoing"] is False


def test_an_accepted_connection_cannot_be_re_requested(
    api_client, candidate, other_candidate
) -> None:
    """Two connected people sending a request is a conflict, not a downgrade."""

    sent = _send(api_client, candidate, other_candidate)
    assert _verb(api_client, other_candidate, sent["id"], "accept").status_code == 200

    again = _send_raw(api_client, candidate, other_candidate)

    assert again.status_code == 409
    assert _mine(api_client, candidate)[0]["status"] == "accepted"


def test_a_declined_request_can_be_revived(
    api_client, candidate, other_candidate
) -> None:
    """One row for the pair, for its whole life (§6.2) — revived, not re-inserted."""

    sent = _send(api_client, candidate, other_candidate)
    assert _verb(api_client, other_candidate, sent["id"], "decline").status_code == 200

    revived = _send_raw(api_client, candidate, other_candidate)

    assert revived.status_code == 200, revived.text
    body = revived.json()
    assert body["id"] == sent["id"], "the pair must keep the same row"
    assert body["status"] == "pending"
    assert body["is_outgoing"] is True
    assert body["responded_at"] is None, "a revived request is unanswered again"


def test_a_revive_flips_the_direction_to_whoever_is_asking(
    api_client, candidate, other_candidate
) -> None:
    """B sent, A declined; A asking later makes A the requester.

    This is the case where reviving has to *move* the roles, not just the status —
    otherwise A would be handed an "incoming" request that is really A's own.
    """

    sent = _send(api_client, other_candidate, candidate)
    assert _verb(api_client, candidate, sent["id"], "decline").status_code == 200

    revived = _send_raw(api_client, candidate, other_candidate)

    assert revived.status_code == 200
    assert revived.json()["is_outgoing"] is True
    assert _mine(api_client, candidate)[0]["is_outgoing"] is True
    assert _mine(api_client, other_candidate)[0]["is_outgoing"] is False


def test_a_canceled_request_can_be_revived(
    api_client, candidate, other_candidate
) -> None:
    sent = _send(api_client, candidate, other_candidate)
    assert _verb(api_client, candidate, sent["id"], "cancel").status_code == 200

    revived = _send_raw(api_client, candidate, other_candidate)

    assert revived.status_code == 200
    assert revived.json()["id"] == sent["id"]
    assert revived.json()["status"] == "pending"


def test_only_one_row_ever_exists_for_a_pair(
    api_client, db_session, candidate, other_candidate
) -> None:
    """A and B thrash the state machine; the pair must still be one row."""

    sent = _send(api_client, candidate, other_candidate)
    _verb(api_client, candidate, sent["id"], "cancel")
    _send_raw(api_client, candidate, other_candidate)
    _verb(api_client, other_candidate, sent["id"], "decline")
    _send_raw(api_client, other_candidate, candidate)

    assert len(_mine(api_client, candidate)) == 1
    assert len(_mine(api_client, other_candidate)) == 1
    assert len(_rows(db_session)) == 1


# --- list --------------------------------------------------------------------


def test_the_list_is_a_bare_array(api_client, candidate, other_candidate) -> None:
    """§17 lists ``/connections`` among the endpoints that use one, and
    ``listConnections`` is typed ``Promise<Connection[]>`` — there is nowhere to put
    a ``total`` on the client side either."""

    _send(api_client, candidate, other_candidate)

    body = api_client.get("/api/v1/connections", headers=candidate.headers).json()

    assert isinstance(body, list)
    assert len(body) == 1


def test_the_list_holds_both_directions(api_client, candidate, other_candidate) -> None:
    """Which is why ``/connections/requests`` and ``/connections/sent`` are not
    built: one list plus ``is_outgoing`` is the whole of it."""

    _send(api_client, candidate, other_candidate)

    outgoing = _mine(api_client, candidate, "pending")
    incoming = _mine(api_client, other_candidate, "pending")

    assert [row["is_outgoing"] for row in outgoing] == [True]
    assert [row["is_outgoing"] for row in incoming] == [False]
    assert outgoing[0]["id"] == incoming[0]["id"]


def test_an_unrelated_user_sees_an_empty_list(
    api_client, candidate, other_candidate, stranger
) -> None:
    """C must not learn that A and B have any relationship at all."""

    _send(api_client, candidate, other_candidate)

    assert _mine(api_client, stranger) == []


def test_the_list_can_be_filtered_by_status(
    api_client, candidate, other_candidate
) -> None:
    sent = _send(api_client, candidate, other_candidate)
    _verb(api_client, other_candidate, sent["id"], "accept")

    assert len(_mine(api_client, candidate)) == 1
    assert len(_mine(api_client, candidate, "accepted")) == 1
    assert _mine(api_client, candidate, "pending") == []
    assert _mine(api_client, candidate, "declined") == []
    assert _mine(api_client, candidate, "canceled") == []


def test_removed_is_accepted_and_always_empty(
    api_client, candidate, other_candidate
) -> None:
    """``removed`` is in the client's enum, so a 422 would punish valid code.

    It is a projection of a *deleted* row, so the honest answer is an empty list —
    never a 500 from a status the database CHECK does not contain.
    """

    _send(api_client, candidate, other_candidate)

    assert _mine(api_client, candidate, "removed") == []


def test_an_unknown_status_is_422(api_client, candidate) -> None:
    response = api_client.get(
        "/api/v1/connections", params={"status": "rejected"}, headers=candidate.headers
    )

    assert response.status_code == 422
    assert "status" in response.text


def test_the_list_is_newest_first(
    api_client, db_session, candidate, other_candidate, stranger
) -> None:
    """A deterministic order, so two identical requests cannot reshuffle.

    The timestamps are set explicitly because ``now()`` is the *transaction*
    timestamp: two rows written by one test share a value, and the assertion would
    then be testing the id tiebreaker instead of the ordering.
    """

    first = _send(api_client, candidate, other_candidate)
    second = _send(api_client, candidate, stranger)

    rows = {str(row.id): row for row in _rows(db_session)}
    rows[first["id"]].created_at = datetime(2024, 1, 1, tzinfo=UTC)
    rows[second["id"]].created_at = datetime(2024, 6, 1, tzinfo=UTC)
    db_session.commit()

    assert [row["id"] for row in _mine(api_client, candidate)] == [
        second["id"],
        first["id"],
    ]


def test_the_list_never_reshuffles_between_identical_requests(
    api_client, candidate, other_candidate, stranger
) -> None:
    """The id tiebreaker, which is what makes the order stable on a tie."""

    _send(api_client, candidate, other_candidate)
    _send(api_client, candidate, stranger)

    first_read = [row["id"] for row in _mine(api_client, candidate)]
    second_read = [row["id"] for row in _mine(api_client, candidate)]

    assert first_read == second_read


# --- accept ------------------------------------------------------------------


def test_the_recipient_can_accept(api_client, candidate, other_candidate) -> None:
    sent = _send(api_client, candidate, other_candidate)

    response = _verb(api_client, other_candidate, sent["id"], "accept")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "accepted"
    assert body["is_outgoing"] is False
    assert body["responded_at"], "answering a request stamps responded_at"


def test_the_requester_cannot_accept_their_own_request(
    api_client, candidate, other_candidate
) -> None:
    """404, not 403: the client is told the row is gone rather than forbidden."""

    sent = _send(api_client, candidate, other_candidate)

    response = _verb(api_client, candidate, sent["id"], "accept")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert _mine(api_client, candidate)[0]["status"] == "pending"


def test_an_unrelated_user_cannot_accept(
    api_client, candidate, other_candidate, stranger
) -> None:
    sent = _send(api_client, candidate, other_candidate)

    response = _verb(api_client, stranger, sent["id"], "accept")

    assert response.status_code == 404
    assert _mine(api_client, candidate)[0]["status"] == "pending"


def test_accepting_is_visible_to_both(api_client, candidate, other_candidate) -> None:
    sent = _send(api_client, candidate, other_candidate)
    _verb(api_client, other_candidate, sent["id"], "accept")

    for account in (candidate, other_candidate):
        row = _mine(api_client, account, "accepted")[0]
        assert row["id"] == sent["id"]
        assert row["status"] == "accepted"


def test_repeated_accept_is_idempotent(
    api_client, candidate, other_candidate
) -> None:
    """§18: a repeat is a no-op returning the same record, not an error."""

    sent = _send(api_client, candidate, other_candidate)
    first = _verb(api_client, other_candidate, sent["id"], "accept").json()

    second = _verb(api_client, other_candidate, sent["id"], "accept")

    assert second.status_code == 200
    assert second.json()["responded_at"] == first["responded_at"]


def test_an_accepted_request_cannot_be_accepted_twice_by_the_requester(
    api_client, candidate, other_candidate
) -> None:
    sent = _send(api_client, candidate, other_candidate)
    _verb(api_client, other_candidate, sent["id"], "accept")

    response = _verb(api_client, candidate, sent["id"], "accept")

    assert response.status_code == 404


# --- decline -----------------------------------------------------------------


def test_the_recipient_can_decline(api_client, candidate, other_candidate) -> None:
    """``/decline``, not ``/reject`` — §6.1 records this as a deliberate deviation
    from the original brief, because the mobile client calls ``declineConnection``.
    """

    sent = _send(api_client, candidate, other_candidate)

    response = _verb(api_client, other_candidate, sent["id"], "decline")

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "declined"
    assert response.json()["responded_at"]


def test_there_is_no_reject_route(api_client, candidate, other_candidate) -> None:
    """A second spelling of the same verb would be a path with no caller."""

    sent = _send(api_client, candidate, other_candidate)

    assert api_client.post(
        f"/api/v1/connections/{sent['id']}/reject", headers=candidate.headers
    ).status_code == 404


def test_the_requester_cannot_decline(api_client, candidate, other_candidate) -> None:
    sent = _send(api_client, candidate, other_candidate)

    response = _verb(api_client, candidate, sent["id"], "decline")

    assert response.status_code == 404
    assert _mine(api_client, candidate)[0]["status"] == "pending"


def test_an_unrelated_user_cannot_decline(
    api_client, candidate, other_candidate, stranger
) -> None:
    sent = _send(api_client, candidate, other_candidate)

    assert _verb(api_client, stranger, sent["id"], "decline").status_code == 404
    assert _mine(api_client, candidate)[0]["status"] == "pending"


def test_repeated_decline_is_idempotent(
    api_client, candidate, other_candidate
) -> None:
    sent = _send(api_client, candidate, other_candidate)
    first = _verb(api_client, other_candidate, sent["id"], "decline").json()

    second = _verb(api_client, other_candidate, sent["id"], "decline")

    assert second.status_code == 200
    assert second.json()["responded_at"] == first["responded_at"]


def test_decline_is_terminal(api_client, candidate, other_candidate) -> None:
    """Nothing moves a declined request on except a fresh request, which revives it."""

    sent = _send(api_client, candidate, other_candidate)
    _verb(api_client, other_candidate, sent["id"], "decline")

    assert _verb(api_client, other_candidate, sent["id"], "accept").status_code == 409
    assert _verb(api_client, candidate, sent["id"], "cancel").status_code == 409
    assert _mine(api_client, candidate)[0]["status"] == "declined"


# --- cancel ------------------------------------------------------------------


def test_the_requester_can_cancel(api_client, candidate, other_candidate) -> None:
    sent = _send(api_client, candidate, other_candidate)

    response = _verb(api_client, candidate, sent["id"], "cancel")

    assert response.status_code == 200, response.text
    body = response.json()
    # One "l", matching the mobile enum, while the verb is "cancel".
    assert body["status"] == "canceled"
    assert body["responded_at"], "a cancellation still ends the pending state"


def test_the_recipient_cannot_cancel(api_client, candidate, other_candidate) -> None:
    """The addressee declines; withdrawing somebody else's request is not theirs."""

    sent = _send(api_client, candidate, other_candidate)

    response = _verb(api_client, other_candidate, sent["id"], "cancel")

    assert response.status_code == 404
    assert _mine(api_client, candidate)[0]["status"] == "pending"


def test_an_unrelated_user_cannot_cancel(
    api_client, candidate, other_candidate, stranger
) -> None:
    sent = _send(api_client, candidate, other_candidate)

    assert _verb(api_client, stranger, sent["id"], "cancel").status_code == 404
    assert _mine(api_client, candidate)[0]["status"] == "pending"


def test_repeated_cancel_is_idempotent(
    api_client, candidate, other_candidate
) -> None:
    sent = _send(api_client, candidate, other_candidate)
    first = _verb(api_client, candidate, sent["id"], "cancel").json()

    second = _verb(api_client, candidate, sent["id"], "cancel")

    assert second.status_code == 200
    assert second.json()["responded_at"] == first["responded_at"]


def test_a_canceled_request_cannot_be_accepted(
    api_client, candidate, other_candidate
) -> None:
    sent = _send(api_client, candidate, other_candidate)
    _verb(api_client, candidate, sent["id"], "cancel")

    assert _verb(api_client, other_candidate, sent["id"], "accept").status_code == 409


def test_cancelling_does_not_touch_another_pair(
    api_client, candidate, other_candidate, stranger
) -> None:
    """A cancel must remove exactly one row, not "the caller's pending requests"."""

    mine = _send(api_client, candidate, other_candidate)
    theirs = _send(api_client, stranger, other_candidate)

    assert _verb(api_client, candidate, mine["id"], "cancel").status_code == 200

    assert _mine(api_client, other_candidate, "pending")[0]["id"] == theirs["id"]


# --- remove ------------------------------------------------------------------


def _accepted(api_client, a, b) -> dict:
    sent = _send(api_client, a, b)
    assert _verb(api_client, b, sent["id"], "accept").status_code == 200
    return sent


def test_the_requester_can_remove_an_accepted_connection(
    api_client, candidate, other_candidate
) -> None:
    sent = _accepted(api_client, candidate, other_candidate)

    response = api_client.delete(
        f"/api/v1/connections/{sent['id']}", headers=candidate.headers
    )

    assert response.status_code == 204
    assert response.content == b""


def test_the_recipient_can_remove_an_accepted_connection(
    api_client, candidate, other_candidate
) -> None:
    """Either participant, not just the one who sent it."""

    sent = _accepted(api_client, candidate, other_candidate)

    response = api_client.delete(
        f"/api/v1/connections/{sent['id']}", headers=other_candidate.headers
    )

    assert response.status_code == 204
    assert _mine(api_client, candidate) == []
    assert _mine(api_client, other_candidate) == []


def test_an_unrelated_user_cannot_remove(
    api_client, candidate, other_candidate, stranger
) -> None:
    sent = _accepted(api_client, candidate, other_candidate)

    response = api_client.delete(
        f"/api/v1/connections/{sent['id']}", headers=stranger.headers
    )

    assert response.status_code == 404
    assert len(_mine(api_client, candidate)) == 1


def test_removing_twice_is_404(api_client, candidate, other_candidate) -> None:
    sent = _accepted(api_client, candidate, other_candidate)
    first = api_client.delete(
        f"/api/v1/connections/{sent['id']}", headers=candidate.headers
    )
    second = api_client.delete(
        f"/api/v1/connections/{sent['id']}", headers=candidate.headers
    )

    assert first.status_code == 204
    assert second.status_code == 404


def test_the_pair_may_connect_again_after_a_removal(
    api_client, db_session, candidate, other_candidate
) -> None:
    """A removal leaves no orphan row and no stuck unique key."""

    sent = _accepted(api_client, candidate, other_candidate)
    api_client.delete(f"/api/v1/connections/{sent['id']}", headers=candidate.headers)

    fresh = _send(api_client, candidate, other_candidate)

    assert fresh["id"] != sent["id"]
    assert fresh["status"] == "pending"
    assert len(_rows(db_session)) == 1


def test_removing_a_pending_request_is_409(
    api_client, candidate, other_candidate
) -> None:
    """The verbs for a pending request are cancel and decline, not DELETE."""

    sent = _send(api_client, candidate, other_candidate)

    response = api_client.delete(
        f"/api/v1/connections/{sent['id']}", headers=candidate.headers
    )

    assert response.status_code == 409
    assert _mine(api_client, candidate)[0]["status"] == "pending"


# --- malformed ids -----------------------------------------------------------


@pytest.mark.parametrize("verb", VERBS)
def test_a_malformed_connection_id_is_404(
    api_client, candidate, other_candidate, verb
) -> None:
    """``parse_id`` answers 404, so the route is not a UUID-format oracle."""

    _send(api_client, candidate, other_candidate)

    for raw in ("nonsense", NOBODY):
        response = _verb(api_client, candidate, raw, verb)
        assert response.status_code == 404, f"{verb} {raw}"


@pytest.mark.parametrize("verb", VERBS)
def test_an_unrelated_user_gets_404_for_a_real_id(
    api_client, candidate, other_candidate, stranger, verb
) -> None:
    sent = _send(api_client, candidate, other_candidate)

    assert _verb(api_client, stranger, sent["id"], verb).status_code == 404


# --- what a connection exposes -----------------------------------------------


def test_a_connection_carries_no_private_fields(
    api_client, candidate, other_candidate
) -> None:
    """The read model is fixed, so a privacy setting cannot change what leaks.

    ``email``/``phone``/``headline``/``summary``/``location`` are fields this model
    does not have, whatever ``profile_privacy`` says — which is the strongest
    possible form of respecting it. The full, filtered profile is the job of
    ``GET /users/{public_id}``, which does not exist yet.
    """

    _send(api_client, candidate, other_candidate)

    row = _mine(api_client, candidate)[0]
    text = str(row).lower()

    assert set(row) == {
        "id",
        "status",
        "is_outgoing",
        "user",
        "created_at",
        "responded_at",
    }
    assert set(row["user"]) == {
        "user_id",
        "public_id",
        "username",
        "name",
        "role",
        "avatar_url",
    }
    for forbidden in ("email", "phone", "password", "argon2", "headline", "summary"):
        assert forbidden not in text, forbidden


def test_a_private_profile_does_not_change_a_connection_row(
    api_client, candidate, other_candidate
) -> None:
    """Same bytes before and after the other person tightens their privacy.

    Not a test that privacy is honoured — a test that this endpoint is structurally
    incapable of ignoring it, because the fields simply are not in the response.
    """

    before = _send(api_client, candidate, other_candidate)

    api_client.put(
        "/api/v1/profile/privacy",
        json={
            "profile_visibility": "private",
            "discoverable": False,
            "allow_messages": False,
            "show_email": False,
            "show_phone": False,
        },
        headers=other_candidate.headers,
    )

    after = _mine(api_client, candidate)[0]

    assert after == before


# --- the database is the real guard -----------------------------------------
#
# These bypass the service entirely and write through the ORM, because the point is
# that the invariants hold for *any* writer — a future route, a data fix, a script.


def test_the_database_refuses_a_self_connection(db_session, user_factory) -> None:
    one = user_factory()

    db_session.add(
        Connection(
            requester_id=one.id,
            addressee_id=one.id,
            status=ConnectionStatus.PENDING,
            responded_at=None,
        )
    )

    with pytest.raises(REJECTION_ERRORS):
        db_session.commit()
    db_session.rollback()


def test_the_database_refuses_a_duplicate_pair(
    db_session, user_factory
) -> None:
    """Even in the *reverse* direction, which is the whole point of LEAST/GREATEST."""

    one, two = user_factory(), user_factory()
    db_session.add(
        Connection(
            requester_id=one.id,
            addressee_id=two.id,
            status=ConnectionStatus.PENDING,
            responded_at=None,
        )
    )
    db_session.commit()

    db_session.add(
        Connection(
            requester_id=two.id,
            addressee_id=one.id,
            status=ConnectionStatus.PENDING,
            responded_at=None,
        )
    )

    with pytest.raises(REJECTION_ERRORS):
        db_session.commit()
    db_session.rollback()


def test_the_database_refuses_responded_at_on_a_pending_row(
    db_session, user_factory
) -> None:
    """``(status = 'pending') = (responded_at IS NULL)`` — the two cannot disagree."""

    one, two = user_factory(), user_factory()

    db_session.add(
        Connection(
            requester_id=one.id,
            addressee_id=two.id,
            status=ConnectionStatus.PENDING,
            responded_at=_answered_now(),
        )
    )

    with pytest.raises(REJECTION_ERRORS):
        db_session.commit()
    db_session.rollback()


def test_the_database_refuses_a_missing_responded_at_on_a_settled_row(
    db_session, user_factory
) -> None:
    one, two = user_factory(), user_factory()

    db_session.add(
        Connection(
            requester_id=one.id,
            addressee_id=two.id,
            status=ConnectionStatus.ACCEPTED,
            responded_at=None,
        )
    )

    with pytest.raises(REJECTION_ERRORS):
        db_session.commit()
    db_session.rollback()


def test_the_database_refuses_a_status_outside_the_state_machine(
    db_session, user_factory
) -> None:
    """Including ``removed``, which is a projection and never stored."""

    one, two = user_factory(), user_factory()

    db_session.add(
        Connection(
            requester_id=one.id,
            addressee_id=two.id,
            status="removed",
            responded_at=_answered_now(),
        )
    )

    with pytest.raises(REJECTION_ERRORS):
        db_session.commit()
    db_session.rollback()


def test_the_race_loser_gets_a_conflict_not_a_500(
    api_client, db_session, candidate, other_candidate, monkeypatch
) -> None:
    """Prove the ``IntegrityError`` arm, by making the application check miss.

    Two clients can both ask "does this pair exist?" and both hear no, then both
    insert. Simulating that exactly needs two database sessions; the *outcome* is
    what matters, and it is reachable by stubbing the lookup to answer "no" when a
    row already exists. The unique index is what actually stops the second write.
    """

    _send(api_client, candidate, other_candidate)

    monkeypatch.setattr(svc, "_find_pair", lambda *args, **kwargs: None)

    response = _send_raw(api_client, candidate, other_candidate)

    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "conflict"
    # No raw SQL, no 500, and no second row.
    assert "uq_connections" not in response.text
    assert len(_rows(db_session)) == 1


def test_a_deleted_row_leaves_no_orphan(
    api_client, db_session, candidate, other_candidate
) -> None:
    sent = _accepted(api_client, candidate, other_candidate)
    api_client.delete(f"/api/v1/connections/{sent['id']}", headers=candidate.headers)

    assert _rows(db_session) == []


def test_the_table_is_intact_after_a_full_scenario(
    api_client, db_session, candidate, other_candidate, stranger
) -> None:
    """The post-conditions the brief asks for, checked against the table itself.

    Three accounts, every verb, every terminal state — and then the database is
    asked directly whether it ended up consistent, rather than trusting that the
    API responses implied it.
    """

    kept = _accepted(api_client, candidate, other_candidate)
    declined = _send(api_client, candidate, stranger)
    _verb(api_client, stranger, declined["id"], "decline")
    canceled = _send(api_client, stranger, other_candidate)
    _verb(api_client, stranger, canceled["id"], "cancel")
    api_client.delete(f"/api/v1/connections/{kept['id']}", headers=candidate.headers)

    rows = _rows(db_session)
    by_status: dict[str, int] = {}
    for row in rows:
        by_status[row.status.value] = by_status.get(row.status.value, 0) + 1

    assert by_status == {"declined": 1, "canceled": 1}

    # No pair appears twice, in either direction.
    pairs = [
        tuple(sorted((row.requester_id, row.addressee_id))) for row in rows
    ]
    assert len(pairs) == len(set(pairs)), "a pair was represented twice"

    # Nothing dangles: every participant is a real user.
    known = {str(candidate.id), str(other_candidate.id), str(stranger.id)}
    for row in rows:
        assert str(row.requester_id) in known
        assert str(row.addressee_id) in known

    # The invariant the CHECK enforces, restated against what we produced.
    for row in rows:
        assert (row.status is ConnectionStatus.PENDING) == (
            row.responded_at is None
        )
