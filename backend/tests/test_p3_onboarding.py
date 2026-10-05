"""``GET /onboarding/state`` — the wizard's one authority, and its only verb.

Two properties are load-bearing and both are asserted here:

* it is **derived**, so writing to the profile moves it and nothing else can;
* it is **read-only**, so there is no second authority a client could set
  "completed" from. A ``PUT`` that worked would be exactly the drift the
  endpoint exists to prevent.
"""

from __future__ import annotations

#: The wizard's four screens, in the order ``CANDIDATE_STEPS`` presents them.
#: ``about`` is the merged education + skills step; ``experience``, ``preferences``
#: and ``links`` are gone from onboarding (they remain profile sections).
CANDIDATE_KEYS = [
    "basics",
    "about",
    "photo",
    "review",
]

#: The steps that gate completion for a candidate, in the client's order.
CANDIDATE_REQUIRED = ["basics", "about"]


def _state(api_client, account) -> dict:
    response = api_client.get("/api/v1/onboarding/state", headers=account.headers)
    assert response.status_code == 200, response.text
    return response.json()


def _about(api_client, account) -> dict:
    """The ``about`` step's own verdict, so a test reads as a claim about it."""

    steps = _state(api_client, account)["steps"]
    return next(step for step in steps if step["key"] == "about")


def _add_skill(api_client, account, skill) -> None:
    """Attach a catalogue row to the account, failing loudly if it is refused.

    Skills are created through ``make_skill`` rather than read out of
    ``GET /skills/catalog``, because the catalogue is deployment state: reading the
    first three rows makes the test depend on whatever was seeded, and inserting
    rows with fixed names collides with the seeded catalogue when it is present.
    """

    response = api_client.post(
        "/api/v1/profile/skills",
        json={"skill_id": str(skill.id), "level": "intermediate"},
        headers=account.headers,
    )
    assert response.status_code == 201, response.text


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
    # "About You" (education + skills) is still outstanding, so the wizard has not
    # moved on.
    assert after["next_step"] == "about"


def test_the_percent_rises_only_when_a_real_step_completes(
    api_client, candidate, make_skill
) -> None:
    """One education row completes ``about`` -- and only a real row does.

    This test used to assert the opposite: that one education row was *half* the
    merged step and three catalogue skills were needed for the other half. That
    rule was the reported mobile bug. ``AboutYouStep`` enabled Continue on an
    institution alone, so somebody with one education row and no skills received a
    clean ``201`` and was then told by this endpoint that the save had not
    registered -- and Retry, which replays the same save, could never clear it.

    The gate is now exactly what the screen can satisfy: one education row.
    """

    # A brand-new account has only `review` done, which is always complete by
    # design (it is the end of the wizard, not a gate). So the floor is one of
    # four steps, not zero -- asserted explicitly so the arithmetic below is
    # anchored rather than assumed.
    before = _state(api_client, candidate)["percent"]
    assert before == 25

    # No education row yet: the step is incomplete, and saying so is honest.
    assert _about(api_client, candidate)["complete"] is False

    created = api_client.post(
        "/api/v1/profile/education",
        json={"institution": "Somewhere"},
        headers=candidate.headers,
    )
    assert created.status_code == 201, created.text

    # `basics` is still outstanding on this fresh account, so `next_step` names
    # the *first* gate, not the one this test just satisfied.
    midway = _state(api_client, candidate)
    assert _about(api_client, candidate)["complete"] is True
    assert midway["next_step"] == "basics"

    # The wizard percent is `round(done / total * 100)` over four steps: `review`
    # and `about` done is two of four, i.e. 50, up from one of four (25) before
    # the education row existed. Asserted against the step count rather than merely
    # "it went up", because at this granularity several adjacent transitions
    # round to the same integer.
    assert midway["percent"] == 50

    # Skills are a recommendation. Adding them raises the *profile* completeness
    # score without being required by the wizard, which is the whole point of
    # keeping the two numbers separate. Seeded via `make_skill` rather than read
    # out of the catalogue, so this test does not depend on the catalogue being
    # seeded (and does not collide with it when it is).
    for name in ("Alpha", "Beta", "Gamma"):
        _add_skill(api_client, candidate, make_skill(name))

    after = _state(api_client, candidate)
    assert _about(api_client, candidate)["complete"] is True
    # Skills do not complete a step the server already considers done, so the
    # wizard percent is unmoved by them. That separation is the point: adding
    # skills improves the profile score, not the wizard's position.
    assert after["percent"] == 50

    # The profile score, unlike the wizard gate, still wants three skills. This is
    # where the three-skill rule lives now: it describes how good a profile is,
    # and can never be read as "your save failed".
    completeness = api_client.get(
        "/api/v1/profile/completeness", headers=candidate.headers
    )
    skills = next(s for s in completeness.json()["sections"] if s["key"] == "skills")
    assert skills["complete"] is True


def test_about_completes_with_zero_skills(api_client, candidate) -> None:
    """The regression, stated as its own test so it cannot come back quietly.

    Every prior failure mode of this bug was somebody with **fewer than three
    skills** being told their save did not register. This asserts the step is
    complete the moment the education row exists, with no skill rows at all.
    """

    api_client.post(
        "/api/v1/profile/education",
        json={"institution": "ABC Institute of Technology", "degree": "B.Tech"},
        headers=candidate.headers,
    )

    skills = api_client.get("/api/v1/profile/skills", headers=candidate.headers)
    assert skills.json()["total"] == 0

    assert _about(api_client, candidate)["complete"] is True

    # And the wizard is genuinely finishable: only `basics` remains.
    state = _state(api_client, candidate)
    outstanding = [
        s["key"] for s in state["steps"] if s["required"] and not s["complete"]
    ]
    assert outstanding == ["basics"]


def test_about_is_still_incomplete_without_an_education_row(
    api_client, candidate, make_skill
) -> None:
    """The gate is relaxed on *skills*, never on the step's own subject.

    The fix removes a condition the screen could not satisfy. It must not remove
    the one it can: a candidate with three catalogue skills and no education is
    still outstanding, because there is nothing on their profile to have studied.
    """

    for name in ("Delta", "Epsilon", "Zeta"):
        _add_skill(api_client, candidate, make_skill(name))

    skills = api_client.get("/api/v1/profile/skills", headers=candidate.headers)
    assert skills.json()["total"] == 3

    assert _about(api_client, candidate)["complete"] is False
    assert _state(api_client, candidate)["next_step"] == "basics"


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
