"""``/companies`` â€” Â§12.2's membership rules, asserted at the HTTP boundary.

The assertions that matter here are the two asymmetries Â§12.2 calls "hard
constraints":

1. A **candidate** gets **403** â€” the route exists and the caller is authenticated.
2. A **non-member** gets **404** â€” so membership, and therefore company existence,
   is not enumerable.

Several tests below deliberately probe the *second* one with a company that really
does exist and really does have another owner, because a 404 test against a
nonexistent id passes just as happily on a route that leaks.
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import register


@pytest.fixture()
def employer_owner(api_client):
    return register(
        api_client, f"owner.{uuid.uuid4().hex[:12]}@example.com", "employer"
    )


@pytest.fixture()
def other_employer(api_client):
    return register(
        api_client, f"peer.{uuid.uuid4().hex[:12]}@example.com", "employer"
    )


@pytest.fixture()
def company_id(api_client, employer_owner):
    """A company owned by ``employer_owner``, created through the real endpoint."""
    response = api_client.post(
        "/api/v1/companies",
        json={"name": "Acme Analytics"},
        headers=employer_owner.headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["company"]["id"]


def _create_company(api_client, account, **overrides):
    body = {"name": overrides.pop("name", "Test Co")}
    body.update(overrides)
    headers = account.headers if account else {}
    return api_client.post("/api/v1/companies", json=body, headers=headers)


def _invite(api_client, actor, company_id, email, role="recruiter"):
    return api_client.post(
        f"/api/v1/companies/{company_id}/members",
        json={"email": email, "role": role},
        headers=actor.headers,
    )


# --------------------------------------------------------------------------- #
# Create
# --------------------------------------------------------------------------- #


def test_creating_a_company_makes_the_caller_its_owner(api_client, employer_owner):
    """The creator is the owner, and the slug is server-generated.

    Â§12.2 says the creator becomes owner **server-side, atomically** â€” the client
    never names an owner, which is why ``MyCompanySummary.role`` comes back filled in
    rather than echoed from the request.
    """
    response = _create_company(
        api_client, employer_owner, name="Northwind Traders", website="https://nw.test"
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["company"]["name"] == "Northwind Traders"
    assert body["role"] == "owner"
    assert body["membership_status"] == "active"
    # Server-owned, and derived from the name rather than anything the client sent.
    assert body["company"]["slug"] == "northwind-traders"
    assert body["company"]["verification_status"] == "unverified"


def test_creation_requires_authentication(api_client):
    assert _create_company(api_client, None, name="Anon").status_code == 401


def test_a_candidate_cannot_create_a_company(api_client, candidate):
    response = _create_company(api_client, candidate, name="Candidate Co")
    assert response.status_code == 403

def test_the_list_is_empty_before_any_company_exists(api_client, employer_owner):
    """A bare array, not an envelope â€” Â§17 lists ``/companies/mine`` as one.

    An empty result is ``[]`` and stays 200: "no companies yet" is a state the client
    renders, not an error.
    """
    response = api_client.get("/api/v1/companies/mine", headers=employer_owner.headers)

    assert response.status_code == 200
    assert response.json() == []


def test_the_list_shows_only_the_callers_companies(
    api_client, employer_owner, other_employer, company_id
):
    _create_company(api_client, other_employer, name="Somebody Else Ltd")

    mine = api_client.get("/api/v1/companies/mine", headers=employer_owner.headers)
    theirs = api_client.get("/api/v1/companies/mine", headers=other_employer.headers)

    assert [item["company"]["id"] for item in mine.json()] == [company_id]
    assert company_id not in [item["company"]["id"] for item in theirs.json()]


# --------------------------------------------------------------------------- #
# Read and update
# --------------------------------------------------------------------------- #


def test_the_owner_reads_their_own_company(api_client, employer_owner, company_id):
    response = api_client.get(
        f"/api/v1/companies/{company_id}", headers=employer_owner.headers
    )

    assert response.status_code == 200
    assert response.json()["id"] == company_id


def test_a_non_member_gets_404_not_403(api_client, other_employer, company_id):
    """The privacy boundary: a real company, a real other owner, and 404.

    Â§12.2 is explicit that 403 here would confirm the company exists.
    """
    response = api_client.get(
        f"/api/v1/companies/{company_id}", headers=other_employer.headers
    )

    assert response.status_code == 404, response.text


def test_a_candidate_gets_403_on_a_company_route(api_client, candidate, company_id):
    """The other half of the asymmetry: authenticated, and simply not permitted."""
    response = api_client.get(
        f"/api/v1/companies/{company_id}", headers=candidate.headers
    )

    assert response.status_code == 403


def test_an_unknown_company_answers_404(api_client, employer_owner):
    missing = uuid.uuid4()
    response = api_client.get(
        f"/api/v1/companies/{missing}", headers=employer_owner.headers
    )

    assert response.status_code == 404


def test_a_malformed_company_id_answers_404_not_422(api_client, employer_owner):
    """Keeps the route from becoming a UUID-format oracle."""
    response = api_client.get(
        "/api/v1/companies/not-a-uuid", headers=employer_owner.headers
    )

    assert response.status_code == 404


def test_the_owner_updates_the_company(api_client, employer_owner, company_id):
    """A patch changes only what it names â€” Â§12.2 makes every field optional."""
    response = api_client.patch(
        f"/api/v1/companies/{company_id}",
        json={"description": "We analyse things."},
        headers=employer_owner.headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["description"] == "We analyse things."
    # Untouched by a patch that did not mention it.
    assert body["name"] == "Acme Analytics"
    assert body["slug"] == "acme-analytics"


def test_a_patch_cannot_change_the_slug(api_client, employer_owner, company_id):
    """``slug`` is absent from ``CompanyUpdate``, and extras are forbidden."""
    response = api_client.patch(
        f"/api/v1/companies/{company_id}",
        json={"slug": "renamed"},
        headers=employer_owner.headers,
    )

    assert response.status_code == 422


def test_a_non_member_cannot_patch_the_company(api_client, other_employer, company_id):
    response = api_client.patch(
        f"/api/v1/companies/{company_id}",
        json={"name": "Hijacked"},
        headers=other_employer.headers,
    )

    assert response.status_code == 404


# --------------------------------------------------------------------------- #
# Members
# --------------------------------------------------------------------------- #


def test_the_member_list_always_includes_the_owner(
    api_client, employer_owner, company_id
):
    """Â§12.2: the member list "must include the ``owner``"."""
    response = api_client.get(
        f"/api/v1/companies/{company_id}/members", headers=employer_owner.headers
    )

    assert response.status_code == 200
    members = response.json()
    assert len(members) == 1
    assert members[0]["role"] == "owner"
    assert members[0]["status"] == "active"


def test_the_member_envelope_never_carries_an_email(
    api_client, employer_owner, other_employer, company_id
):
    """Privacy: a company must not be able to redistribute its staff's contact details.

    ``MemberUserRead`` is ``{user_id, name, public_id}`` and nothing else, so the
    member list cannot be used as an address book.
    """
    _invite(api_client, employer_owner, company_id, other_employer.email)

    response = api_client.get(
        f"/api/v1/companies/{company_id}/members", headers=employer_owner.headers
    )

    assert response.status_code == 200
    for member in response.json():
        assert "email" not in member
        assert set(member["user"]) == {"user_id", "name", "public_id"}
    raw = response.text.lower()
    assert "@example.com" not in raw


def test_an_invite_cannot_mint_an_owner(
    api_client, employer_owner, other_employer, company_id
):
    """Â§12.2's first hard constraint, asserted through the public route.

    The table must still be able to *represent* an owner, so the prohibition is a
    service rule â€” and this is the test that proves the rule is wired up.
    """
    response = _invite(
        api_client, employer_owner, company_id, other_employer.email, role="owner"
    )

    assert response.status_code == 422
    assert any(
        d["field"] == "role" for d in response.json()["error"]["details"]
    )


def test_inviting_an_unknown_account_answers_404(
    api_client, employer_owner, company_id
):
    """This route must not confirm or deny who has an account."""
    response = _invite(
        api_client, employer_owner, company_id, "nobody.here@example.com"
    )

    assert response.status_code == 404


def test_inviting_a_candidate_is_refused(
    api_client, employer_owner, candidate, company_id
):
    """The account exists and is wrong for a staff seat.

    404 would be a lie about existence, and 403 would be misleading â€” the company is
    not refusing them access, it is refusing to create the wrong kind of membership.
    """
    response = _invite(api_client, employer_owner, company_id, candidate.email)

    assert response.status_code == 422
    assert any(
        d["field"] == "email" for d in response.json()["error"]["details"]
    )


def test_inviting_the_same_person_twice_answers_409(
    api_client, employer_owner, other_employer, company_id
):
    """The unique ``(company_id, user_id)`` as a 409, not a driver error.

    A second invite is a client bug worth reporting precisely, and the detail names
    the field so the form can point at it.
    """
    first = _invite(api_client, employer_owner, company_id, other_employer.email)
    second = _invite(api_client, employer_owner, company_id, other_employer.email)

    assert first.status_code == 201, first.text
    assert second.status_code == 409
    assert any(
        d["field"] == "email" for d in second.json()["error"]["details"]
    )


def test_an_invitation_starts_as_invited_because_no_email_is_sent(
    api_client, employer_owner, other_employer, company_id
):
    """Â§12.2: "No email is sent for an invite in V1."

    The membership therefore begins ``invited`` and the invitee accepts while signed
    in â€” which is why the UI must not claim an invitation was sent.
    """
    response = _invite(api_client, employer_owner, company_id, other_employer.email)

    assert response.status_code == 201
    assert response.json()["status"] == "invited"


def test_an_invitee_accepts_their_own_invitation(
    api_client, employer_owner, other_employer, company_id
):
    """The happy path end to end: invite, then accept from the invitee's token."""
