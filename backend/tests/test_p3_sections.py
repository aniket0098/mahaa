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


def test_ordinary_education_values_are_accepted(api_client, candidate) -> None:
    """Real college and degree names, verbatim.

    Nothing here is normalised, case-folded or pattern-matched on the way in. The
    "more freedom" requirement is that a real institution name is not a validation
    failure -- punctuation, accents and non-Latin script all belong in a profile.
    """

    names = [
        ("Government College of Engineering, Nagpur", "B.Tech. Computer Science & Engineering"),
        ("St. Xavier's College - Mumbai", "B.E. Computer Engineering"),
        ("Smt. XYZ College", "12th (HSC)"),
        ("Réseau Polytechnique", "Master of Science — Data Science"),
        ("शासकीय अभियांत्रिकी महाविद्यालय", "B.Tech"),
    ]

    for institution, degree in names:
        response = api_client.post(
            "/api/v1/profile/education",
            json={"institution": institution, "degree": degree},
            headers=candidate.headers,
        )
        assert response.status_code == 201, f"{institution}: {response.text}"
        # Stored exactly as sent. A trimmmed or reformatted value would show up
        # here, and the profile screen renders what is stored.
        assert response.json()["institution"] == institution
        assert response.json()["degree"] == degree


def test_a_partial_date_is_accepted_and_filled(api_client, candidate) -> None:
    """A year, or a year and a month, is how people actually answer this.

    The onboarding form's helper text says "YYYY-MM" while the schema is typed
    ``date``, so following the UI's own instruction produced a 422 that surfaced
    as a nameless "That did not save". Verified against the running API before the
    fix: ``"2024-03"`` -> 422, ``"2026"`` -> 422, ``"2026-06-01"`` -> 201.

    A missing day or month is filled with the **first** of the period, so the
    stored value stays a real, ordered date and the range check below still works.
    """

    for written, stored in [
        ("2026", "2026-01-01"),
        ("2026-06", "2026-06-01"),
        ("2026/06", "2026-06-01"),
        ("2026-06-15", "2026-06-15"),
    ]:
        response = api_client.post(
            "/api/v1/profile/education",
            json={"institution": "Somewhere", "end_date": written},
            headers=candidate.headers,
        )
        assert response.status_code == 201, f"{written}: {response.text}"
        assert response.json()["end_date"] == stored


def test_an_impossible_date_is_still_422(api_client, candidate) -> None:
    """Widening the *precision* accepted must not become accepting nonsense.

    Free text and impossible calendar dates stay errors, and they stay 422s that
    name the field -- so the client can put the message next to the right input
    rather than reporting a generic save failure.
    """

    for written in ("next summer", "2026-13", "2026-02-30", "2026-06-00", "26th June"):
        response = api_client.post(
            "/api/v1/profile/education",
            json={"institution": "Somewhere", "end_date": written},
            headers=candidate.headers,
        )
        assert response.status_code == 422, f"{written}: {response.text}"
        assert "end_date" in response.text


def test_a_partial_date_still_participates_in_the_range_check(
    api_client, candidate
) -> None:
    """The widened parse must not make the ordering rule meaningless.

    ``2020`` becomes ``2020-01-01``, which is genuinely before a 2022 start, so an
    inverted range written in the short form is still caught rather than silently
    accepted because the day was defaulted.
    """

    response = api_client.post(
        "/api/v1/profile/education",
        json={
            "institution": "Somewhere",
            "start_date": "2022",
            "end_date": "2020",
        },
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text
    assert "end_date" in response.text


def test_an_empty_optional_date_clears_rather_than_fails(
    api_client, candidate
) -> None:
    """A cleared text field submits ``""``, which must mean "no date".

    Left as an unparseable date this is a 422 on a PATCH somebody made to *remove*
    something, which is the opposite of what they asked for.
    """

    created = api_client.post(
        "/api/v1/profile/education",
        json={"institution": "Somewhere", "end_date": "2026-06-15"},
        headers=candidate.headers,
    )
    assert created.status_code == 201, created.text
    row_id = created.json()["id"]

    cleared = api_client.patch(
        f"/api/v1/profile/education/{row_id}",
        json={"current": False, "end_date": ""},
        headers=candidate.headers,
    )

    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["end_date"] is None


def test_an_empty_institution_is_still_422(api_client, candidate) -> None:
    """The one required field on this step stays required.

    ``min_length=1`` is a real data-integrity rule: an education row with no
    institution says nothing, and this step's gate counts rows.
    """

    response = api_client.post(
        "/api/v1/profile/education",
        json={"institution": "", "degree": "B.Tech"},
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text
    assert "institution" in response.text


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
