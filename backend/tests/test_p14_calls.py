"""Phase 14 — calling. The A/B/C triangle, on every rule.

**A and B are connected with a conversation; C is a stranger.** A call may only
exist between the two members of an existing 1:1 conversation, so the ``thread``
fixture does the real Phase 4 and Phase 5 work first. Nothing stubs the
relationship away, because the relationship *is* the authorisation rule.

**C is present throughout, for the same reason Phase 5 keeps one.** A test with
only A and B cannot tell a working participation check from a missing one — there
is nothing to steal if nobody else exists. C must be refused on every endpoint
and must not learn that a call exists.

**LiveKit is never configured in these tests.** There is no ``LIVEKIT_API_KEY``
in the test environment, so ``GET /calls/{id}/token`` answers 503 and that is
asserted rather than mocked. A test that faked a token would prove the signing
library works, not that this server refuses to hand one to a stranger.

**The socket is not stubbed either.** ``app.realtime.call_events`` publishes into
whatever runtime exists, and with no Redis that is ``None``, so every publish is a
silent no-op. That is the designed failure mode — a lost event never fails a
committed call — and these tests assert the *state* the event describes rather
than the delivery of it.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.core.config import get_settings
from app.models import Call
from app.models.enums import CallStatus
from app.services import calls as svc
from app.services import livekit_tokens
from tests.conftest import register

#: Nobody's call. Only used where participation is decided before the id is read.
NOBODY = str(uuid.UUID(int=0))

CALL_ROUTES = [
    ("post", "/api/v1/conversations/{cid}/calls", {}),
    ("get", "/api/v1/conversations/{cid}/calls", None),
    ("get", f"/api/v1/calls/{NOBODY}", None),
    ("post", f"/api/v1/calls/{NOBODY}/accept", None),
    ("post", f"/api/v1/calls/{NOBODY}/reject", None),
    ("post", f"/api/v1/calls/{NOBODY}/cancel", None),
    ("post", f"/api/v1/calls/{NOBODY}/end", None),
    ("get", f"/api/v1/calls/{NOBODY}/token", None),
]

ROUTE_IDS = [
    f"{method.upper()} {path.format(cid='<conversation>')}"
    for method, path, _ in CALL_ROUTES
]


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


def _thread(api_client, a, b) -> str:
    """A connected pair with an open conversation — the precondition for a call."""

    _connect(api_client, a, b)
    created = api_client.post(
        "/api/v1/conversations", json={"user_id": b.id}, headers=a.headers
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _start(api_client, account, conversation_id: str, **body) -> dict:
    response = api_client.post(
        f"/api/v1/conversations/{conversation_id}/calls",
        json=body,
        headers=account.headers,
    )
    assert response.status_code in (200, 201), response.text
    return response.json()


def _act(api_client, account, verb: str, call_id: str):
    return api_client.post(
        f"/api/v1/calls/{call_id}/{verb}", headers=account.headers
    )


def _rows(db_session):
    return list(db_session.scalars(select(Call)))

# --- fixtures ----------------------------------------------------------------


@pytest.fixture()
def thread(api_client, candidate, other_candidate) -> str:
    """A conversation between A (``candidate``) and B (``other_candidate``)."""

    return _thread(api_client, candidate, other_candidate)


@pytest.fixture()
def ringing(api_client, candidate, thread) -> dict:
    """A call A has started and nobody has answered yet."""

    return _start(api_client, candidate, thread)


# --- the lifecycle -----------------------------------------------------------


def test_starting_a_call_rings_the_other_member(
    api_client, candidate, ringing
) -> None:
    """201, RINGING, and both participants named from the conversation's own rows.

    ``caller_id`` is the authenticated caller and ``callee_id`` is the *other*
    member — neither came from the request, which has no field that could have
    carried them. That is what makes "a client cannot choose who it rings" a
    schema fact rather than a rule someone remembered to enforce.
    """

    assert ringing["status"] == "ringing"
    assert ringing["caller_id"] == candidate.id
    assert ringing["mode"] == "audio"
    assert ringing["answered_at"] is None
    assert ringing["ended_at"] is None
    # The callee is the other member of the conversation, and it is *not* the
    # caller — the CHECK constraint `no_self_call` also guarantees this.
    assert ringing["callee_id"] not in (None, candidate.id)


def test_mode_is_the_only_thing_a_client_sends(api_client, candidate, thread) -> None:
    """Video is accepted; ``callee_id`` and ``status`` are refused outright.

    ``extra="forbid"`` is what turns an attempt to name the ring target into a
    422, so there is no field a client could set even by accident.
    """

    response = api_client.post(
        f"/api/v1/conversations/{thread}/calls",
        json={"mode": "video"},
        headers=candidate.headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["mode"] == "video"

    refused = api_client.post(
        f"/api/v1/conversations/{thread}/calls",
        json={"callee_id": NOBODY, "status": "accepted"},
        headers=candidate.headers,
    )
    assert refused.status_code == 422, refused.text


def test_a_second_start_returns_the_live_call_and_answers_200(
    api_client, candidate, other_candidate, thread, ringing
) -> None:
    """Re-ringing is the same resource, not a second invitation.

    201 is a claim that something new was made. The partial unique index is what
    makes the reuse safe — two racing starts cannot both create a live call — so
    the second request reads the winner's row and answers 200.
    """

    again = api_client.post(
        f"/api/v1/conversations/{thread}/calls",
        json={},
        headers=candidate.headers,
    )
    assert again.status_code == 200, again.text
    assert again.json()["id"] == ringing["id"]

    # Either side re-ringing collapses onto the same call.
    from_callee = api_client.post(
        f"/api/v1/conversations/{thread}/calls",
        json={},
        headers=other_candidate.headers,
    )
    assert from_callee.status_code == 200, from_callee.text
    assert from_callee.json()["id"] == ringing["id"]


def test_accept_stamps_answered_at(
    api_client, candidate, other_candidate, ringing
) -> None:
    """The callee answers; ``answered_at`` is the server clock, never the client."""

    response = _act(api_client, other_candidate, "accept", ringing["id"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "accepted"
    assert body["answered_at"] is not None
    assert body["ended_at"] is None
    # The callee did not become the caller by answering.
    assert body["caller_id"] == candidate.id
    assert body["callee_id"] == other_candidate.id


def test_the_caller_cannot_accept_their_own_ring(
    api_client, candidate, ringing
) -> None:
    """404, not 403.

    A distinct "you are the caller" answer would confirm the call exists and its
    state to anybody who can guess an id, which is the enumeration a 404 exists
    to prevent.
    """

    assert _act(api_client, candidate, "accept", ringing["id"]).status_code == 404
    assert _act(api_client, candidate, "reject", ringing["id"]).status_code == 404


def test_reject_is_terminal_and_attributable(
    api_client, other_candidate, ringing
) -> None:
    """A declined call records who declined it, which is what makes it
    distinguishable from one that simply timed out.
    """

    response = _act(api_client, other_candidate, "reject", ringing["id"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "rejected"
    assert body["ended_at"] is not None
    assert body["ended_by"] == other_candidate.id


def test_cancel_is_the_callers_own_action(
    api_client, candidate, other_candidate, ringing
) -> None:
    """The caller may cancel; the callee's equivalent verb is ``reject``.

    Two verbs rather than one, because "I gave up" and "they declined" are
    different history and the client renders them differently.
    """

    cancelled = _act(api_client, candidate, "cancel", ringing["id"])
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"

    # The callee cannot cancel a ring they did not start.
    fresh = _start(api_client, candidate, ringing["conversation_id"])
    assert _act(api_client, other_candidate, "cancel", fresh["id"]).status_code == 403


def test_either_side_may_hang_up_an_answered_call(
    api_client, candidate, other_candidate, ringing
) -> None:
    """The one transition with no role restriction: a call is over when either
    side leaves it.
    """

    _act(api_client, other_candidate, "accept", ringing["id"])

    by_caller = _act(api_client, candidate, "end", ringing["id"])
    assert by_caller.status_code == 200, by_caller.text
    assert by_caller.json()["status"] == "ended"
    assert by_caller.json()["ended_by"] == candidate.id

    # And by the callee, on a second call, so the rule is not accidentally
    # "whoever happens to be the caller".
    second = _start(api_client, candidate, ringing["conversation_id"])
    _act(api_client, other_candidate, "accept", second["id"])
    by_callee = _act(api_client, other_candidate, "end", second["id"])
    assert by_callee.status_code == 200, by_callee.text
    assert by_callee.json()["ended_by"] == other_candidate.id


@pytest.mark.parametrize(
    ("verb", "actor_is_callee", "from_state"),
    [
        ("accept", True, "accepted"),
        ("reject", True, "accepted"),
        ("end", True, "ringing"),
    ],
)
def test_a_transition_from_the_wrong_state_is_a_409(
    api_client,
    other_candidate,
    ringing,
    verb,
    actor_is_callee,
    from_state,
) -> None:
    """The state machine is one-way, and the database's CHECK is the backstop.

    ``end`` from ``ringing`` belongs here too: hanging up before an answer is
    ``cancel`` for the caller and ``reject`` for the callee, so the two verbs keep
    their meaning instead of collapsing into one.
    """

    if from_state == "accepted":
        done = _act(api_client, other_candidate, "accept", ringing["id"])
        assert done.status_code == 200, done.text
    response = _act(api_client, other_candidate, verb, ringing["id"])
    assert response.status_code == 409, response.text


def test_a_terminal_call_frees_the_conversation_for_a_new_one(
    api_client, candidate, other_candidate, thread, ringing
) -> None:
    """The partial unique index is scoped to *live* calls, not to all of them.

    Without that scope a pair could only ever have one call in their history,
    which is exactly the record of a missed call the row exists to keep.
    """

    rejected = _act(api_client, other_candidate, "reject", ringing["id"])
    assert rejected.status_code == 200, rejected.text
    again = _start(api_client, candidate, thread)
    assert again["id"] != ringing["id"]
    assert again["status"] == "ringing"


# --- isolation: the C triangle ------------------------------------------------


def test_a_third_account_is_refused_on_every_route(
    api_client, candidate, other_candidate, thread, ringing
) -> None:
    """C is a registered, signed-in member with no relationship to this call.

    Authentication is not membership, and this is the test that would catch a
    participation check implemented as "is anybody signed in". Iterated over every
    route rather than sampled, because the shape a missing check takes is that
    *one* endpoint forgot it.
    """

    stranger = register(api_client, "p14.stranger@example.com")

    for method, path, body in CALL_ROUTES:
        target = path.format(cid=thread)
        response = _call(api_client, method, target, body, stranger.headers)
        assert response.status_code == 404, f"{method.upper()} {target}"

    # And the four verbs plus the row read, which are addressed by call id
    # rather than by conversation, so they are not reachable from the table
    # above.
    for verb in ("accept", "reject", "cancel", "end"):
        response = _act(api_client, stranger, verb, ringing["id"])
        assert response.status_code == 404, f"POST /calls/<id>/{verb}"
    assert (
        _call(
            api_client,
            "get",
            f"/api/v1/calls/{ringing['id']}/token",
            None,
            stranger.headers,
        ).status_code
        == 404
    )
    assert (
        _call(
            api_client,
            "get",
            f"/api/v1/calls/{ringing['id']}",
            None,
            stranger.headers,
        ).status_code
        == 404
    )


def test_every_call_route_demands_authentication(
    api_client, thread, ringing
) -> None:
    """401 without a token, on all eight routes.

    Listed explicitly rather than sampled, because "most of them are guarded" is
    the shape a missing dependency takes.
    """

    for method, path, body in CALL_ROUTES:
        target = path.format(cid=thread)
        response = _call(api_client, method, target, body, None)
        assert response.status_code == 401, f"{method.upper()} {target}"


def test_a_call_needs_a_conversation_to_exist_in(
    api_client, candidate, other_candidate
) -> None:
    """A connected pair with no open conversation cannot be rung.

    The conversation is the authorisation object: it is what names the two people
    who may call each other, and it is what the call inherits from. Without one
    there is nothing to inherit, so the request is refused rather than creating a
    thread as a side effect.
    """

    _connect(api_client, candidate, other_candidate)
    response = api_client.post(
        f"/api/v1/conversations/{NOBODY}/calls", json={}, headers=candidate.headers
    )
    assert response.status_code == 404, response.text


def test_nobody_is_rung_while_either_side_is_already_in_a_call(
    api_client, candidate, other_candidate, thread, ringing
) -> None:
    """409 for both roles, and one sentence that names neither.

    "You are busy" and "they are busy" are different facts; a caller who can tell
    them apart could use this endpoint to check whether a specific person is on a
    call right now. So both refusals are the same 409.

    The rule is stated because the alternative — ring anyway and let the callee
    choose — would make a call joinable in two rooms at once, which a 1:1 call
    cannot be.
    """

    stranger = register(api_client, "p14.third@example.com")
    other_thread = _thread(api_client, candidate, stranger)

    # The *caller* is already in `ringing`, so they cannot start a second one in
    # an unrelated conversation either.
    busy_caller = api_client.post(
        f"/api/v1/conversations/{other_thread}/calls",
        json={},
        headers=candidate.headers,
    )
    assert busy_caller.status_code == 409, busy_caller.text

    # End the call and the second conversation becomes startable, which proves
    # the busy check is about *live* calls and not a permanent lock on the pair.
    rejected = _act(api_client, other_candidate, "reject", ringing["id"])
    assert rejected.status_code == 200, rejected.text
    fresh = _start(api_client, candidate, other_thread)
    assert fresh["status"] == "ringing"


def test_a_busy_callee_cannot_be_rung_by_someone_else(
    api_client, candidate, other_candidate, ringing
) -> None:
    """The callee's own availability is checked, not just the caller's.

    This is the half of ``_assert_free`` a one-sided check would miss: A and B are
    in a call, so C — who is connected to B — must not be able to ring B into a
    second room. Both participants are checked, because a 1:1 call cannot be
    joined from two threads at once.
    """

    third = register(api_client, "p14.c@example.com")
    _connect(api_client, other_candidate, third)
    c_thread = api_client.post(
        "/api/v1/conversations",
        json={"user_id": other_candidate.id},
        headers=third.headers,
    )
    assert c_thread.status_code == 201, c_thread.text

    response = api_client.post(
        f"/api/v1/conversations/{c_thread.json()['id']}/calls",
        json={},
        headers=third.headers,
    )
    assert response.status_code == 409, response.text


# --- row reads -----------------------------------------------------------------


def test_a_participant_can_read_their_own_call(
    api_client, candidate, other_candidate, ringing
) -> None:
    """The active screen tracks this row: both members see the same record.

    No state change — reading a ringing call does not answer it, and polling
    this endpoint cannot ring, answer or end anything.
    """

    for account in (candidate, other_candidate):
        response = api_client.get(
            f"/api/v1/calls/{ringing['id']}", headers=account.headers
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["id"] == ringing["id"]
        assert body["status"] == "ringing"
        assert body["caller_id"] == candidate.id
        assert body["callee_id"] == other_candidate.id

    # Still ringing afterwards: the read moved nothing.
    still = api_client.get(
        f"/api/v1/calls/{ringing['id']}", headers=candidate.headers
    )
    assert still.json()["status"] == "ringing"


def test_reading_a_call_never_carries_a_token(api_client, candidate, ringing) -> None:
    """The row holds identifiers only: no token, no server URL, no room name."""

    body = api_client.get(
        f"/api/v1/calls/{ringing['id']}", headers=candidate.headers
    ).json()
    assert "token" not in body
    assert "server_url" not in body
    assert "room_name" not in body


# --- tokens ------------------------------------------------------------------


def test_the_token_endpoint_is_a_503_when_livekit_is_not_configured(
    api_client, candidate, ringing
) -> None:
    """The route exists everywhere; the credentials are a deployment fact.

    503 rather than 404 (the feature is not missing, it is unwired here) and
    rather than 500 (nothing is broken). A client can tell the three apart and
    render "calling is unavailable" instead of an error.
    """

    response = api_client.get(
        f"/api/v1/calls/{ringing['id']}/token", headers=candidate.headers
    )
    assert response.status_code == 503, response.text


def test_no_token_is_ever_stored_on_the_call_row(db_session, ringing) -> None:
    """The row holds a room name and nothing that could open it.

    A stored token would be a credential at rest with no need: it expires, and the
    endpoint mints another. The only LiveKit value on the row is the room name,
    which is this table's own identifier.
    """

    call = _rows(db_session)[0]
    assert call.room_name.startswith("mahaa-call-")
    # There is no column to check, which is the assertion: the model has no token
    # field, so no read route can return one either.
    assert not hasattr(call, "token")
    assert not hasattr(call, "livekit_token")


def test_a_minted_token_is_scoped_to_one_room_and_one_identity(
    db_session, monkeypatch, ringing
) -> None:
    """With credentials present, the token names exactly this room and caller.

    Configured via monkeypatch rather than a real LiveKit project, because what is
    being tested is the *scope* of the grant — not whether LiveKit accepts it.
    """

    settings = get_settings()
    monkeypatch.setattr(settings, "livekit_url", "wss://example.test")
    monkeypatch.setattr(settings, "livekit_api_key", "key")
    monkeypatch.setattr(settings, "livekit_api_secret", "secret" * 4)

    call = _rows(db_session)[0]
    minted = livekit_tokens.mint(
        room_name=call.room_name,
        user_id=call.caller_id,
        display_name="Caller",
        can_publish=True,
    )
    assert minted["room_name"] == call.room_name
    assert minted["identity"] == str(call.caller_id)
    assert minted["server_url"] == "wss://example.test"
    # Three segments: header, payload, signature. A token that decoded to one
    # field would not be a JWT and LiveKit would reject it.
    assert minted["token"].count(".") == 2


def test_a_token_is_refused_for_a_call_that_is_already_over(
    api_client, candidate, other_candidate, ringing, monkeypatch
) -> None:
    """409, not a token that silently fails at LiveKit.

    A credential to an empty room is still a credential, so the refusal happens
    here where it can be explained rather than in the client's connect handler
    where it cannot.
    """

    settings = get_settings()
    monkeypatch.setattr(settings, "livekit_url", "wss://example.test")
    monkeypatch.setattr(settings, "livekit_api_key", "key")
    monkeypatch.setattr(settings, "livekit_api_secret", "secret" * 4)

    rejected = _act(api_client, other_candidate, "reject", ringing["id"])
    assert rejected.status_code == 200, rejected.text

    response = api_client.get(
        f"/api/v1/calls/{ringing['id']}/token", headers=candidate.headers
    )
    assert response.status_code == 409, response.text


def test_a_token_is_short_lived() -> None:
    """The TTL comes from configuration and is bounded, so a token cannot outlive
    the ring window by an order of magnitude.
    """

    settings = get_settings()
    assert 60 <= settings.livekit_token_ttl_seconds <= 3600
    assert settings.livekit_token_ttl_seconds >= settings.call_ring_timeout_seconds


# --- history and the reaper --------------------------------------------------


def test_history_is_newest_first_and_visible_to_both(
    api_client, candidate, other_candidate, thread, ringing
) -> None:
    """Both participants read the same rows.

    A call between two people is one record with two views. Hiding half of it
    would make a missed call invisible to whoever missed it, which is the one
    record the row exists to keep.
    """

    _act(api_client, other_candidate, "reject", ringing["id"])
    second = _start(api_client, candidate, thread)
    _act(api_client, other_candidate, "accept", second["id"])
    _act(api_client, candidate, "end", second["id"])

    for account in (candidate, other_candidate):
        response = api_client.get(
            f"/api/v1/conversations/{thread}/calls", headers=account.headers
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total"] == 2, body
        assert [item["id"] for item in body["items"]] == [second["id"], ringing["id"]]
        assert body["items"][0]["answered_at"] is not None
        assert body["items"][1]["status"] == "rejected"


def test_history_pages(api_client, candidate, other_candidate, thread, ringing) -> None:
    """Offset pagination with a real total, and a bound on ``limit``.

    Unlike messages, call history is bounded by a pair's real conversations, so a
    count is affordable and a "recent calls" list wants it.
    """

    _act(api_client, other_candidate, "reject", ringing["id"])
    _start(api_client, candidate, thread)

    page = api_client.get(
        f"/api/v1/conversations/{thread}/calls",
        params={"limit": 1, "offset": 0},
        headers=candidate.headers,
    ).json()
    assert page["total"] == 2
    assert len(page["items"]) == 1
    assert page["limit"] == 1

    refused = api_client.get(
        f"/api/v1/conversations/{thread}/calls",
        params={"limit": 0},
        headers=candidate.headers,
    )
    assert refused.status_code == 422, refused.text


def test_an_unanswered_ring_expires_into_a_durable_missed_call(
    db_session, ringing
) -> None:
    """The reaper turns a ringing call into a record rather than letting it vanish.

    ``ended_by`` stays null: nobody ended it, and inventing an "ender" would
    misattribute a missed call. That null is the only thing distinguishing an
    expired call from one the callee declined.
    """

    call = _rows(db_session)[0]
    # Backdate past the configured ring window, as time passing would.
    db_session.execute(
        update(Call)
        .where(Call.id == call.id)
        .values(created_at=datetime.now(UTC) - timedelta(seconds=999))
    )
    db_session.commit()

    expired = svc.expire_stale(db_session)
    assert call.id in expired

    db_session.refresh(call)
    assert call.status == CallStatus.EXPIRED
    assert call.ended_at is not None
    assert call.ended_by is None

    # Idempotent: a second run finds nothing, because the status filter no longer
    # matches. A reaper that re-stamped rows would keep rewriting history.
    assert svc.expire_stale(db_session) == []


def test_expire_stale_leaves_a_live_call_alone(db_session, ringing) -> None:
    """A call inside the ring window is not expired, however it is read."""

    assert svc.expire_stale(db_session) == []
    call = _rows(db_session)[0]
    assert call.status == CallStatus.RINGING

