"""The four uniform sections: education, experience, certifications, achievements.

The server builds these four from one factory (`_register_section`), so they are
tested by one parametrised suite rather than four near-copies. A contract asserted
only for education is a contract that can silently differ for achievements — the
factory is *why* they agree today, and these tests are what notice if it stops.

The section-specific tests at the bottom cover the rules that are genuinely not
shared: each schema's date or vocabulary checks, which must arrive as a 422 naming
the field rather than a 500 from a database CHECK.
"""

from __future__ import annotations

import pytest

#: (path segment, create body, field a PATCH may change, value to set it to).
SECTIONS = [
    (
        "education",
        {"institution": "Indian Institute of Technology", "level": "undergraduate"},
        "institution",
        "A different university",
    ),
    (
        "experience",
        {"title": "Backend Engineer", "company_name": "Acme", "current": True},
        "title",
        "Staff Engineer",
    ),
    (
        "certifications",
        {"title": "Solutions Architect", "issuer": "AWS"},
        "issuer",
        "Google Cloud",
    ),
    (
        "achievements",
        {"title": "Hackathon winner", "category": "hackathon"},
        "category",
        "award",
    ),
]

SECTION_IDS = [section[0] for section in SECTIONS]


def _url(path: str, record_id: str | None = None) -> str:
    base = f"/api/v1/profile/{path}"
    return base if record_id is None else f"{base}/{record_id}"


def _create(api_client, account, path: str, body: dict) -> dict:
    response = api_client.post(_url(path), json=body, headers=account.headers)
    assert response.status_code == 201, response.text
    return response.json()


# --- the shared contract -----------------------------------------------------


@pytest.mark.parametrize("path,body,field,value", SECTIONS, ids=SECTION_IDS)
def test_a_section_starts_empty(
    api_client, candidate, path, body, field, value
) -> None:
    response = api_client.get(_url(path), headers=candidate.headers)

    assert response.status_code == 200
    envelope = response.json()
    assert envelope["items"] == []
    assert envelope["total"] == 0
    assert envelope["has_more"] is False


@pytest.mark.parametrize("path,body,field,value", SECTIONS, ids=SECTION_IDS)
def test_creating_a_row_stores_it_and_lists_it(
    api_client, candidate, path, body, field, value
) -> None:
    created = _create(api_client, candidate, path, body)

    assert created["id"]
    for key in body:
        assert key in created, f"the read model must echo {key}"
    assert created["created_at"] and created["updated_at"]

    listed = api_client.get(_url(path), headers=candidate.headers).json()
    assert listed["total"] == 1
    assert [row["id"] for row in listed["items"]] == [created["id"]]


@pytest.mark.parametrize("path,body,field,value", SECTIONS, ids=SECTION_IDS)
def test_patch_changes_only_what_was_sent(
    api_client, candidate, path, body, field, value
) -> None:
    created = _create(api_client, candidate, path, body)

    response = api_client.patch(
        _url(path, created["id"]), json={field: value}, headers=candidate.headers
    )

    assert response.status_code == 200, response.text
    assert response.json()[field] == value
    # `exclude_unset` is the rule everywhere: an absent key must not be nulled.
    for key, original in body.items():
        if key != field:
            assert response.json()[key] == original, f"{key} was cleared by a PATCH"


@pytest.mark.parametrize("path,body,field,value", SECTIONS, ids=SECTION_IDS)
def test_delete_removes_it_and_a_second_delete_is_404(
    api_client, candidate, path, body, field, value
) -> None:
    created = _create(api_client, candidate, path, body)

    first = api_client.delete(_url(path, created["id"]), headers=candidate.headers)
    assert first.status_code == 204
    assert api_client.get(_url(path), headers=candidate.headers).json()["total"] == 0

    second = api_client.delete(_url(path, created["id"]), headers=candidate.headers)
    assert second.status_code == 404
    assert second.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("path,body,field,value", SECTIONS, ids=SECTION_IDS)
def test_a_malformed_id_is_404_not_422(
    api_client, candidate, path, body, field, value
) -> None:
    """A UUID-shaped oracle is a real leak; `parse_id` answers 404 instead."""

    for raw in ("nonsense", "00000000-0000-0000-0000-000000000000"):
        response = api_client.patch(
            _url(path, raw), json={field: value}, headers=candidate.headers
        )
        assert response.status_code == 404, response.text


@pytest.mark.parametrize("path,body,field,value", SECTIONS, ids=SECTION_IDS)
def test_another_users_row_answers_404_not_403(
    api_client, candidate, other_candidate, path, body, field, value
) -> None:
    """A 403 on someone else's row would confirm it exists.

    Both "no such id" and "not yours" answer 404, so the endpoint cannot be used
    to count how many education entries the platform holds.
    """

    theirs = _create(api_client, other_candidate, path, body)

    for response in (
        api_client.patch(
            _url(path, theirs["id"]), json={field: value}, headers=candidate.headers
        ),
        api_client.delete(_url(path, theirs["id"]), headers=candidate.headers),
    ):
        assert response.status_code == 404, response.text
        assert response.json()["error"]["code"] == "not_found"

    # And the row survived both attempts.
    assert (
        api_client.get(_url(path), headers=other_candidate.headers).json()["total"] == 1
    )


