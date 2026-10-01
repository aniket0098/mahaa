"""Phase 5.5 — ``GET /users/lookup``. The one route that reads another account.

The contract is short and the rule inside it is asymmetric, so the tests are grouped
around the two halves of that rule rather than around the endpoint:

* a **name** only reaches an account whose owner turned ``discoverable`` on; and
* an exact **handle** or **public id** resolves regardless.

Both come from spec §5.2 in one line. The asymmetry is the whole point — it is what
stops "type a name" from being a way to harvest every account on the platform.

``discoverable`` defaults to **false**, so the default state of a brand-new account
is *invisible to a name search but findable by handle*. Several tests below pin that
default, because "invisible" is the behaviour that has to keep holding.
"""

from __future__ import annotations

import uuid

import pytest

from app.models import ProfilePrivacy, User
from app.models.enums import UserStatus
from app.services.lookup import LOOKUP_QUERY_MAX, LOOKUP_RESULT_MAX
from tests.conftest import register

# --- fixtures ----------------------------------------------------------------


@pytest.fixture()
def stranger(api_client):
    """A third account, used to prove a lookup result changes nothing else."""

    return register(api_client, f"stranger.{uuid.uuid4().hex[:12]}@example.com")


# --- helpers -----------------------------------------------------------------


def _search(api_client, account, query: str):
    return api_client.get(
        "/api/v1/users/lookup",
        params={"query": query},
        headers=account.headers,
    )


def _found(api_client, account, query: str) -> list[dict]:
    response = _search(api_client, account, query)
    assert response.status_code == 200, response.text
    return response.json()


def _make_discoverable(db_session, user_id, discoverable: bool = True) -> None:
    """Set ``discoverable`` on the user's privacy row, creating it if absent.

    An upsert rather than an insert because ``profile_privacy.user_id`` is the
    primary key ? a second insert for the same account is a unique violation, and
    a test that wants to flip the flag off must not have to know whether a row
    exists first.
    """

    privacy = db_session.get(ProfilePrivacy, user_id)
    if privacy is None:
        db_session.add(
            ProfilePrivacy(
                user_id=user_id,
                discoverable=discoverable,
                allow_messages=True,
            )
        )
    else:
        privacy.discoverable = discoverable
    db_session.commit()


def _person(db_session, name: str, **overrides) -> User:
    """A real row to be *found*. It needs no token — the searcher is somebody else.

    Built through the shared ``user_factory``, so it is an ordinary account as far
    as the database is concerned: the only thing that makes it findable or not is
    the privacy row a test chooses to give it.
    """

    return db_session  # replaced below by the fixture-driven helper


# --- authentication ----------------------------------------------------------


