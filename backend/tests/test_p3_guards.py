"""The guards, swept across the whole candidate surface at once.

A per-endpoint guard test drifts: a new section is added, the factory generates
four routes, and nobody remembers to write four more assertions. This file keeps
one table of every candidate-only route and asserts the same three things against
it, so the next route added to the router is covered the moment it lands.

The two rules being swept:

* **401 before 403.** Authentication is checked before role, so an anonymous
  caller cannot use the status code to learn which roles a route exists for.
* **403 for a role that may not use the route at all**, which is a different
  answer from the 404 a cross-account id gets elsewhere in the suite.
"""

from __future__ import annotations

import pytest

#: A record id that belongs to nobody. Used only on routes where authentication
#: and role are decided before the id is ever looked up.
NOBODY = "00000000-0000-0000-0000-000000000000"

#: Every candidate-only route: (method, path). Mirrors the EXPECTED table in
#: tools/check_openapi.py, minus the routes any role may use.
CANDIDATE_ROUTES = [
    ("get", "/api/v1/profile"),
    ("patch", "/api/v1/profile"),
    ("get", "/api/v1/profile/completeness"),
    ("get", "/api/v1/profile/privacy"),
    ("put", "/api/v1/profile/privacy"),
    ("get", "/api/v1/profile/preferences"),
    ("put", "/api/v1/profile/preferences"),
    ("get", "/api/v1/profile/skills"),
    ("post", "/api/v1/profile/skills"),
    ("patch", f"/api/v1/profile/skills/{NOBODY}"),
    ("delete", f"/api/v1/profile/skills/{NOBODY}"),
]

for _section in (
    "education",
    "experience",
    "projects",
    "certifications",
    "achievements",
):
    CANDIDATE_ROUTES += [
        ("get", f"/api/v1/profile/{_section}"),
        ("post", f"/api/v1/profile/{_section}"),
        ("patch", f"/api/v1/profile/{_section}/{NOBODY}"),
        ("delete", f"/api/v1/profile/{_section}/{NOBODY}"),
    ]

ROUTE_IDS = [f"{method.upper()} {path}" for method, path in CANDIDATE_ROUTES]

#: Routes every authenticated role may use, whatever it is, paired with the query
#: each one needs. ``availability`` takes a ``username`` and answers 422 without
#: one, so a bare GET would be testing the wrong thing.
SHARED_ROUTES = [
    ("/api/v1/users/me", {}),
    ("/api/v1/users/me/username/availability", {"username": "definitely_not_taken_1"}),
    ("/api/v1/skills/catalog", {}),
    ("/api/v1/onboarding/state", {}),
]

SHARED_IDS = [path for path, _ in SHARED_ROUTES]


def _call(api_client, method: str, path: str, headers=None) -> object:
    kwargs = {} if headers is None else {"headers": headers}
    return getattr(api_client, method)(path, **kwargs)


@pytest.mark.parametrize("method,path", CANDIDATE_ROUTES, ids=ROUTE_IDS)
def test_a_candidate_route_needs_a_token_before_anything_else(
    api_client, method, path
) -> None:
    """401 first: otherwise the status code says which roles a route exists for."""

    response = _call(api_client, method, path)

    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "not_authenticated"


@pytest.mark.parametrize("method,path", CANDIDATE_ROUTES, ids=ROUTE_IDS)
def test_an_employer_is_refused_every_candidate_route(
    api_client, employer, method, path
) -> None:
    """A role that may not use the route gets 403, not 404 and not 200."""

    response = _call(api_client, method, path, headers=employer.headers)

    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "forbidden"


@pytest.mark.parametrize("path,params", SHARED_ROUTES, ids=SHARED_IDS)
def test_the_shared_routes_are_open_to_every_role(
    api_client, candidate, employer, path, params
) -> None:
    """The same sweep, inverted: these must *not* be candidate-only.

    The client calls ``/onboarding/state`` from its role guard for all three
    sign-ups, and reads the catalogue from the employer's skill picker.
    """

    for headers in (candidate.headers, employer.headers):
        assert api_client.get(path, params=params, headers=headers).status_code == 200


@pytest.mark.parametrize("path,params", SHARED_ROUTES, ids=SHARED_IDS)
def test_the_shared_routes_still_require_a_token(api_client, path, params) -> None:
    assert api_client.get(path, params=params).status_code == 401


# --- self-only ---------------------------------------------------------------


def test_a_client_cannot_name_the_account_it_is_editing(api_client, candidate) -> None:
    """No route here accepts a user id; they all read ``current_user.id``.

    Sending one is an error rather than something that could be aimed at another
    account — `extra="forbid"` means the request is refused outright.
    """

    response = api_client.patch(
        "/api/v1/profile",
        json={"headline": "Hello", "user_id": "someone-else"},
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text


def test_another_accounts_rows_are_never_listed(
    api_client, candidate, other_candidate, make_skill
) -> None:
    """The list endpoints are scoped in the query, not filtered afterwards."""

    api_client.post(
        "/api/v1/profile/education",
        json={"institution": "Theirs"},
        headers=other_candidate.headers,
    )
    api_client.post(
        "/api/v1/profile/skills",
        json={"skill_id": str(make_skill("Python").id), "level": "expert"},
        headers=other_candidate.headers,
    )

    for path in (
        "/api/v1/profile",
        "/api/v1/profile/education",
        "/api/v1/profile/skills",
    ):
        body = api_client.get(path, headers=candidate.headers).json()
        rows = body["items"] if "items" in body else body["education"]
        assert rows == [], f"{path} leaked another account's rows"


def test_privacy_and_preferences_are_the_callers_own(
    api_client, candidate, other_candidate
) -> None:
    """Two accounts cannot share one privacy row or one preference row."""

    # `PUT` here is full state, so all five flags have to be stated.
    written = api_client.put(
        "/api/v1/profile/privacy",
        json={
            "profile_visibility": "public",
            "discoverable": True,
            "allow_messages": True,
            "show_email": False,
            "show_phone": False,
        },
        headers=other_candidate.headers,
    )
    assert written.status_code == 200, written.text
    api_client.put(
        "/api/v1/profile/preferences",
        json={"work_modes": ["remote"], "employment_types": ["full_time"]},
        headers=other_candidate.headers,
    )

    mine = api_client.get("/api/v1/profile", headers=candidate.headers).json()
    theirs = api_client.get(
        "/api/v1/profile", headers=other_candidate.headers
    ).json()

    assert theirs["privacy"]["profile_visibility"] == "public"
    assert theirs["preferences"]["work_modes"] == ["remote"]
    # A fresh account still reads the column defaults, not the other row's values.
    assert mine["privacy"]["profile_visibility"] == "private"
    assert mine["preferences"] is None


def test_an_employer_cannot_reach_the_candidate_routes_by_id(
    api_client, candidate, employer
) -> None:
    """The role guard answers before ownership, so the id never matters."""

    created = api_client.post(
        "/api/v1/profile/education",
        json={"institution": "Somewhere"},
        headers=candidate.headers,
    ).json()

    response = api_client.delete(
        f"/api/v1/profile/education/{created['id']}", headers=employer.headers
    )

    assert response.status_code == 403
    assert (
        api_client.get("/api/v1/profile/education", headers=candidate.headers).json()[
            "total"
        ]
        == 1
    )

