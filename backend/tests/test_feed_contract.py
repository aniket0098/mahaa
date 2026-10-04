"""Home-feed contract: author identity, public profiles, and safe project links.

Three additive changes with three different failure modes, so the tests are
grouped by change rather than by route.

**The author fields are asserted as *present and correct*, not merely present.**
``public_id`` is the key an author link carries, so a field that exists but is
copied from the wrong row would produce a feed whose taps go to the wrong person.

**The privacy tests are the point of ``GET /users/{public_id}``.** A route that
returns an owner's profile without consulting their settings is not a small bug:
it hands a stranger an email address and a job-search profile. So the tests
assert *both* directions -- a private profile withholds its sections, and a
public one publishes them -- because either assertion alone is satisfied by a
route that always withholds, or one that never does.

**Section 5.3's absent-not-null rule is asserted directly.** "Not shown" and
"shown and empty" are different claims; ``headline: null`` on a public profile and
no ``headline`` key at all on a private one is the difference being tested.

**URL validation is tested through the routes, not the validator.** A unit test of
``validate_public_url`` would pass while the schema forgot to call it.
"""

from __future__ import annotations

import pytest

from tests.conftest import Account

# --- helpers ------------------------------------------------------------------


def publish(api_client, account: Account, **overrides) -> dict:
    """A text post, which is the cheapest way to read an ``author`` back."""
    payload = {"kind": "text", "category": "community", "body": "Hello."}
    payload.update(overrides)
    response = api_client.post("/api/v1/posts", json=payload, headers=account.headers)
    assert response.status_code == 201, response.text
    return response.json()


def set_privacy(api_client, account: Account, **overrides) -> None:
    """``PUT /profile/privacy`` as the owner."""
    body = {
        "profile_visibility": "public",
        "discoverable": True,
        "allow_messages": True,
        "show_email": True,
        "show_phone": True,
    }
    body.update(overrides)
    response = api_client.put(
        "/api/v1/profile/privacy", json=body, headers=account.headers
    )
    assert response.status_code == 200, response.text


def public_id_of(account: Account) -> str:
    return account.body["public_id"]


# --- change 1: the post author carries both handles ----------------------------


def test_post_author_carries_public_id_and_username(api_client, candidate):
    """The two handles the feed needs, correct rather than merely present."""
    created = publish(api_client, candidate)

    read = api_client.get(f"/api/v1/posts/{created['id']}", headers=candidate.headers)
    assert read.status_code == 200, read.text
    author = read.json()["author"]

    assert author["public_id"] == public_id_of(candidate)
    assert author["username"] == candidate.username


def test_the_feed_and_the_detail_agree_on_the_author(api_client, candidate):
    """The list is what a card renders; the detail is what a tap loads.

    If only one of the two carried the handles, a feed card would show a blank
    handle while the post page showed the right one -- the kind of split that
    only shows up on screen.
    """
    created = publish(api_client, candidate)

    feed = api_client.get("/api/v1/posts", headers=candidate.headers)
    assert feed.status_code == 200, feed.text
    listed = next(p for p in feed.json()["items"] if p["id"] == created["id"])

    detail = api_client.get(f"/api/v1/posts/{created['id']}", headers=candidate.headers)
    assert listed["author"] == detail.json()["author"]


def test_the_existing_author_fields_are_all_still_present(api_client, candidate):
    """Widening the author must not drop a field a card already reads."""
    created = publish(api_client, candidate)
    author = api_client.get(
        f"/api/v1/posts/{created['id']}", headers=candidate.headers
    ).json()["author"]

    assert set(author) == {
        "name",
        "public_id",
        "username",
        "headline",
        "avatar_url",
        "verified",
        "is_self",
    }
    assert author["name"] == candidate.body["name"]
    assert author["is_self"] is True


def test_verified_stays_false_and_is_not_a_claim(api_client, candidate):
    """No verification signal exists in V1, so the field must not invent one.

    A ``True`` here would be a credential badge rendered from nothing.
    """
    created = publish(api_client, candidate)
    author = api_client.get(
        f"/api/v1/posts/{created['id']}", headers=candidate.headers
    ).json()["author"]

    assert author["verified"] is False

