"""``/institutions`` â€” Â§12.3's owner-scoped college workspace.

The central assertion in this file is the **404-over-403 rule** for institutions, and
it is deliberately probed with an institution that really exists and really has another
owner. A 404 test aimed at a nonexistent id would pass just as happily on a route that
leaks, so several tests here use a real second owner and still expect 404.

**There is no 403 in this file, and that is the point.** Â§12.2 gives companies two rows
in the error-semantics table - non-member 404, candidate 403 - while institutions has
exactly one: "an institution is **owner-scoped** | ``404`` for anyone else". So a
candidate asking for somebody else's institution gets the same 404 an employer does.
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import register


@pytest.fixture()
def college(api_client):
    return register(
        api_client, f"college.{uuid.uuid4().hex[:12]}@example.com", "college"
    )


@pytest.fixture()
def other_college(api_client):
    return register(
        api_client, f"college2.{uuid.uuid4().hex[:12]}@example.com", "college"
    )


@pytest.fixture()
def institution_id(api_client, college):
    """An institution owned by ``college``, created through the real endpoint."""
    response = api_client.post(
        "/api/v1/institutions",
        json={"name": "Kittens Institute"},
        headers=college.headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["institution"]["id"]


def _create(api_client, account, **overrides):
    body = {"name": overrides.pop("name", "Some College")}
    body.update(overrides)
    headers = account.headers if account else {}
    return api_client.post("/api/v1/institutions", json=body, headers=headers)


def _add_program(api_client, account, institution_id, **overrides):
    body = {"name": overrides.pop("name", "B.Tech")}
    body.update(overrides)
    return api_client.post(
        f"/api/v1/institutions/{institution_id}/programs",
        json=body,
        headers=account.headers,
    )


# --------------------------------------------------------------------------- #
# Create
# --------------------------------------------------------------------------- #


def test_creating_an_institution_makes_the_caller_the_owner(api_client, college):
    """Â§12.3: "Registering contact person becomes owner server-side".

    ``owner_id`` is derived from the token and echoed back so the client can confirm
    it, and the slug is server-generated from the name.
    """
    response = _create(
        api_client, college, name="Northfield University", location="Delhi"
    )

    assert response.status_code == 201, response.text
    body = response.json()
    institution = body["institution"]
    assert institution["name"] == "Northfield University"
    assert institution["owner_id"] == college.id
    assert institution["slug"] == "northfield-university"
    assert institution["verification_status"] == "unverified"
    assert institution["status"] == "active"
    # A real COUNT that happens to be zero on a brand new institution.
    assert body["program_count"] == 0


def test_creation_requires_authentication(api_client):
    assert _create(api_client, None, name="Anon").status_code == 401


def test_creation_refuses_a_client_supplied_owner(
    api_client, college, other_college
):
    """``owner_id`` is server-owned; a client that sends it gets 422, not a silent drop.

    Accepting it would be an ownership transfer with no route and no specification
    behind it, and a client that believed it had worked would render a workspace it
    does not own.
    """
    response = _create(
        api_client, college, name="Usurped Co", owner_id=other_college.id
    )

    assert response.status_code == 422


def test_creation_refuses_a_blank_name(api_client, college):
    """A blank name is 422, and the detail names the field.

    The ``btrim(name) <> ''`` CHECK is the database backstop; this proves the client
    gets a field-level answer rather than a driver error.
    """
    response = _create(api_client, college, name="   ")

    assert response.status_code == 422
    fields = [d["field"] for d in response.json()["error"]["details"]]
    assert any(field.endswith("name") for field in fields), fields


# --------------------------------------------------------------------------- #
# List - /mine
# --------------------------------------------------------------------------- #


def test_the_list_is_empty_before_anything_is_created(api_client, college):
    """A bare array, not an envelope â€” Â§17 lists ``/institutions/mine`` as one."""
    response = api_client.get("/api/v1/institutions/mine", headers=college.headers)

    assert response.status_code == 200
    assert response.json() == []


def test_the_list_requires_authentication(api_client):
    assert api_client.get("/api/v1/institutions/mine").status_code == 401


def test_the_list_shows_only_the_callers_own_institutions(
    api_client, college, other_college, institution_id
):
    """Ownership-scoped in the query, so another owner's workspace cannot appear."""
    _create(api_client, other_college, name="Somebody Else U")

    mine = api_client.get("/api/v1/institutions/mine", headers=college.headers).json()
    theirs = api_client.get(
        "/api/v1/institutions/mine", headers=other_college.headers
    ).json()

    assert [item["institution"]["id"] for item in mine] == [institution_id]
    assert institution_id not in [item["institution"]["id"] for item in theirs]