@pytest.mark.parametrize("path,body,field,value", SECTIONS, ids=SECTION_IDS)
def test_an_employer_is_refused_the_section(
    api_client, employer, path, body, field, value
) -> None:
    """The role guard answers 403 — the client renders its "not available" state."""

    response = api_client.get(_url(path), headers=employer.headers)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


@pytest.mark.parametrize("path,body,field,value", SECTIONS, ids=SECTION_IDS)
def test_a_section_requires_a_token(api_client, path, body, field, value) -> None:
    assert api_client.get(_url(path)).status_code == 401
    assert api_client.post(_url(path), json=body).status_code == 401


@pytest.mark.parametrize("path,body,field,value", SECTIONS, ids=SECTION_IDS)
def test_an_unknown_field_is_422(
    api_client, candidate, path, body, field, value
) -> None:
    """`extra="forbid"`: a field the server does not know is an error, not a no-op.

    Silently dropping it is how a client ends up believing a change was saved.
    """

    response = api_client.post(
        _url(path), json={**body, "not_a_real_field": 1}, headers=candidate.headers
    )

    assert response.status_code == 422, response.text
    assert api_client.get(_url(path), headers=candidate.headers).json()["total"] == 0


def test_the_aggregate_lists_what_a_section_wrote(api_client, candidate) -> None:
    """The aggregate is the screen's data source; the two must agree."""

    education = _create(
        api_client, candidate, "education", {"institution": "Universe of Testing"}
    )
    experience = _create(
        api_client,
        candidate,
        "experience",
        {"title": "Engineer", "company_name": "Acme"},
    )

    body = api_client.get("/api/v1/profile", headers=candidate.headers).json()

    assert [row["id"] for row in body["education"]] == [education["id"]]
    assert [row["id"] for row in body["experience"]] == [experience["id"]]


# --- the rules that are not shared ------------------------------------------
#
# Each schema carries its own composite check. They must answer 422 — the form can
# render a message that names a field — and never 500 from the database CHECK
# that backs the same rule.


def test_an_inverted_education_range_is_422(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/profile/education",
        json={
            "institution": "Somewhere",
            "start_date": "2022-06-01",
            "end_date": "2020-06-01",
        },
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text
    assert "end_date" in response.text


def test_a_current_education_entry_cannot_have_an_end_date(
    api_client, candidate
) -> None:
    response = api_client.post(
        "/api/v1/profile/education",
        json={
            "institution": "Somewhere",
            "start_date": "2022-06-01",
            "current": True,
            "end_date": "2024-06-01",
        },
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text


def test_an_inverted_experience_range_is_422(api_client, candidate) -> None:
    """Experience reuses the education check; this is what proves it does."""

    response = api_client.post(
        "/api/v1/profile/experience",
        json={
            "title": "Engineer",
            "company_name": "Acme",
            "start_date": "2022-06-01",
            "end_date": "2020-06-01",
        },
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text


def test_a_certificate_cannot_expire_before_it_was_issued(
    api_client, candidate
) -> None:
    response = api_client.post(
        "/api/v1/profile/certifications",
        json={
            "title": "Solutions Architect",
            "issuer": "AWS",
            "issued_on": "2024-01-01",
            "expires_on": "2023-01-01",
        },
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text
    assert "expires_on" in response.text


def test_an_achievement_requires_a_category(api_client, candidate) -> None:
    """The column is NOT NULL and the mobile union is closed, so this is required."""

    response = api_client.post(
        "/api/v1/profile/achievements",
        json={"title": "Something"},
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text


def test_an_achievement_category_outside_the_union_is_422(
    api_client, candidate
) -> None:
    response = api_client.post(
        "/api/v1/profile/achievements",
        json={"title": "Something", "category": "made-up-category"},
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text


def test_a_section_list_pages_with_the_offset_envelope(api_client, candidate) -> None:
    """`limit`/`offset` are the shared `page_params`, bounded at 200."""

    for index in range(3):
        _create(
            api_client,
            candidate,
            "education",
            {"institution": f"University {index}"},
        )

    page = api_client.get(
        "/api/v1/profile/education?limit=2&offset=0", headers=candidate.headers
    ).json()

    assert page["limit"] == 2 and page["offset"] == 0
    assert page["total"] == 3
    assert len(page["items"]) == 2
    assert page["has_more"] is True

    # `has_more` is computed against the *unfiltered* total, so a full final page
    # still reports itself as the last one rather than promising a third.
    last = api_client.get(
        "/api/v1/profile/education?limit=2&offset=2", headers=candidate.headers
    ).json()

    assert last["offset"] == 2
    assert len(last["items"]) == 1
    assert last["has_more"] is False

    too_big = api_client.get(
        "/api/v1/profile/education?limit=9999", headers=candidate.headers
    )
    assert too_big.status_code == 422