# --- change 2: GET /users/{public_id} ------------------------------------------


def test_a_public_profile_is_readable_by_another_signed_in_account(
    api_client, candidate, other_candidate
):
    response = api_client.get(
        f"/api/v1/users/{public_id_of(candidate)}", headers=other_candidate.headers
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["public_id"] == public_id_of(candidate)
    assert body["username"] == candidate.username
    assert body["name"] == candidate.body["name"]
    assert body["role"] == "candidate"
    assert body["is_owner"] is False
    assert body["avatar_url"] is None


def test_an_unknown_public_id_is_the_standard_404(api_client, candidate):
    """The shared error envelope, not a FastAPI default and not a 403.

    A 403 would confirm the id exists; the route must not be an existence oracle.
    """
    response = api_client.get(
        "/api/v1/users/NOPE-NOT-A-REAL-ID", headers=candidate.headers
    )

    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert error["message"]
    assert "request_id" in error


def test_the_route_requires_authentication(api_client, candidate):
    """An anonymous caller gets nothing, rather than a reduced profile."""
    response = api_client.get(f"/api/v1/users/{public_id_of(candidate)}")

    assert response.status_code == 401


def test_the_response_exposes_no_secret_or_private_account_field(
    api_client, candidate, other_candidate
):
    """No password hash, no token, no security setting -- in any nesting."""
    set_privacy(api_client, candidate)
    response = api_client.get(
        f"/api/v1/users/{public_id_of(candidate)}", headers=other_candidate.headers
    )
    assert response.status_code == 200, response.text

    serialised = response.text.lower()
    for forbidden in (
        "password_hash",
        "password",
        "hashed",
        "bcrypt",
        "argon",
        "token",
        "secret",
        "access_token",
        "refresh_token",
        "current_password",
        "new_password",
    ):
        assert forbidden not in serialised, (
            f"{forbidden!r} leaked in the public profile"
        )


def test_the_owner_never_sees_their_own_privacy_settings_or_preferences(
    api_client, candidate, other_candidate
):
    """The owner's own aggregate carries settings; a public profile must not.

    ``privacy`` and ``preferences`` are how a person configures their visibility
    and their job search. Publishing either to a reader would be a leak, and it is
    the failure a naive "reuse the aggregate and drop a few keys" implementation
    walks straight into.
    """
    set_privacy(api_client, candidate, profile_visibility="public")
    api_client.put(
        "/api/v1/profile/preferences",
        json={
            "work_modes": ["remote"],
            "employment_types": ["full_time"],
            "preferred_locations": ["Pune"],
            "currency": "INR",
            "willing_to_relocate": True,
        },
        headers=candidate.headers,
    )

    own = api_client.get(
        f"/api/v1/users/{public_id_of(candidate)}", headers=candidate.headers
    )
    assert own.status_code == 200, own.text
    assert "privacy" not in own.json()
    assert "preferences" not in own.json()


def test_a_private_profile_withholds_everything_past_identity(
    api_client, candidate, other_candidate
):
    """The other direction: a private profile must actually withhold."""
    set_privacy(api_client, candidate, profile_visibility="private", show_email=False)

    response = api_client.get(
        f"/api/v1/users/{public_id_of(candidate)}", headers=other_candidate.headers
    )
    assert response.status_code == 200, response.text
    body = response.json()

    # Identity still answers: the caller already held the public id.
    assert body["public_id"] == public_id_of(candidate)
    assert body["visibility"] == "private"

    for withheld in (
        "headline",
        "summary",
        "location",
        "interests",
        "email",
        "phone",
        "skill_count",
        "sections",
        "designation",
    ):
        assert withheld not in body, f"{withheld!r} was published on a private profile"


def test_a_public_profile_publishes_the_sections(
    api_client, candidate, other_candidate
):
    """And the other direction: public must actually publish."""
    set_privacy(api_client, candidate, profile_visibility="public", show_email=True)

    response = api_client.get(
        f"/api/v1/users/{public_id_of(candidate)}", headers=other_candidate.headers
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["visibility"] == "public"
    # "shown and empty" is present and null -- not absent. That is the whole point
    # of section 5.3 and why this route uses exclude_unset, not exclude_none.
    assert "headline" in body and body["headline"] is None
    assert "summary" in body and body["summary"] is None
    assert body["interests"] == []
    assert body["skill_count"] == 0
    assert body["sections"] == {
        "education": [],
        "experience": [],
        "projects": [],
        "certifications": [],
        "achievements": [],
        "links": [],
    }
    assert body["email"] == candidate.email


def test_contact_details_have_their_own_gate(api_client, candidate, other_candidate):
    """A public profile is not a published address.

    Visibility and contact are two separate decisions the owner makes, so turning
    the profile public must not silently publish the email.
    """
    set_privacy(api_client, candidate, profile_visibility="public", show_email=False)

    body = api_client.get(
        f"/api/v1/users/{public_id_of(candidate)}", headers=other_candidate.headers
    ).json()

    assert "sections" in body  # the profile itself is public
    assert "email" not in body  # the address is not

def test_employers_visibility_admits_an_employer_and_refuses_a_candidate(
    api_client, candidate, employer, other_candidate
):
    """The gate is read literally: ``employers`` means the employer role."""
    set_privacy(api_client, candidate, profile_visibility="employers", show_email=False)

    seen_by_employer = api_client.get(
        f"/api/v1/users/{public_id_of(candidate)}", headers=employer.headers
    )
    assert seen_by_employer.status_code == 200, seen_by_employer.text
    assert "sections" in seen_by_employer.json()

    seen_by_candidate = api_client.get(
        f"/api/v1/users/{public_id_of(candidate)}", headers=other_candidate.headers
    )
    assert seen_by_candidate.status_code == 200
    assert "sections" not in seen_by_candidate.json()


def test_the_owner_always_sees_their_own_full_profile(api_client, candidate):
    """Privacy gates other people; it is not a way to hide yourself from yourself."""
    set_privacy(api_client, candidate, profile_visibility="private", show_email=False)

    body = api_client.get(
        f"/api/v1/users/{public_id_of(candidate)}", headers=candidate.headers
    ).json()

    assert body["is_owner"] is True
    assert "sections" in body
    assert "headline" in body


def test_lookup_is_not_shadowed_by_the_path_parameter(api_client, candidate):
    """Routing regression guard.

    FastAPI matches in declaration order, so registering ``/users/{public_id}``
    before ``/users/lookup`` would turn every search into "no profile found".
    This test is the reason the route's placement is a rule, not a habit.
    """
    response = api_client.get(
        "/api/v1/users/lookup",
        params={"query": candidate.username},
        headers=candidate.headers,
    )

    assert response.status_code == 200, response.text
    assert isinstance(response.json(), list)


def test_lookup_still_excludes_the_caller(api_client, candidate):
    """The other half of the guard above: the previous behaviour is intact."""
    response = api_client.get(
        "/api/v1/users/lookup",
        params={"query": candidate.username},
        headers=candidate.headers,
    )

    assert response.status_code == 200
    assert all(item["public_id"] != public_id_of(candidate) for item in response.json())


# --- change 3: project link safety ----------------------------------------------

VALID_LINKS = [
    "https://github.com/example/project",
    "https://example.com/project",
    "http://localhost:3000",
    "https://example.com",
]

UNSAFE_LINKS = [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
    "ftp://example.com",
    "mailto:someone@example.com",
    "random text",
    "https:/no-host",
]


@pytest.mark.parametrize("url", VALID_LINKS)
def test_a_project_post_accepts_a_safe_source_url(api_client, candidate, url):
    response = api_client.post(
        "/api/v1/posts",
        json={
            "kind": "project",
            "category": "projects",
            "project": {"title": "Mahaa", "source_url": url},
        },
        headers=candidate.headers,
    )

    assert response.status_code == 201, response.text
    assert response.json()["project"]["source_url"] == url


@pytest.mark.parametrize("url", VALID_LINKS)
def test_a_project_post_accepts_a_safe_live_url(api_client, candidate, url):
    response = api_client.post(
        "/api/v1/posts",
        json={
            "kind": "project",
            "category": "projects",
            "project": {"title": "Mahaa", "live_url": url},
        },
        headers=candidate.headers,
    )

    assert response.status_code == 201, response.text
    assert response.json()["project"]["live_url"] == url


@pytest.mark.parametrize("url", UNSAFE_LINKS)
@pytest.mark.parametrize("field", ["source_url", "live_url"])
def test_a_project_post_refuses_an_unsafe_link(api_client, candidate, url, field):
    """Both fields, both directions.

    Validating only ``source_url`` would leave the other column storable, and a
    card that renders either one renders it as a link.
    """
    response = api_client.post(
        "/api/v1/posts",
        json={
            "kind": "project",
            "category": "projects",
            "project": {"title": "Mahaa", field: url},
        },
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text
    assert field in response.text


@pytest.mark.parametrize("url", UNSAFE_LINKS)
@pytest.mark.parametrize("field", ["source_url", "live_url"])
def test_a_profile_project_refuses_the_same_links(api_client, candidate, url, field):
    """The same rule on the profile side.

    A profile project renders the same link, so leaving this column unvalidated
    would be a hole right next to the one that was closed.
    """
    response = api_client.post(
        "/api/v1/profile/projects",
        json={"title": "Mahaa", field: url},
        headers=candidate.headers,
    )

    assert response.status_code == 422, response.text
    assert field in response.text

def test_editing_a_link_into_something_unsafe_is_refused(api_client, candidate):
    """Safe on create is not a permanent grant; the PATCH path is validated too."""
    created = api_client.post(
        "/api/v1/profile/projects",
        json={"title": "Mahaa", "source_url": "https://github.com/example/project"},
        headers=candidate.headers,
    )
    assert created.status_code == 201, created.text
    project_id = created.json()["id"]

    rejected = api_client.patch(
        f"/api/v1/profile/projects/{project_id}",
        json={"source_url": "javascript:alert(1)"},
        headers=candidate.headers,
    )
    assert rejected.status_code == 422, rejected.text

    # And the stored value is untouched rather than blanked by the refusal.
    stored = api_client.get("/api/v1/profile", headers=candidate.headers).json()
    project = next(p for p in stored["projects"] if p["id"] == project_id)
    assert project["source_url"] == "https://github.com/example/project"


def test_a_blank_link_is_not_provided_rather_than_invalid(api_client, candidate):
    """Clearing a link is a legitimate edit, so it must not be rejected."""
    response = api_client.post(
        "/api/v1/posts",
        json={
            "kind": "project",
            "category": "projects",
            "project": {"title": "Mahaa", "source_url": "   ", "live_url": ""},
        },
        headers=candidate.headers,
    )

    assert response.status_code == 201, response.text
    project = response.json()["project"]
    # The stored payload is `model_dump(exclude_none=True)`, so a link the author
    # cleared is *absent* rather than null. `WirePost` says as much ("the client
    # reads them as WireProject/WireAchievement and treats every field as
    # optional"), and `src/api/posts.ts` reads it with `?? null` — which is why
    # `.get()` is the honest assertion here and a `["source_url"]` lookup would
    # be asserting a key the contract never promised.
    assert project.get("source_url") is None
    assert project.get("live_url") is None


def test_a_valid_github_link_is_not_claimed_as_verified(api_client, candidate):
    """A syntactically valid URL proves nothing about ownership.

    Nothing here contacts GitHub, and the stored payload carries no verified
    flag, so the honesty is structural rather than a promise in a comment.
    """
    response = api_client.post(
        "/api/v1/posts",
        json={
            "kind": "project",
            "category": "projects",
            "project": {
                "title": "Mahaa",
                "source_url": "https://github.com/someone-else/their-repo",
            },
        },
        headers=candidate.headers,
    )

    assert response.status_code == 201, response.text
    project = response.json()["project"]
    assert "verified" not in project
    assert "github_verified" not in project