def test_program_count_is_a_real_count_not_a_stored_number(
    api_client, college, institution_id
):
    """Â§14.9: "``program_count`` is a live ``COUNT``, not a column".

    Added, then deleted â€” and the count follows each step, which a denormalised
    counter maintained by one screen would not necessarily do.
    """
    before = api_client.get("/api/v1/institutions/mine", headers=college.headers).json()
    assert before[0]["program_count"] == 0

    created = _add_program(api_client, college, institution_id, name="B.Tech")
    assert created.status_code == 201, created.text
    _add_program(api_client, college, institution_id, name="M.Tech")

    after = api_client.get("/api/v1/institutions/mine", headers=college.headers).json()
    assert after[0]["program_count"] == 2

    api_client.delete(
        f"/api/v1/institutions/{institution_id}/programs/{created.json()['id']}",
        headers=college.headers,
    )

    final = api_client.get("/api/v1/institutions/mine", headers=college.headers).json()
    assert final[0]["program_count"] == 1


# --------------------------------------------------------------------------- #
# Read and update â€” ownership, then everything else
# --------------------------------------------------------------------------- #


def test_the_owner_reads_their_own_institution(api_client, college, institution_id):
    response = api_client.get(
        f"/api/v1/institutions/{institution_id}", headers=college.headers
    )

    assert response.status_code == 200
    assert response.json()["id"] == institution_id


def test_a_non_owner_gets_404(api_client, other_college, institution_id):
    """The privacy boundary: a real institution, a real other owner, and 404."""
    response = api_client.get(
        f"/api/v1/institutions/{institution_id}", headers=other_college.headers
    )

    assert response.status_code == 404, response.text


def test_a_candidate_gets_404_not_403_on_someone_elses_institution(
    api_client, candidate, institution_id
):
    """**The rule Â§12.3's error-semantics table encodes.**

    Companies give a candidate 403 because a company's existence is public. An
    institution is never visible to a non-owner, so there is nothing to refuse
    *disclosure* of â€” the caller gets the same 404 as for an id that does not exist,
    and learns nothing about whether the row is real.
    """
    response = api_client.get(
        f"/api/v1/institutions/{institution_id}", headers=candidate.headers
    )

    assert response.status_code == 404, response.text