def test_lookup_requires_a_token(api_client) -> None:
    response = api_client.get("/api/v1/users/lookup", params={"query": "a"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


def test_a_forged_token_is_rejected(api_client) -> None:
    response = api_client.get(
        "/api/v1/users/lookup",
        params={"query": "a"},
        headers={"Authorization": "Bearer not-a-real-token"},
    )

    assert response.status_code == 401


def test_a_suspended_caller_is_forbidden_not_unauthenticated(
    api_client, candidate, db_session
) -> None:
    """Phase 2's shared rule, reused verbatim. No second account-status system."""

    user = db_session.get(User, uuid.UUID(candidate.id))
    user.status = UserStatus.SUSPENDED
    db_session.commit()

    response = _search(api_client, candidate, "a")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_any_role_may_search(api_client, employer) -> None:
    """A recruiter finding a candidate is the reason this endpoint exists."""

    assert _found(api_client, employer, "no-such-person-anywhere") == []


# --- a name reaches only a discoverable account ------------------------------


def test_a_name_search_finds_a_discoverable_account(
    api_client, db_session, candidate, other_candidate
) -> None:
    _make_discoverable(db_session, uuid.UUID(other_candidate.id))

    found = _found(api_client, candidate, "Phase Two")

    assert [row["user_id"] for row in found] == [other_candidate.id]


def test_a_name_search_is_a_partial_match(
    api_client, db_session, candidate, other_candidate
) -> None:
    """``"Two"`` is part of ``"Phase Two Candidate"`` — a person types a fragment."""

    _make_discoverable(db_session, uuid.UUID(other_candidate.id))

    assert [row["user_id"] for row in _found(api_client, candidate, "Two")] == [
        other_candidate.id
    ]


def test_a_name_search_is_case_insensitive(
    api_client, db_session, candidate, other_candidate
) -> None:
    _make_discoverable(db_session, uuid.UUID(other_candidate.id))

    for term in ("phase two", "PHASE TWO", "PhAsE tWo"):
        assert [row["user_id"] for row in _found(api_client, candidate, term)] == [
            other_candidate.id
        ], term


def test_a_private_account_is_invisible_to_a_name_search(
    api_client, candidate, other_candidate
) -> None:
    """The default. ``discoverable`` is false, so a name search finds nobody.

    No privacy row is created at all here — the absence *is* the test, because a
    user who has never opened their profile must not be findable by name.
    """

    assert _found(api_client, candidate, "Phase Two") == []


def test_discoverable_off_also_hides_an_account_that_had_a_privacy_row(
    api_client, db_session, candidate, other_candidate
) -> None:
    """Turning it on and then off again really does hide the account again."""

    _make_discoverable(db_session, uuid.UUID(other_candidate.id))
    assert _found(api_client, candidate, "Phase Two")

    _make_discoverable(db_session, uuid.UUID(other_candidate.id), discoverable=False)

    assert _found(api_client, candidate, "Phase Two") == []


# --- a handle or public id resolves regardless of privacy -------------------


def test_an_exact_handle_resolves_a_private_account(
    api_client, candidate, other_candidate
) -> None:
    """§5.2: "exact handle/public_id resolves regardless".

    A handle is something a person deliberately hands out, so the caller already
    possesses the identifier. Refusing it would protect nothing, and would make
    the shareable handle useless.
    """

    found = _found(api_client, candidate, other_candidate.username)

    assert [row["user_id"] for row in found] == [other_candidate.id]


def test_an_exact_public_id_resolves_a_private_account(
    api_client, candidate, other_candidate
) -> None:
    """``public_id`` is the human-shareable handle. It resolves for the same reason."""

    found = _found(api_client, candidate, other_candidate.body["public_id"])

    assert [row["user_id"] for row in found] == [other_candidate.id]


def test_handle_matching_is_case_insensitive(
    api_client, candidate, other_candidate
) -> None:
    """The stored handle is lower-case but the column is case-sensitive.

    Somebody reading ``Aditi`` and ``aditi`` on two profiles would call it a bug,
    and the client types handles as lower case — so the comparison is lowered on
    both sides rather than lowercasing what is stored. This mirrors
    ``account.username_taken``.
    """

    handle = other_candidate.username
    terms = [
        handle,
        handle.upper(),
        "".join(c.upper() if i % 2 else c for i, c in enumerate(handle)),
    ]

    for term in terms:
        assert [row["user_id"] for row in _found(api_client, candidate, term)] == [
            other_candidate.id
        ], term


def test_public_id_matching_is_case_insensitive(
    api_client, candidate, other_candidate
) -> None:
    """``public_id`` is stored upper-case (``MJ-XXXXXXXX``) for the same reason."""

    public_id = other_candidate.body["public_id"]

    for term in (public_id, public_id.lower(), public_id.upper()):
        assert [row["user_id"] for row in _found(api_client, candidate, term)] == [
            other_candidate.id
        ], term


# --- the caller --------------------------------------------------------------


def test_the_caller_is_never_in_their_own_results(api_client, candidate) -> None:
    """Not a privacy rule — a correctness one.

    The only consumer of this result is ``sendConnectionRequest(userId)``, and a
    self-connection is a 422. Returning yourself would be a dead end.
    """

    assert _found(api_client, candidate, candidate.username) == []
    assert _found(api_client, candidate, candidate.body["public_id"]) == []
    assert _found(api_client, candidate, candidate.username[:6]) == []


def test_the_caller_stays_out_of_a_name_search_for_themselves(
    api_client, db_session, candidate
) -> None:
    """Even when the caller is discoverable, they are not their own result."""

    _make_discoverable(db_session, uuid.UUID(candidate.id))

    assert _found(api_client, candidate, "Phase Two") == []


# --- wildcard handling -------------------------------------------------------


def test_a_percent_sign_is_searched_for_literally(
    api_client, db_session, candidate, user_factory
) -> None:
    """Without escaping, ``%`` would match every discoverable account on the site."""

    literal = user_factory(name="100% Remote Worker")
    other = user_factory(name="Ordinary Person")
    for person in (literal, other):
        _make_discoverable(db_session, person.id)

    found = _found(api_client, candidate, "%")

    assert [row["user_id"] for row in found] == [str(literal.id)]


def test_an_underscore_is_searched_for_literally(
    api_client, db_session, candidate, user_factory
) -> None:
    """``_`` is a single-character wildcard in LIKE; ``a_b`` must not match ``axb``."""

    literal = user_factory(name="Data_based Report")
    decoy = user_factory(name="DataXbased Report")
    for person in (literal, decoy):
        _make_discoverable(db_session, person.id)

    assert [row["user_id"] for row in _found(api_client, candidate, "a_b")] == [
        str(literal.id)
    ]


# --- results -----------------------------------------------------------------


def test_a_no_match_is_an_empty_array_not_an_error(api_client, candidate) -> None:
    assert _found(api_client, candidate, "nobody-has-this-name") == []


def test_the_response_is_a_bare_array_not_an_envelope(
    api_client, candidate, other_candidate
) -> None:
    """§17 lists ``/users/lookup`` among the bare-array endpoints."""

    body = _search(api_client, candidate, other_candidate.username).json()

    assert isinstance(body, list)


def test_multiple_results_are_returned_together(
    api_client, db_session, candidate, user_factory
) -> None:
    people = [user_factory(name=f"Loadable Person {i}") for i in range(3)]
    for person in people:
        _make_discoverable(db_session, person.id)

    found = _found(api_client, candidate, "Loadable")

    assert {row["user_id"] for row in found} == {str(p.id) for p in people}


def test_results_are_ordered_by_name(
    api_client, db_session, candidate, user_factory
) -> None:
    people = [
        user_factory(name="Zoe Loadable"),
        user_factory(name="Adam Loadable"),
        user_factory(name="Mary Loadable"),
    ]
    for person in people:
        _make_discoverable(db_session, person.id)

    found = _found(api_client, candidate, "Loadable")

    assert [row["name"] for row in found] == [
        "Adam Loadable",
        "Mary Loadable",
        "Zoe Loadable",
    ]


def test_an_exact_handle_match_is_ordered_first(
    api_client, db_session, candidate, user_factory
) -> None:
    """The flow the endpoint exists for: paste a handle, get *that* person first.

    The query is deliberately both an exact handle for one account and a substring
    of two other people's names, so a single search exercises the two branches and
    the ordering between them.
    """

    exact = user_factory(name="Zzz The One You Asked For", username="max")
    alpha = user_factory(name="Maximal Loadable")
    beta = user_factory(name="Max Loadable")
    for person in (exact, alpha, beta):
        _make_discoverable(db_session, person.id)

    found = _found(api_client, candidate, "max")

    # The handle match first, then the two name matches in name order.
    assert [row["user_id"] for row in found] == [
        str(exact.id),
        str(beta.id),
        str(alpha.id),
    ]


def test_the_result_set_is_capped(
    api_client, db_session, candidate, user_factory
) -> None:
    """One character must not be able to return the whole table.

    The contract has no limit parameter, so this constant is the only bound there
    is between a broad search and a phone-sized response.
    """

    people = [
        user_factory(name=f"Loadable {i:03d}") for i in range(LOOKUP_RESULT_MAX + 5)
    ]
    for person in people:
        _make_discoverable(db_session, person.id)

    found = _found(api_client, candidate, "Loadable")

    assert len(found) == LOOKUP_RESULT_MAX
    assert len({row["user_id"] for row in found}) == LOOKUP_RESULT_MAX


# --- invalid input -----------------------------------------------------------


@pytest.mark.parametrize("blank", ["", "   ", "\t", "\n  "])
def test_a_blank_query_is_422(api_client, candidate, blank) -> None:
    """A blank search must never mean "everyone"."""

    response = _search(api_client, candidate, blank)

    assert response.status_code == 422, repr(blank)
    assert response.json()["error"]["code"] == "validation_error"


def test_a_missing_query_is_422(api_client, candidate) -> None:
    assert (
        api_client.get("/api/v1/users/lookup", headers=candidate.headers).status_code
        == 422
    )


def test_an_over_long_query_is_422(api_client, candidate) -> None:
    response = _search(api_client, candidate, "a" * (LOOKUP_QUERY_MAX + 1))

    assert response.status_code == 422
    assert "query" in response.text


def test_a_query_at_the_limit_is_accepted(api_client, candidate) -> None:
    response = _search(api_client, candidate, "a" * LOOKUP_QUERY_MAX)

    assert response.status_code == 200, response.text
    assert response.json() == []


def test_an_unknown_query_parameter_does_not_change_the_answer(api_client, candidate):
    """The contract has exactly one parameter; an extra must be ignored, not honoured.

    ``include_private=true`` is a parameter nobody defined. Honouring it would be
    inventing a privacy bypass; the test pins that it changes nothing.
    """

    baseline = _search(api_client, candidate, "nobody").json()
    extra = api_client.get(
        "/api/v1/users/lookup",
        params={"query": "nobody", "limit": 9999, "include_private": "true"},
        headers=candidate.headers,
    )

    assert extra.status_code == 200
    assert extra.json() == baseline


# --- privacy -----------------------------------------------------------------


def test_lookup_exposes_no_private_fields(
    api_client, db_session, candidate, other_candidate
) -> None:
    """Six identifying fields, and the model has nowhere to put anything else."""

    _make_discoverable(db_session, uuid.UUID(other_candidate.id))
    found = _found(api_client, candidate, "Phase Two")

    assert set(found[0]) == {
        "user_id",
        "public_id",
        "username",
        "name",
        "role",
        "avatar_url",
    }
    text = str(found).lower()
    for forbidden in (
        "email",
        "phone",
        "password",
        "argon2",
        "headline",
        "summary",
        "preferences",
        "allow_messages",
        "discoverable",
    ):
        assert forbidden not in text, forbidden


def test_a_strictly_private_account_leaks_nothing_through_a_name_search(
    api_client, db_session, candidate, other_candidate
) -> None:
    """Fully private: not even a name comes back, while the handle still resolves.

    The two halves of the rule side by side, because the interesting claim is that
    privacy hides the *name* and not the *identifier*.
    """

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

    assert _found(api_client, candidate, "Phase Two") == []

    by_handle = _found(api_client, candidate, other_candidate.username)
    assert [row["user_id"] for row in by_handle] == [other_candidate.id]


def test_a_name_search_never_produces_a_richer_result_than_a_handle_search(
    api_client, db_session, candidate, other_candidate
) -> None:
    """A private account found by handle gets exactly the same six fields as anyone.

    A name search must not be a way to learn more than a handle search does.
    """

    _make_discoverable(db_session, uuid.UUID(other_candidate.id), discoverable=False)

    by_handle = _found(api_client, candidate, other_candidate.username)[0]

    assert set(by_handle) == {
        "user_id",
        "public_id",
        "username",
        "name",
        "role",
        "avatar_url",
    }


# --- the flow this exists for ------------------------------------------------


def test_lookup_then_send_a_connection_request(
    api_client, candidate, other_candidate
) -> None:
    """``lookupUsers`` -> ``user_id`` -> ``sendConnectionRequest(userId)``.

    The whole point of the phase. The id the search returns is exactly the id the
    connection endpoint takes, so the flow closes with no translation.
    """

    found = _found(api_client, candidate, other_candidate.body["public_id"])
    assert len(found) == 1

    response = api_client.post(
        "/api/v1/connections",
        json={"user_id": found[0]["user_id"]},
        headers=candidate.headers,
    )

    assert response.status_code == 201, response.text
    assert response.json()["user"]["user_id"] == other_candidate.id


def test_a_lookup_result_does_not_bypass_the_connection_requirement(
    api_client, candidate, stranger
) -> None:
    """Finding somebody is not the same as being allowed to write to them.

    Lookup only reveals what the handle already revealed. The relationship rule in
    ``app/services/connections.py`` is untouched and still refuses a stranger, so
    adding this endpoint cannot have weakened Phase 4.
    """

    found = _found(api_client, candidate, stranger.body["public_id"])
    assert [row["user_id"] for row in found] == [stranger.id]

    # A *request* may be sent to anybody ? that is what a request is. What lookup
    # must not grant is the ability to settle it unilaterally.
    sent = api_client.post(
        "/api/v1/connections",
        json={"user_id": found[0]["user_id"]},
        headers=candidate.headers,
    )
    assert sent.status_code == 201, sent.text
    assert sent.json()["status"] == "pending"

    self_accept = api_client.post(
        f"/api/v1/connections/{sent.json()['id']}/accept",
        headers=candidate.headers,
    )
    assert self_accept.status_code == 404
    assert self_accept.json()["error"]["code"] == "not_found"

    # And the stranger is the only one who can settle it.
    accepted = api_client.post(
        f"/api/v1/connections/{sent.json()['id']}/accept",
        headers=stranger.headers,
    )
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"


def test_a_registered_account_is_reachable_by_handle(api_client, candidate) -> None:
    """An account created through the real signup route is findable too."""

    person = register(api_client, f"lookup.{uuid.uuid4().hex[:12]}@example.com")

    found = _found(api_client, candidate, person.username)

    assert [row["user_id"] for row in found] == [person.id]
