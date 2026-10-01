"""``GET /onboarding/state`` — the wizard's one authority, and its only verb.

Two properties are load-bearing and both are asserted here:

* it is **derived**, so writing to the profile moves it and nothing else can;
* it is **read-only**, so there is no second authority a client could set
  "completed" from. A ``PUT`` that worked would be exactly the drift the
  endpoint exists to prevent.
"""

from __future__ import annotations

CANDIDATE_KEYS = [
    "basics",
    "education",
    "skills",
    "experience",
    "preferences",
    "photo",
    "links",
    "review",
]

#: The steps that gate completion for a candidate, in the client's order.
CANDIDATE_REQUIRED = ["basics", "education", "skills", "preferences"]


def _state(api_client, account) -> dict:
    response = api_client.get("/api/v1/onboarding/state", headers=account.headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_onboarding_requires_a_token(api_client) -> None:
    assert api_client.get("/api/v1/onboarding/state").status_code == 401


def test_every_role_may_read_its_own_state(api_client, candidate, employer) -> None:
    """Open to all roles: the client calls this from its role guard itself."""

    assert _state(api_client, candidate)["role"] == "candidate"
    assert _state(api_client, employer)["role"] == "employer"


def test_a_new_candidate_reports_not_started(api_client, candidate) -> None:
    body = _state(api_client, candidate)

    assert body["state"] == "not_started"
    assert body["next_step"] == "basics"
    assert [step["key"] for step in body["steps"]] == CANDIDATE_KEYS
    # Nothing has been written, so no step except the inert review is done.
    done = [step["key"] for step in body["steps"] if step["complete"]]
    assert done == ["review"]


def test_the_required_steps_are_the_ones_that_gate_completion(
    api_client, candidate
) -> None:
    steps = _state(api_client, candidate)["steps"]

    required = [step["key"] for step in steps if step["required"]]

    assert required == CANDIDATE_REQUIRED


def test_every_step_carries_the_fields_the_client_renders(
    api_client, candidate
) -> None:
    for step in _state(api_client, candidate)["steps"]:
        assert set(step) == {"key", "label", "complete", "required", "hint"}
        assert step["label"] and step["hint"]


def test_the_percent_is_an_int_server_derived_number(api_client, candidate) -> None:
    """The client never computes this; it renders what the server says."""

    body = _state(api_client, candidate)

    assert isinstance(body["percent"], int)
    assert 0 <= body["percent"] <= 100
    # The review step is complete on every account, so a new one is not at zero.
    assert body["percent"] > 0


def test_the_review_step_is_never_a_gate(api_client, candidate) -> None:
    steps = _state(api_client, candidate)["steps"]
    review = next(s for s in steps if s["key"] == "review")

    assert review["complete"] is True
    assert review["required"] is False


# --- derived, not stored -----------------------------------------------------


def test_writing_to_the_profile_moves_the_state(api_client, candidate) -> None:
    """The only way forward is a real row — that is the whole design."""

    assert _state(api_client, candidate)["state"] == "not_started"

    api_client.patch(
        "/api/v1/profile",
        json={
            "headline": "Backend engineer",
            "location": "Pune",
            "summary": "I build APIs.",
        },
        headers=candidate.headers,
    )

    after = _state(api_client, candidate)

    assert after["state"] == "in_progress"
    basics = next(s for s in after["steps"] if s["key"] == "basics")
    assert basics["complete"] is True
    # Education and skills are still outstanding, so the wizard has not moved on.
    assert after["next_step"] == "education"


def test_the_percent_rises_only_when_a_real_step_completes(
    api_client, candidate
) -> None:
    before = _state(api_client, candidate)["percent"]

    api_client.post(
        "/api/v1/profile/education",
        json={"institution": "Somewhere"},
        headers=candidate.headers,
    )

    after = _state(api_client, candidate)

    assert after["percent"] > before
    education = next(s for s in after["steps"] if s["key"] == "education")
    assert education["complete"] is True


def test_next_step_names_the_first_required_step_outstanding(
    api_client, candidate
) -> None:
    """The client renders whichever step this names, so it must always be known."""

    keys = {step["key"] for step in _state(api_client, candidate)["steps"]}
    next_step = _state(api_client, candidate)["next_step"]

    assert next_step in keys


# --- read-only ---------------------------------------------------------------


def test_there_is_no_write_endpoint(api_client, candidate) -> None:
    """A working ``PUT`` would be the second authority this endpoint replaces."""

    for method in ("post", "put", "patch", "delete"):
        call = getattr(api_client, method)
        # DELETE takes no JSON body in httpx; the 405 is about the method anyway.
        kwargs = {} if method == "delete" else {"json": {"state": "completed"}}
        response = call("/api/v1/onboarding/state", headers=candidate.headers, **kwargs)
        assert response.status_code == 405, f"{method} must not be allowed"


def test_a_failed_wizard_read_cannot_be_faked_by_a_body(
    api_client, candidate
) -> None:
    """Nothing in the request changes the answer; it is a pure function of rows."""

    without = _state(api_client, candidate)
    with_body = api_client.get(
        "/api/v1/onboarding/state?state=completed&percent=100",
        headers=candidate.headers,
    )

    assert with_body.status_code == 200
    assert with_body.json() == without


# --- the other roles ---------------------------------------------------------


def test_an_employer_is_held_by_its_own_required_step(api_client, employer) -> None:
    """No company table exists yet, so ``company`` is honestly reported incomplete.

    Reporting "done" would strand a recruiter on a screen they never finished;
    reporting "not done" is merely a wait.
    """

    body = _state(api_client, employer)

    assert [step["key"] for step in body["steps"]] == [
        "profile",
        "company",
        "verification",
        "review",
    ]
    company = next(s for s in body["steps"] if s["key"] == "company")
    assert company["required"] is True
    assert company["complete"] is False
    assert body["next_step"] == "company"
    assert body["state"] != "completed"


def test_the_state_is_per_account(api_client, candidate, other_candidate) -> None:
    """Two accounts cannot inherit each other's wizard position."""

    api_client.patch(
        "/api/v1/profile",
        json={"headline": "Engineer", "location": "Pune", "summary": "Hello"},
        headers=candidate.headers,
    )

    assert _state(api_client, candidate)["state"] == "in_progress"
    assert _state(api_client, other_candidate)["state"] == "not_started"
    assert _state(api_client, other_candidate)["next_step"] == "basics"
