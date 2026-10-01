"""``/profile`` â€” the aggregate, identity, completeness, privacy, preferences.

The completeness tests matter most here: the number is server-derived and the
integration suite asserts it *moves because real records were written*, so these
tests write real records rather than stubbing the calculation.
"""

from __future__ import annotations

# --- aggregate --------------------------------------------------------------


def test_the_aggregate_has_every_collection(api_client, candidate) -> None:
    """The seven keys the integration suite checks with `Array.isArray`."""

    response = api_client.get("/api/v1/profile", headers=candidate.headers)

    assert response.status_code == 200
    body = response.json()
    for key in (
        "education",
        "experience",
        "projects",
        "certifications",
        "achievements",
        "links",
        "skills",
    ):
        assert isinstance(body[key], list), f"aggregate.{key} must be an array"


def test_a_new_profile_reads_as_empty_not_missing(api_client, candidate) -> None:
    """The rows are created lazily on first read, with the column defaults."""

    body = api_client.get("/api/v1/profile", headers=candidate.headers).json()

    assert body["identity"]["headline"] is None
    assert body["identity"]["interests"] == []
    assert body["education"] == []
    # `preferences` is null, not {}: "never configured" and "configured empty"
    # are different states and the client types it that way.
    assert body["preferences"] is None


def test_the_aggregate_carries_the_identity_fields(api_client, candidate) -> None:
    body = api_client.get("/api/v1/profile", headers=candidate.headers).json()

    identity = body["identity"]
    assert identity["user_id"] == candidate.id
    assert identity["email"] == candidate.email
    assert identity["public_id"].startswith("MJ-")
    assert identity["profile_updated_at"]


def test_the_aggregate_never_leaks_the_password_hash(api_client, candidate) -> None:
    text = api_client.get("/api/v1/profile", headers=candidate.headers).text.lower()

    assert "password" not in text
    assert "argon2" not in text


def test_the_aggregate_requires_a_token(api_client) -> None:
    assert api_client.get("/api/v1/profile").status_code == 401


def test_an_employer_is_refused_the_candidate_profile(api_client, employer) -> None:
    """The integration suite asserts a 403 here, not a 404 and not a 200.

    The route exists and the caller is authenticated; their role simply may not use
    it, and the client relies on the 403 to show its "not available to you" state.
    """

    response = api_client.get("/api/v1/profile", headers=employer.headers)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


# --- identity ---------------------------------------------------------------


def test_identity_patch_sets_the_fields(api_client, candidate) -> None:
    response = api_client.patch(
        "/api/v1/profile",
        json={"headline": "Backend engineer", "location": "Pune"},
        headers=candidate.headers,
    )

    assert response.status_code == 200
    assert response.json()["headline"] == "Backend engineer"
    assert response.json()["location"] == "Pune"


def test_identity_patch_leaves_absent_fields_alone(api_client, candidate) -> None:
    api_client.patch(
        "/api/v1/profile",
        json={"headline": "Keep me", "summary": "Keep me too"},
        headers=candidate.headers,
    )

    response = api_client.patch(
        "/api/v1/profile", json={"headline": "Changed"}, headers=candidate.headers
    )

    assert response.json()["summary"] == "Keep me too"


def test_identity_patch_can_clear_a_field(api_client, candidate) -> None:
    api_client.patch(
        "/api/v1/profile", json={"headline": "Temporary"}, headers=candidate.headers
    )

    response = api_client.patch(
        "/api/v1/profile", json={"headline": None}, headers=candidate.headers
    )

    assert response.json()["headline"] is None


def test_identity_patch_stores_interests(api_client, candidate) -> None:
    response = api_client.patch(
        "/api/v1/profile",
        json={"interests": ["backend", "  databases  "]},
        headers=candidate.headers,
    )

    assert response.json()["interests"] == ["backend", "databases"]


def test_identity_patch_rejects_an_unknown_field(api_client, candidate) -> None:
    response = api_client.patch(
        "/api/v1/profile", json={"completeness": 100}, headers=candidate.headers
    )

    assert response.status_code == 422