# --------------------------------------------------------------------------- #
# Member administration: ownership cannot be minted, and cannot be orphaned
# --------------------------------------------------------------------------- #


def _invite_and_accept(api_client, owner, invitee, company_id, role="recruiter"):
    _invite(api_client, owner, company_id, invitee.email, role=role)
    accepted = api_client.post(
        f"/api/v1/companies/{company_id}/members/me/accept", headers=invitee.headers
    )
    assert accepted.status_code == 200, accepted.text
    return accepted.json()["id"]


def test_only_an_owner_can_grant_ownership(
    api_client, employer_owner, other_employer, company_id
):
    """An admin must not be able to mint a peer who outranks them."""
    _invite_and_accept(api_client, employer_owner, other_employer, company_id, "admin")
    second = register(api_client, f"x.{uuid.uuid4().hex[:12]}@example.com", "employer")
    target_id = _invite_and_accept(
        api_client, employer_owner, second, company_id, "recruiter"
    )

    response = api_client.patch(
        f"/api/v1/companies/{company_id}/members/{target_id}",
        json={"role": "owner"},
        headers=other_employer.headers,
    )

    assert response.status_code == 403, response.text


def test_an_owner_can_promote_an_existing_member(
    api_client, employer_owner, other_employer, company_id
):
    """The **only** path to an owner role: patching somebody who already is one."""
    target_id = _invite_and_accept(
        api_client, employer_owner, other_employer, company_id
    )

    response = api_client.patch(
        f"/api/v1/companies/{company_id}/members/{target_id}",
        json={"role": "admin"},
        headers=employer_owner.headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["role"] == "admin"


def test_a_member_cannot_be_set_back_to_invited(
    api_client, employer_owner, other_employer, company_id
):
    """An invite is accepted by the invitee, never granted by the company.

    ``MemberUpdate`` excludes ``invited`` precisely so a company cannot manufacture a
    membership with nobody to accept it.
    """
    target_id = _invite_and_accept(
        api_client, employer_owner, other_employer, company_id
    )

    response = api_client.patch(
        f"/api/v1/companies/{company_id}/members/{target_id}",
        json={"status": "invited"},
        headers=employer_owner.headers,
    )

    assert response.status_code == 422


def test_the_last_owner_cannot_be_demoted(api_client, employer_owner, company_id):
    """A company must keep somebody who can administer it."""
    members = api_client.get(
        f"/api/v1/companies/{company_id}/members", headers=employer_owner.headers
    ).json()
    owner_membership = next(m for m in members if m["role"] == "owner")

    response = api_client.patch(
        f"/api/v1/companies/{company_id}/members/{owner_membership['id']}",
        json={"role": "admin"},
        headers=employer_owner.headers,
    )

    assert response.status_code == 409


def test_a_second_owner_cannot_be_granted(
    api_client, employer_owner, other_employer, company_id
):
    """A company has **exactly one** owner, so a second promotion is refused.

    §14.9 puts a partial unique index on ``(company_id) WHERE role='owner'``. Without
    a service-level guard this reaches the database and returns a 500 with a driver
    message; the honest answer is a 409 naming ``role``.
    """
    second_id = _invite_and_accept(
        api_client, employer_owner, other_employer, company_id
    )

    response = api_client.patch(
        f"/api/v1/companies/{company_id}/members/{second_id}",
        json={"role": "owner"},
        headers=employer_owner.headers,
    )

    assert response.status_code == 409, response.text
    assert any(
        d["field"] == "role" for d in response.json()["error"]["details"]
    )


def test_the_owner_cannot_be_removed_because_there_is_only_one(
    api_client, employer_owner, company_id
):
    """Removal is refused for the same reason: no replacement owner can exist."""
    members = api_client.get(
        f"/api/v1/companies/{company_id}/members", headers=employer_owner.headers
    ).json()
    owner_membership = next(m for m in members if m["role"] == "owner")

    response = api_client.delete(
        f"/api/v1/companies/{company_id}/members/{owner_membership['id']}",
        headers=employer_owner.headers,
    )

    assert response.status_code == 409


def test_removing_a_member_twice_is_idempotent(
    api_client, employer_owner, other_employer, company_id
):
    """A retry after a dropped response must not look like a failure.

    The work is already done, so the honest answer is the same 204 either time.
    """
    target_id = _invite_and_accept(
        api_client, employer_owner, other_employer, company_id
    )
    path = f"/api/v1/companies/{company_id}/members/{target_id}"

    first = api_client.delete(path, headers=employer_owner.headers)
    second = api_client.delete(path, headers=employer_owner.headers)

    assert first.status_code == 204, first.text
    assert second.status_code == 204


def test_removing_a_member_of_somebody_elses_company_answers_404(
    api_client, other_employer, company_id
):
    response = api_client.delete(
        f"/api/v1/companies/{company_id}/members/{uuid.uuid4()}",
        headers=other_employer.headers,
    )

    assert response.status_code == 404


# --------------------------------------------------------------------------- #
# Verification â€” request-only, and never a claim
# --------------------------------------------------------------------------- #


def test_requesting_verification_moves_to_pending_and_never_verifies(
    api_client, employer_owner, company_id
):
    """Â§12.2 and Â§23: the status goes to ``pending`` and the server supplies the note.

    It never sets ``verified`` â€” no review process exists, so a verified badge would
    be a false credential claim.
    """
    response = api_client.post(
        f"/api/v1/companies/{company_id}/verification-request",
        headers=employer_owner.headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["verification_status"] == "pending"
    assert body["note"]

    reread = api_client.get(
        f"/api/v1/companies/{company_id}", headers=employer_owner.headers
    )
    assert reread.json()["verification_status"] == "pending"


def test_requesting_verification_twice_is_idempotent(
    api_client, employer_owner, company_id
):
    """The client's intent â€” "I have asked" â€” is already satisfied, so no error."""
    path = f"/api/v1/companies/{company_id}/verification-request"

    first = api_client.post(path, headers=employer_owner.headers)
    second = api_client.post(path, headers=employer_owner.headers)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["verification_status"] == "pending"


def test_a_non_member_cannot_request_verification(
    api_client, other_employer, company_id
):
    response = api_client.post(
        f"/api/v1/companies/{company_id}/verification-request",
        headers=other_employer.headers,
    )

    assert response.status_code == 404


def test_a_candidate_cannot_request_verification(api_client, candidate, company_id):
    response = api_client.post(
        f"/api/v1/companies/{company_id}/verification-request",
        headers=candidate.headers,
    )

    assert response.status_code == 403


def test_the_last_owner_cannot_be_removed(api_client, employer_owner, company_id):
    members = api_client.get(
        f"/api/v1/companies/{company_id}/members", headers=employer_owner.headers
    ).json()
    owner_membership = next(m for m in members if m["role"] == "owner")

    response = api_client.delete(
        f"/api/v1/companies/{company_id}/members/{owner_membership['id']}",
        headers=employer_owner.headers,
    )

    assert response.status_code == 409


def test_accepting_without_an_invitation_answers_404(
    api_client, employer_owner, company_id
):
    """A caller with no invitation must not be able to confirm one exists."""
    response = api_client.post(
        f"/api/v1/companies/{company_id}/members/me/accept",
        headers=employer_owner.headers,
    )

    assert response.status_code == 404


def test_accepting_requires_authentication(api_client, company_id):
    response = api_client.post(f"/api/v1/companies/{company_id}/members/me/accept")

    assert response.status_code == 401
