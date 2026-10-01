"""``/skills/catalog`` and ``/profile/skills`` — the catalogue and the join row.

Two different things share a name, so the tests separate them deliberately: the
catalogue is shared reference data any authenticated role may read, while
``/profile/skills`` is candidate-only and scoped to the caller.

The ``%``-escaping test exists because a search box that treats ``%`` as a wildcard
silently returns the entire table — a correctness bug and an easy way to page
through every skill on the platform.
"""

from __future__ import annotations


def _catalog(api_client, account, query: str = "") -> dict:
    response = api_client.get(
        "/api/v1/skills/catalog", params={"q": query}, headers=account.headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def _add(api_client, account, skill_id: str, **overrides) -> dict:
    payload = {"skill_id": str(skill_id), "level": "intermediate", **overrides}
    response = api_client.post(
        "/api/v1/profile/skills", json=payload, headers=account.headers
    )
    assert response.status_code == 201, response.text
    return response.json()


# --- the catalogue -----------------------------------------------------------


def test_the_catalogue_requires_a_token(api_client) -> None:
    assert api_client.get("/api/v1/skills/catalog").status_code == 401


def test_an_employer_may_search_the_catalogue(api_client, employer) -> None:
    """Deliberately not candidate-only: it is shared reference data.

    Restricting it would be an arbitrary rule rather than a real boundary — an
    employer's own skill picker reads the same rows.
    """

    response = api_client.get("/api/v1/skills/catalog", headers=employer.headers)

    assert response.status_code == 200
    assert set(response.json()) == {"items", "total", "limit", "offset", "has_more"}


def test_an_empty_search_lists_the_whole_catalogue(
    api_client, candidate, make_skill
) -> None:
    first = make_skill("Python")
    make_skill("Rust")

    page = _catalog(api_client, candidate)

    ids = [row["id"] for row in page["items"]]
    assert str(first.id) in ids
    assert page["total"] == 2
    assert page["has_more"] is False


def test_a_search_matches_name_or_category_case_insensitively(
    api_client, candidate, make_skill
) -> None:
    make_skill("PostgreSQL", category="Databases")
    make_skill("Kubernetes", category="Infrastructure")

    by_name = _catalog(api_client, candidate, "postgre")
    by_category = _catalog(api_client, candidate, "infrastructure")

    assert [row["name"] for row in by_name["items"]] == ["PostgreSQL"]
    assert [row["name"] for row in by_category["items"]] == ["Kubernetes"]


def test_a_percent_sign_is_searched_for_literally(
    api_client, candidate, make_skill
) -> None:
    """Without escaping, ``%`` matches every row in the table."""

    make_skill("100% Remote")
    make_skill("Python")

    page = _catalog(api_client, candidate, "%")

    assert [row["name"] for row in page["items"]] == ["100% Remote"]
    assert page["total"] == 1


def test_a_search_that_matches_nothing_is_an_empty_page(
    api_client, candidate, make_skill
) -> None:
    make_skill("Python")

    page = _catalog(api_client, candidate, "definitely-not-a-skill")

    assert page["items"] == []
    assert page["total"] == 0
    assert page["has_more"] is False


def test_the_catalogue_pages_with_the_offset_envelope(
    api_client, candidate, make_skill
) -> None:
    for index in range(3):
        make_skill(f"Skill {index}")

    page = api_client.get(
        "/api/v1/skills/catalog",
        params={"limit": 2, "offset": 0},
        headers=candidate.headers,
    ).json()

    assert page["total"] == 3
    assert len(page["items"]) == 2
    assert page["has_more"] is True

    last = api_client.get(
        "/api/v1/skills/catalog",
        params={"limit": 2, "offset": 2},
        headers=candidate.headers,
    ).json()

    assert len(last["items"]) == 1
    assert last["has_more"] is False


def test_a_catalogue_row_carries_no_private_fields(
    api_client, candidate, make_skill
) -> None:
    """The read model is `{id, name, category}` and nothing else."""

    make_skill("Python", category="Languages")

    row = _catalog(api_client, candidate, "Python")["items"][0]

    assert set(row) == {"id", "name", "category"}


# --- /profile/skills ---------------------------------------------------------


def test_a_profile_skill_list_starts_empty(api_client, candidate) -> None:
    page = api_client.get("/api/v1/profile/skills", headers=candidate.headers).json()

    assert page["items"] == []
    assert page["total"] == 0


def test_adding_a_skill_resolves_the_catalogue_name(
    api_client, candidate, make_skill
) -> None:
    """The client picks from the catalogue, so the name comes from the row."""

    skill = make_skill("Python", category="Languages")

    created = _add(api_client, candidate, skill.id, years=4)

    assert created["skill_id"] == str(skill.id)
    assert created["name"] == "Python"
    assert created["category"] == "Languages"
    assert created["level"] == "intermediate"
    assert created["years"] == 4
    assert created["verified"] is False
    assert created["source"] == "self"


def test_adding_a_skill_that_is_not_in_the_catalogue_is_404(
    api_client, candidate
) -> None:
    """A skill is a row with its own identity, not free text to be created here."""

    response = api_client.post(
        "/api/v1/profile/skills",
        json={"skill_id": "00000000-0000-0000-0000-000000000000", "level": "expert"},
        headers=candidate.headers,
    )

    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "not_found"
    page = api_client.get("/api/v1/profile/skills", headers=candidate.headers).json()
    assert page["total"] == 0


def test_a_malformed_skill_id_is_404(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/profile/skills",
        json={"skill_id": "not-a-uuid", "level": "expert"},
        headers=candidate.headers,
    )

    assert response.status_code == 404


def test_adding_the_same_skill_twice_is_409(
    api_client, candidate, make_skill
) -> None:
    """A 201 for a duplicate would leave the client showing a row that is not there."""

    skill = make_skill("Python")
    _add(api_client, candidate, skill.id)

    response = api_client.post(
        "/api/v1/profile/skills",
        json={"skill_id": str(skill.id), "level": "advanced"},
        headers=candidate.headers,
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"
    page = api_client.get("/api/v1/profile/skills", headers=candidate.headers).json()
    assert page["total"] == 1


def test_patch_updates_level_and_years(api_client, candidate, make_skill) -> None:
    skill = make_skill("Python")
    created = _add(api_client, candidate, skill.id, years=1)

    response = api_client.patch(
        f"/api/v1/profile/skills/{created['id']}",
        json={"level": "expert", "years": 9},
        headers=candidate.headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["level"] == "expert"
    assert response.json()["years"] == 9


def test_patch_cannot_repoint_a_skill_to_another_catalogue_row(
    api_client, candidate, make_skill
) -> None:
    """`skill_id` is absent on purpose: repointing would bypass the duplicate check."""

    first = make_skill("Python")
    second = make_skill("Rust")
    created = _add(api_client, candidate, first.id)

    response = api_client.patch(
        f"/api/v1/profile/skills/{created['id']}",
        json={"skill_id": str(second.id), "level": "advanced"},
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text

    still = api_client.get(
        "/api/v1/profile/skills", headers=candidate.headers
    ).json()["items"][0]
    assert still["skill_id"] == str(first.id)


def test_an_unknown_field_on_a_skill_patch_is_422(
    api_client, candidate, make_skill
) -> None:
    """`verified` is server-owned; a client that sets it is answered, not obeyed."""

    created = _add(api_client, candidate, make_skill("Python").id)

    response = api_client.patch(
        f"/api/v1/profile/skills/{created['id']}",
        json={"verified": True},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_an_invalid_level_is_422(api_client, candidate, make_skill) -> None:
    skill = make_skill("Python")

    response = api_client.post(
        "/api/v1/profile/skills",
        json={"skill_id": str(skill.id), "level": "legendary"},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_removing_a_skill_is_404_the_second_time(
    api_client, candidate, make_skill
) -> None:
    created = _add(api_client, candidate, make_skill("Python").id)

    first = api_client.delete(
        f"/api/v1/profile/skills/{created['id']}", headers=candidate.headers
    )
    second = api_client.delete(
        f"/api/v1/profile/skills/{created['id']}", headers=candidate.headers
    )

    assert first.status_code == 204
    assert second.status_code == 404


def test_another_users_skill_row_is_404(
    api_client, candidate, other_candidate, make_skill
) -> None:
    skill = make_skill("Python")
    theirs = _add(api_client, other_candidate, skill.id)

    for response in (
        api_client.patch(
            f"/api/v1/profile/skills/{theirs['id']}",
            json={"level": "expert"},
            headers=candidate.headers,
        ),
        api_client.delete(
            f"/api/v1/profile/skills/{theirs['id']}", headers=candidate.headers
        ),
    ):
        assert response.status_code == 404, response.text

    left = api_client.get(
        "/api/v1/profile/skills", headers=other_candidate.headers
    ).json()
    assert left["total"] == 1


def test_an_employer_is_refused_the_profile_skills(api_client, employer) -> None:
    """The catalogue is open to every role; attaching one to *you* is not."""

    response = api_client.get("/api/v1/profile/skills", headers=employer.headers)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_a_profile_skill_requires_a_token(api_client) -> None:
    assert api_client.get("/api/v1/profile/skills").status_code == 401
    assert (
        api_client.post(
            "/api/v1/profile/skills",
            json={
                "skill_id": "00000000-0000-0000-0000-000000000000",
                "level": "expert",
            },
        ).status_code
        == 401
    )


def _skills_section(api_client, account) -> dict:
    body = api_client.get(
        "/api/v1/profile/completeness", headers=account.headers
    ).json()
    return next(section for section in body["sections"] if section["key"] == "skills")


def test_the_skills_section_counts_real_rows(
    api_client, candidate, make_skill
) -> None:
    """Completeness credits a skill only once three exist — two must not be enough."""

    for name in ("Python", "Rust"):
        _add(api_client, candidate, make_skill(name).id)

    before = _skills_section(api_client, candidate)
    assert before["complete"] is False

    _add(api_client, candidate, make_skill("Go").id)

    after = _skills_section(api_client, candidate)
    assert after["complete"] is True