def test_identity_patch_rejects_too_many_interests(api_client, candidate) -> None:
    response = api_client.patch(
        "/api/v1/profile",
        json={"interests": [f"i{n}" for n in range(30)]},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_the_aggregate_reflects_an_identity_patch(api_client, candidate) -> None:
    api_client.patch(
        "/api/v1/profile",
        json={"headline": "Visible everywhere"},
        headers=candidate.headers,
    )

    body = api_client.get("/api/v1/profile", headers=candidate.headers).json()

    assert body["identity"]["headline"] == "Visible everywhere"



# --- completeness -----------------------------------------------------------


def test_completeness_starts_at_zero(api_client, candidate) -> None:
    body = api_client.get(
        "/api/v1/profile/completeness", headers=candidate.headers
    ).json()

    assert body["percent"] == 0
    assert len(body["sections"]) > 0
    assert all(section["earned"] == 0 for section in body["sections"])


def test_completeness_agrees_with_the_aggregate(api_client, candidate) -> None:
    """The two endpoints must not be two implementations of the same rule."""

    standalone = api_client.get(
        "/api/v1/profile/completeness", headers=candidate.headers
    ).json()
    aggregate = api_client.get("/api/v1/profile", headers=candidate.headers).json()

    assert standalone["percent"] == aggregate["completeness"]["percent"]


def test_completeness_rises_after_real_writes(api_client, candidate) -> None:
    """The integration suite's central claim: the number moves because data did."""

    before = api_client.get(
        "/api/v1/profile/completeness", headers=candidate.headers
    ).json()["percent"]

    api_client.post(
        "/api/v1/profile/experience",
        json={"title": "Intern", "company_name": "Somewhere"},
        headers=candidate.headers,
    )

    after = api_client.get(
        "/api/v1/profile/completeness", headers=candidate.headers
    ).json()["percent"]

    assert after > before


def test_completeness_is_never_outside_zero_to_one_hundred(
    api_client, candidate
) -> None:
    api_client.post(
        "/api/v1/profile/education",
        json={"institution": "Somewhere University"},
        headers=candidate.headers,
    )

    body = api_client.get(
        "/api/v1/profile/completeness", headers=candidate.headers
    ).json()

    assert 0 <= body["percent"] <= 100


def test_completeness_sections_report_weights_and_hints(api_client, candidate) -> None:
    body = api_client.get(
        "/api/v1/profile/completeness", headers=candidate.headers
    ).json()

    for section in body["sections"]:
        assert section["key"]
        assert section["label"]
        assert section["weight"] > 0
        assert 0 <= section["earned"] <= section["weight"]
        assert section["hint"]


def test_the_weights_sum_to_one_hundred(api_client, candidate) -> None:
    """The weights are the whole basis of the percentage, so they must add up."""

    body = api_client.get(
        "/api/v1/profile/completeness", headers=candidate.headers
    ).json()

    assert sum(section["weight"] for section in body["sections"]) == 100


def test_the_skills_section_needs_three(api_client, candidate, make_skill) -> None:
    """The wizard's own copy says "at least three skills", so the rule must match."""

    for _ in range(2):
        skill = make_skill()
        api_client.post(
            "/api/v1/profile/skills",
            json={"skill_id": str(skill.id), "level": "intermediate"},
            headers=candidate.headers,
        )

    after_two = api_client.get(
        "/api/v1/profile/completeness", headers=candidate.headers
    ).json()
    skills_section = next(s for s in after_two["sections"] if s["key"] == "skills")
    assert skills_section["complete"] is False

    skill = make_skill()
    api_client.post(
        "/api/v1/profile/skills",
        json={"skill_id": str(skill.id), "level": "intermediate"},
        headers=candidate.headers,
    )

    after_three = api_client.get(
        "/api/v1/profile/completeness", headers=candidate.headers
    ).json()
    skills_section = next(s for s in after_three["sections"] if s["key"] == "skills")
    assert skills_section["complete"] is True


def test_the_basics_section_credits_partial_progress(api_client, candidate) -> None:
    """One field at a time should visibly move the number, not wait for the last."""

    api_client.patch(
        "/api/v1/profile",
        json={"headline": "Just a headline"},
        headers=candidate.headers,
    )

    body = api_client.get(
        "/api/v1/profile/completeness", headers=candidate.headers
    ).json()

    basics = next(s for s in body["sections"] if s["key"] == "basics")
    assert 0 < basics["earned"] < basics["weight"]
    assert basics["complete"] is False


def test_completeness_requires_a_token(api_client) -> None:
    assert api_client.get("/api/v1/profile/completeness").status_code == 401



# --- privacy ----------------------------------------------------------------

PRIVACY_WRITE = {
    "profile_visibility": "public",
    "discoverable": True,
    "allow_messages": True,
    "show_email": True,
    "show_phone": False,
}


def test_privacy_defaults_to_private(api_client, candidate) -> None:
    """The documented defaults: private, not discoverable, contact hidden."""

    body = api_client.get("/api/v1/profile/privacy", headers=candidate.headers).json()

    assert body["profile_visibility"] == "private"
    assert body["discoverable"] is False
    assert body["show_email"] is False
    assert body["show_phone"] is False
    assert body["allow_messages"] is True


def test_privacy_round_trips_as_a_full_state_put(api_client, candidate) -> None:
    """The integration suite's read-modify-write, with `updated_at` excluded."""

    current = api_client.get(
        "/api/v1/profile/privacy", headers=candidate.headers
    ).json()
    writable = {
        "profile_visibility": current["profile_visibility"],
        "discoverable": not current["discoverable"],
        "allow_messages": current["allow_messages"],
        "show_email": current["show_email"],
        "show_phone": current["show_phone"],
    }

    saved = api_client.put(
        "/api/v1/profile/privacy", json=writable, headers=candidate.headers
    )

    assert saved.status_code == 200
    assert saved.json()["discoverable"] is writable["discoverable"]


def test_privacy_put_stores_every_field(api_client, candidate) -> None:
    response = api_client.put(
        "/api/v1/profile/privacy", json=PRIVACY_WRITE, headers=candidate.headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["profile_visibility"] == "public"
    assert body["show_email"] is True
    assert body["show_phone"] is False


def test_privacy_put_is_a_replacement_not_a_patch(api_client, candidate) -> None:
    """All five flags are required: a partial body would silently reset the rest."""

    response = api_client.put(
        "/api/v1/profile/privacy",
        json={"profile_visibility": "public"},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_privacy_rejects_an_invalid_visibility(api_client, candidate) -> None:
    response = api_client.put(
        "/api/v1/profile/privacy",
        json={**PRIVACY_WRITE, "profile_visibility": "everyone"},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_privacy_rejects_a_read_posted_straight_back(api_client, candidate) -> None:
    """`extra="forbid"` is what makes a readâ†’write round trip safe by hand."""

    current = api_client.get(
        "/api/v1/profile/privacy", headers=candidate.headers
    ).json()

    response = api_client.put(
        "/api/v1/profile/privacy", json=current, headers=candidate.headers
    )

    assert response.status_code == 422


def test_privacy_is_in_the_aggregate(api_client, candidate) -> None:
    api_client.put(
        "/api/v1/profile/privacy", json=PRIVACY_WRITE, headers=candidate.headers
    )

    body = api_client.get("/api/v1/profile", headers=candidate.headers).json()

    assert body["privacy"]["profile_visibility"] == "public"


def test_privacy_requires_a_token(api_client) -> None:
    assert api_client.get("/api/v1/profile/privacy").status_code == 401



# --- preferences ------------------------------------------------------------

PREFERENCES_WRITE = {
    "work_modes": ["remote", "hybrid"],
    "employment_types": ["internship", "full_time"],
    "preferred_locations": ["Pune", "Mumbai"],
    "salary_min": 500000,
    "salary_max": 900000,
    "currency": "INR",
    "availability_date": "2026-01-01",
    "willing_to_relocate": True,
}


def test_preferences_are_absent_before_they_are_set(api_client, candidate) -> None:
    """`null` in the aggregate, 404 on the dedicated read.

    Not an empty object: the client reads `profile.preferences?.work_modes`, and
    "never configured" must be distinguishable from "configured with nothing".
    """

    assert (
        api_client.get(
            "/api/v1/profile/preferences", headers=candidate.headers
        ).status_code
        == 404
    )
    assert (
        api_client.get("/api/v1/profile", headers=candidate.headers).json()[
            "preferences"
        ]
        is None
    )


def test_preferences_round_trip(api_client, candidate) -> None:
    response = api_client.put(
        "/api/v1/profile/preferences", json=PREFERENCES_WRITE, headers=candidate.headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["work_modes"] == ["remote", "hybrid"]
    assert body["employment_types"] == ["internship", "full_time"]
    assert body["salary_min"] == 500000
    assert body["willing_to_relocate"] is True


def test_preferences_appear_in_the_aggregate(api_client, candidate) -> None:
    """The integration suite reads `profile.preferences?.work_modes`."""

    api_client.put(
        "/api/v1/profile/preferences", json=PREFERENCES_WRITE, headers=candidate.headers
    )

    body = api_client.get("/api/v1/profile", headers=candidate.headers).json()

    assert body["preferences"]["work_modes"] == ["remote", "hybrid"]


def test_preferences_uppercase_the_currency(api_client, candidate) -> None:
    response = api_client.put(
        "/api/v1/profile/preferences",
        json={**PREFERENCES_WRITE, "currency": "inr"},
        headers=candidate.headers,
    )

    assert response.json()["currency"] == "INR"


def test_preferences_reject_an_inverted_salary_range(api_client, candidate) -> None:
    response = api_client.put(
        "/api/v1/profile/preferences",
        json={**PREFERENCES_WRITE, "salary_min": 900000, "salary_max": 100},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_preferences_reject_an_unknown_work_mode(api_client, candidate) -> None:
    response = api_client.put(
        "/api/v1/profile/preferences",
        json={**PREFERENCES_WRITE, "work_modes": ["from_the_desk"]},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_preferences_reject_a_server_owned_field(api_client, candidate) -> None:
    response = api_client.put(
        "/api/v1/profile/preferences",
        json={**PREFERENCES_WRITE, "updated_at": "2020-01-01T00:00:00"},
        headers=candidate.headers,
    )

    assert response.status_code == 422


def test_preferences_require_a_token(api_client) -> None:
    assert api_client.get("/api/v1/profile/preferences").status_code == 401