def test_the_owner_updates_the_institution(api_client, college, institution_id):
    """A patch changes only what it names â€” every field is optional."""
    response = api_client.patch(
        f"/api/v1/institutions/{institution_id}",
        json={"description": "We teach things."},
        headers=college.headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["description"] == "We teach things."
    assert body["name"] == "Kittens Institute"
    assert body["slug"] == "kittens-institute"


def test_a_patch_cannot_change_the_owner_the_slug_or_the_verification(
    api_client, college, other_college, institution_id
):
    """All three are server-owned and absent from the schema, so each is a 422."""
    for payload in (
        {"slug": "renamed"},
        {"verification_status": "verified"},
        {"owner_id": other_college.id},
    ):
        response = api_client.patch(
            f"/api/v1/institutions/{institution_id}",
            json=payload,
            headers=college.headers,
        )
        assert response.status_code == 422, payload


def test_a_non_owner_cannot_patch_the_institution(
    api_client, other_college, institution_id
):
    response = api_client.patch(
        f"/api/v1/institutions/{institution_id}",
        json={"name": "Hijacked"},
        headers=other_college.headers,
    )

    assert response.status_code == 404


# --------------------------------------------------------------------------- #
# Verification â€” request-only, and never a claim
# --------------------------------------------------------------------------- #


def test_requesting_verification_moves_to_pending_and_never_verifies(
    api_client, college, institution_id
):
    """Â§12.3 and Â§23: the status goes to ``pending`` and the server supplies the note.

    It never sets ``verified`` â€” no review process exists, so a verified badge would
    be a false credential claim, and ``college/institution.tsx`` must not render one.
    """
    response = api_client.post(
        f"/api/v1/institutions/{institution_id}/verification-request",
        headers=college.headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["verification_status"] == "pending"
    assert body["note"]

    reread = api_client.get(
        f"/api/v1/institutions/{institution_id}", headers=college.headers
    )
    assert reread.json()["verification_status"] == "pending"
# --------------------------------------------------------------------------- #
# Programs
# --------------------------------------------------------------------------- #


def test_the_program_list_is_empty_to_begin_with(api_client, college, institution_id):
    """A bare array; "no programs yet" is a state, not an error."""
    response = api_client.get(
        f"/api/v1/institutions/{institution_id}/programs", headers=college.headers
    )

    assert response.status_code == 200
    assert response.json() == []


def test_the_owner_adds_a_program(api_client, college, institution_id):
    """The happy path ``ProgramsStep`` performs: ``{name, level?, description?}``."""
    response = _add_program(
        api_client,
        college,
        institution_id,
        name="B.Tech Computer Science",
        level="undergraduate",
        description="Four years.",
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "B.Tech Computer Science"
    assert body["level"] == "undergraduate"
    assert body["institution_id"] == institution_id
    assert body["created_at"] and body["updated_at"]


def test_a_program_accepts_null_level_and_description(
    api_client, college, institution_id
):
    """``level`` and ``description`` are nullable in Â§14.9 and in the client's type.

    ``ProgramsStep`` sends ``level.trim() || null``, so null is the normal case, not an
    edge case.
    """
    response = _add_program(api_client, college, institution_id, name="PhD")

    assert response.status_code == 201, response.text
    assert response.json()["level"] is None
    assert response.json()["description"] is None


def test_adding_a_program_requires_a_name(api_client, college, institution_id):
    """A blank name is 422 naming the field â€” not a driver error.

    Â§14.9 gives ``programs.name`` only ``NOT NULL`` and no CHECK, so the schema is
    where a blank name is refused.
    """
    response = _add_program(api_client, college, institution_id, name="")

    assert response.status_code == 422


def test_adding_a_program_refuses_an_institution_id_in_the_body(
    api_client, college, institution_id, other_college
):
    """The institution is in the path; a body that disagreed would be ambiguous."""
    other = _create(api_client, other_college, name="Other U").json()["institution"]

    response = api_client.post(
        f"/api/v1/institutions/{institution_id}/programs",
        json={"name": "Sneaky", "institution_id": other["id"]},
        headers=college.headers,
    )

    assert response.status_code == 422


def test_two_programs_may_share_a_name(api_client, college, institution_id):
    """Â§14.9 declares no unique constraint on ``(institution_id, name)``.

    A college may legitimately offer the same name twice - a certificate and a degree -
    so a 409 here would refuse something the specification permits.
    """
    first = _add_program(api_client, college, institution_id, name="Diploma in Design")
    second = _add_program(api_client, college, institution_id, name="Diploma in Design")

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["id"] != second.json()["id"]


def test_the_owner_renames_a_program(api_client, college, institution_id):
    """``ProgramsStep``'s rename sends ``{name: next}`` and nothing else."""
    created = _add_program(api_client, college, institution_id, name="Old Name")

    response = api_client.patch(
        f"/api/v1/institutions/{institution_id}/programs/{created.json()['id']}",
        json={"name": "New Name"},
        headers=college.headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "New Name"


def test_removing_a_program_twice_is_idempotent(api_client, college, institution_id):
    """A retry after a dropped response must not look like a failure."""
    created = _add_program(api_client, college, institution_id, name="Transient")
    path = f"/api/v1/institutions/{institution_id}/programs/{created.json()['id']}"

    first = api_client.delete(path, headers=college.headers)
    second = api_client.delete(path, headers=college.headers)

    assert first.status_code == 204, first.text
    assert second.status_code == 204


def test_a_non_owner_cannot_touch_programs(api_client, other_college, institution_id):
    """Every program route is ownership-scoped, so all of them answer 404."""
    listed = api_client.get(
        f"/api/v1/institutions/{institution_id}/programs",
        headers=other_college.headers,
    )
    added = _add_program(api_client, other_college, institution_id, name="Trespass")

    assert listed.status_code == 404
    assert added.status_code == 404


def test_a_program_of_another_institution_is_unreachable(
    api_client, college, other_college, institution_id
):
    """The path is checked, not just the id.

    A program id that really exists but belongs to somebody else's institution must not
    be editable by guessing its id â€” the ``(id, institution_id)`` predicate in
    ``_require_own_program`` is what makes that true.
    """
    theirs = _create(api_client, other_college, name="Other U").json()["institution"]
    program = _add_program(
        api_client, other_college, theirs["id"], name="Secret Programme"
    )
    assert program.status_code == 201, program.text

    response = api_client.patch(
        f"/api/v1/institutions/{institution_id}/programs/{program.json()['id']}",
        json={"name": "Renamed By Stranger"},
        headers=college.headers,
    )

    assert response.status_code == 404, response.text


def test_program_routes_require_authentication(api_client, institution_id):
    listed = api_client.get(f"/api/v1/institutions/{institution_id}/programs")
    added = api_client.post(
        f"/api/v1/institutions/{institution_id}/programs", json={"name": "Anon"}
    )

    assert listed.status_code == 401
    assert added.status_code == 401


def test_deleting_an_institutions_programs_is_refused_by_a_non_owner(
    api_client, college, other_college, institution_id
):
    """Ownership is checked *before* the program is even looked up."""
    created = _add_program(api_client, college, institution_id, name="Protected")

    response = api_client.delete(
        f"/api/v1/institutions/{institution_id}/programs/{created.json()['id']}",
        headers=other_college.headers,
    )

    assert response.status_code == 404


# --------------------------------------------------------------------------- #
# Foreign-key integrity â€” the two behaviours Â§14.9 specifies, in opposite directions
# --------------------------------------------------------------------------- #


def test_deleting_an_institution_takes_its_programs_with_it(
    db_session, api_client, college, institution_id
):
    """``programs.institution_id`` is **CASCADE** (Â§14.9).

    A program has no meaning without the institution offering it, so orphans are worse
    than deletion. Asserted directly against the table rather than through a route,
    because there is deliberately no ``DELETE /institutions/{id}`` in Â§12.3.
    """
    from app.models import Institution, Program

    created = _add_program(api_client, college, institution_id, name="Doomed")
    assert created.status_code == 201, created.text
    program_id = created.json()["id"]

    institution = db_session.get(Institution, uuid.UUID(institution_id))
    db_session.delete(institution)
    db_session.commit()

    assert db_session.get(Program, uuid.UUID(program_id)) is None


def test_the_owner_cannot_be_deleted_while_the_institution_exists(
    db_session, college, institution_id
):
    """``institutions.owner_id`` is **RESTRICT** (Â§14.9) â€” the opposite of CASCADE.

    Deleting the account must not silently take a college's public record and its whole
    programme catalogue with it; the delete is refused instead, so the removal is an
    explicit decision rather than a side effect.
    """
    from sqlalchemy.exc import IntegrityError

    from app.models import User

    with pytest.raises(IntegrityError):
        owner = db_session.get(User, uuid.UUID(college.id))
        db_session.delete(owner)
        db_session.commit()
    db_session.rollback()


def test_an_unknown_program_answers_404(api_client, college, institution_id):
    response = api_client.patch(
        f"/api/v1/institutions/{institution_id}/programs/{uuid.uuid4()}",
        json={"name": "Ghost"},
        headers=college.headers,
    )

    assert response.status_code == 404


def test_a_malformed_program_id_answers_404_not_422(
    api_client, college, institution_id
):
    patch = api_client.patch(
        f"/api/v1/institutions/{institution_id}/programs/not-a-uuid",
        json={"name": "Ghost"},
        headers=college.headers,
    )

    assert patch.status_code == 404


def test_requesting_verification_twice_is_idempotent(
    api_client, college, institution_id
):
    """The client's intent - "I have asked" - is satisfied, so no error on a repeat."""
    path = f"/api/v1/institutions/{institution_id}/verification-request"

    first = api_client.post(path, headers=college.headers)
    second = api_client.post(path, headers=college.headers)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["verification_status"] == "pending"


def test_a_non_owner_cannot_request_verification(
    api_client, other_college, institution_id
):
    response = api_client.post(
        f"/api/v1/institutions/{institution_id}/verification-request",
        headers=other_college.headers,
    )

    assert response.status_code == 404


def test_requesting_verification_requires_authentication(api_client, institution_id):
    response = api_client.post(
        f"/api/v1/institutions/{institution_id}/verification-request"
    )

    assert response.status_code == 401


def test_an_unknown_institution_answers_404(api_client, college):
    response = api_client.get(
        f"/api/v1/institutions/{uuid.uuid4()}", headers=college.headers
    )

    assert response.status_code == 404


def test_a_non_owner_and_an_unknown_id_are_indistinguishable(
    api_client, other_college, institution_id
):
    """Both answers must be identical, or the pair becomes an existence oracle.

    ``request_id`` is excluded because it is unique per request by design — it is
    there to correlate a log line with a response, so two calls legitimately differ
    there. Everything a caller could learn about *existence* must match: code,
    message and details.
    """
    someone_elses = api_client.get(
        f"/api/v1/institutions/{institution_id}", headers=other_college.headers
    ).json()["error"]
    does_not_exist = api_client.get(
        f"/api/v1/institutions/{uuid.uuid4()}", headers=other_college.headers
    ).json()["error"]

    for body in (someone_elses, does_not_exist):
        assert body.pop("request_id") is not None
    assert someone_elses == does_not_exist


def test_a_malformed_institution_id_answers_404_not_422(api_client, college):
    response = api_client.get(
        "/api/v1/institutions/not-a-uuid", headers=college.headers
    )
    assert response.status_code == 404


def test_reading_requires_authentication(api_client, institution_id):
    assert api_client.get(f"/api/v1/institutions/{institution_id}").status_code == 401


def test_creation_refuses_an_unknown_field(api_client, college):
    """``extra="forbid"``, so a typo is a 422 naming the mistake."""
    response = _create(api_client, college, name="Typo Co", colour="blue")

    assert response.status_code == 422


def test_two_institutions_with_the_same_name_get_distinct_slugs(
    api_client, college, other_college
):
    """``institutions.slug`` is UNIQUE, so the second must not collide.

    Without the suffix this surfaces as an ``IntegrityError`` and a 500.
    """
    first = _create(api_client, college, name="Twin Falls College")
    second = _create(api_client, other_college, name="Twin Falls College")

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert (
        first.json()["institution"]["slug"] != second.json()["institution"]["slug"]
    )
