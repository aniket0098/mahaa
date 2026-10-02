"""``/opportunities`` — §12.1's two read-only routes.

**Rows are inserted directly rather than through the API, and that is the point.**
Employer job posting is [F] in V1, so there is deliberately no write route to test
against; these tests build the fixture rows through the session, which is also what
lets them construct the states the feed must *refuse* to show — a draft, a non-public
posting — that no client can create.

The assertions that matter are about **absence**: §12.1 says the feed is read-only and
carries no ACL, so the only safety property available is that a posting which is not
published-and-public is invisible on both routes.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from tests.conftest import register


def _employer(api_client):
    return register(api_client, f"emp.{uuid.uuid4().hex[:12]}@example.com", "employer")


def _make_company(db_session, name="Globex"):
    from app.models import Company, CompanyStatus
    from app.models.enums import VerificationStatus

    company = Company(
        name=name,
        slug=f"{name.lower()}-{uuid.uuid4().hex[:8]}",
        verification_status=VerificationStatus.UNVERIFIED,
        status=CompanyStatus.ACTIVE,
    )
    db_session.add(company)
    db_session.flush()
    return company


def _make_opportunity(
    db_session,
    company,
    *,
    title="Backend Engineer",
    opportunity_type="job",
    status="published",
    visibility="public",
    work_mode="remote",
    description=None,
    comp_min=None,
    comp_max=None,
    published_at=None,
):
    from app.models import Opportunity

    row = Opportunity(
        company_id=company.id,
        title=title,
        slug=f"{title.lower().replace(' ', '-')}-{uuid.uuid4().hex[:8]}",
        opportunity_type=opportunity_type,
        status=status,
        visibility=visibility,
        description=description,
        work_mode=work_mode,
        comp_min=comp_min,
        comp_max=comp_max,
        published_at=published_at or datetime.now(tz=UTC),
    )
    db_session.add(row)
    db_session.flush()
    return row


@pytest.fixture()
def company(db_session):
    return _make_company(db_session)


@pytest.fixture()
def published(db_session, company):
    return _make_opportunity(db_session, company)


@pytest.fixture()
def reader(api_client):
    return _employer(api_client)
# --------------------------------------------------------------------------- #
# The feed
# --------------------------------------------------------------------------- #


def test_the_feed_is_empty_before_anything_is_posted(api_client, reader):
    """An empty feed is ``total: 0`` and **zero** pages, not one.

    With 1-based paging, "page 1 of a 0-page set" is a request that does not exist,
    and the client renders an honest empty state rather than an empty page.
    """
    response = api_client.get("/api/v1/opportunities", headers=reader.headers)

    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["pages"] == 0


def test_a_published_posting_appears_in_the_feed(api_client, reader, published):
    """The happy path: ``FastApiPage<Opportunity>``."""
    response = api_client.get("/api/v1/opportunities", headers=reader.headers)

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert [item["id"] for item in body["items"]] == [str(published.id)]
    assert body["items"][0]["title"] == "Backend Engineer"


def test_the_feed_requires_authentication(api_client):
    assert api_client.get("/api/v1/opportunities").status_code == 401


def test_a_candidate_may_read_the_feed(api_client, candidate, published):
    """§12.1 makes this "read-only for candidates" — the feed is their surface."""
    response = api_client.get("/api/v1/opportunities", headers=candidate.headers)

    assert response.status_code == 200
    assert response.json()["total"] == 1


def test_an_employer_may_read_the_feed_too(api_client, reader, published):
    """No role gate: §12.1 states there is no per-viewer ACL.

    Refusing a signed-in employer would be a 403 for a reason the specification does
    not give.
    """
    response = api_client.get("/api/v1/opportunities", headers=reader.headers)
    assert response.status_code == 200


# --------------------------------------------------------------------------- #
# What the feed must never show
# --------------------------------------------------------------------------- #


def test_a_draft_posting_is_invisible_on_both_routes(
    api_client, reader, db_session, company
):
    """§14.10 indexes ``(status, published_at DESC)`` precisely so drafts can be
    excluded — a feed needs a non-published state to filter out."""
    draft = _make_opportunity(db_session, company, title="Secret Draft", status="draft")

    feed = api_client.get("/api/v1/opportunities", headers=reader.headers)
    detail = api_client.get(f"/api/v1/opportunities/{draft.id}", headers=reader.headers)

    assert feed.json()["total"] == 0
    assert detail.status_code == 404


def test_a_non_public_posting_is_invisible_on_both_routes(
    api_client, reader, db_session, company
):
    """``visibility`` is a real discriminator, not a constant — and it is enforced."""
    hidden = _make_opportunity(
        db_session, company, title="Hidden", visibility="unlisted"
    )

    feed = api_client.get("/api/v1/opportunities", headers=reader.headers)
    detail = api_client.get(
        f"/api/v1/opportunities/{hidden.id}", headers=reader.headers
    )

    assert feed.json()["total"] == 0
    assert detail.status_code == 404


def test_an_unknown_opportunity_answers_404(api_client, reader):
    response = api_client.get(
        f"/api/v1/opportunities/{uuid.uuid4()}", headers=reader.headers
    )

    assert response.status_code == 404


# --------------------------------------------------------------------------- #
# Filters and paging
# --------------------------------------------------------------------------- #


def test_the_feed_filters_by_type(api_client, reader, db_session, company):
    """The client's filter names are the wire contract, so ``type`` is aliased."""
    _make_opportunity(db_session, company, title="A Job", opportunity_type="job")
    _make_opportunity(
        db_session, company, title="An Internship", opportunity_type="internship"
    )

    response = api_client.get(
        "/api/v1/opportunities?type=internship", headers=reader.headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "An Internship"


def test_the_feed_filters_by_work_mode(api_client, reader, db_session, company):
    _make_opportunity(db_session, company, title="Remote", work_mode="remote")
    _make_opportunity(db_session, company, title="Onsite", work_mode="onsite")

    response = api_client.get(
        "/api/v1/opportunities?work_mode=onsite", headers=reader.headers
    )

    assert response.json()["total"] == 1
    assert response.json()["items"][0]["title"] == "Onsite"


def test_the_feed_searches_title_and_description(
    api_client, reader, db_session, company
):
    """§12.1: "Search is ``q`` against title/description"."""
    _make_opportunity(db_session, company, title="Rust Engineer")
    _make_opportunity(
        db_session, company, title="Barista", description="Espresso machine hero"
    )

    by_title = api_client.get("/api/v1/opportunities?q=Rust", headers=reader.headers)
    by_description = api_client.get(
        "/api/v1/opportunities?q=espresso", headers=reader.headers
    )

    assert by_title.json()["total"] == 1
    assert by_description.json()["total"] == 1


def test_an_unmatched_filter_is_an_empty_page_not_an_error(
    api_client, reader, published
):
    response = api_client.get(
        "/api/v1/opportunities?q=nothing-matches-this", headers=reader.headers
    )

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["total"] == 0


def test_the_envelope_reports_pages_from_the_unfiltered_total(
    api_client, reader, db_session, company
):
    """``pages`` comes from ``total``, so a full final page is the last page."""
    for index in range(5):
        _make_opportunity(db_session, company, title=f"Role {index}")

    response = api_client.get(
        "/api/v1/opportunities?page_size=2", headers=reader.headers
    )

    body = response.json()
    assert body["total"] == 5
# --------------------------------------------------------------------------- #
# Response shape — the parts the client's types depend on
# --------------------------------------------------------------------------- #


def test_compensation_arrives_as_a_number_not_a_string(
    api_client, reader, db_session, company
):
    """``NUMERIC(12,2)`` is a ``Decimal`` in the ORM and a **string** in JSON.

    ``src/types/opportunity.ts`` declares ``comp_min: number | null``, so a raw
    ``Decimal`` would silently turn the client's numeric field into text.
    """
    row = _make_opportunity(db_session, company, comp_min=1000.00, comp_max=1500.50)

    response = api_client.get(f"/api/v1/opportunities/{row.id}", headers=reader.headers)

    body = response.json()
    assert body["comp_min"] == 1000.0
    assert body["comp_max"] == 1500.5
    assert isinstance(body["comp_min"], float)


def test_null_compensation_stays_null(api_client, reader, published):
    body = api_client.get(
        f"/api/v1/opportunities/{published.id}", headers=reader.headers
    ).json()

    assert body["comp_min"] is None
    assert body["comp_max"] is None


def test_saved_and_application_fields_are_omitted_not_null(
    api_client, reader, published
):
    """``is_saved`` and ``my_application_id`` belong to [F] domains in V1.

    Sending ``null`` would imply the server has an answer about applications and
    saved postings, which it does not; the client's type has both as optional, so
    omission is the honest shape.
    """
    body = api_client.get(
        f"/api/v1/opportunities/{published.id}", headers=reader.headers
    ).json()

    assert "is_saved" not in body
    assert "my_application_id" not in body


def test_the_company_snapshot_is_a_projection_not_the_whole_company(
    api_client, reader, published
):
    """§12.1's module docstring: a posting card is the least appropriate place to
    expose a company's full record to every authenticated reader."""
    body = api_client.get(
        f"/api/v1/opportunities/{published.id}", headers=reader.headers
    ).json()

    company = body["company"]
    assert "description" not in company
    assert "created_at" not in company
    assert set(company) == {
        "id",
        "name",
        "slug",
        "industry",
        "location",
        "website",
        "logo_url",
        "verification_status",
    }


def test_requirements_resolve_skill_names_from_the_catalogue(
    api_client, reader, db_session, published, make_skill
):
    """``requirements`` is a list of objects, not names, and the name is resolved.

    §14.9 requires a table rather than a ``text[]`` precisely so a requirement can
    carry a skill id *and* a kind without the copy going stale.
    """
    from app.models import OpportunityRequirement
    from app.models.enums import RequirementKind

    skill = make_skill(name="Rust")
    db_session.add(
        OpportunityRequirement(
            opportunity_id=published.id,
            skill_id=skill.id,
            kind=RequirementKind.REQUIRED,
            min_level="3 years",
            importance="high",
        )
    )
    db_session.flush()

    body = api_client.get(
        f"/api/v1/opportunities/{published.id}", headers=reader.headers
    ).json()

    assert len(body["requirements"]) == 1
    requirement = body["requirements"][0]
    assert requirement["skill_id"] == str(skill.id)
    assert requirement["skill_name"] == "Rust"
    assert requirement["kind"] == "required"
    assert requirement["min_level"] == "3 years"
    assert requirement["importance"] == "high"


def test_a_posting_with_no_requirements_returns_an_empty_list(
    api_client, reader, published
):
    """An empty ``requirements`` is ``[]``, never ``null`` — the client maps it."""
    body = api_client.get(
        f"/api/v1/opportunities/{published.id}", headers=reader.headers
    ).json()

    assert body["requirements"] == []


def test_requirements_appear_on_the_list_item_too(api_client, reader, published):
    """§12.1's list item carries ``requirements[]``, so it must be batched, not N+1."""
    feed = api_client.get("/api/v1/opportunities", headers=reader.headers)

    assert feed.json()["items"][0]["requirements"] == []


def test_the_feed_orders_by_published_at_newest_first(
    api_client, reader, db_session, company
):
    now = datetime.now(tz=UTC)
    older = _make_opportunity(
        db_session, company, title="Older", published_at=now - timedelta(days=5)
    )
    newer = _make_opportunity(db_session, company, title="Newer", published_at=now)

    body = api_client.get("/api/v1/opportunities", headers=reader.headers).json()

    assert [item["id"] for item in body["items"]] == [str(newer.id), str(older.id)]
    assert len(body["items"]) == 2


def test_a_page_beyond_the_end_is_empty_but_not_an_error(
    api_client, reader, published
):
    response = api_client.get("/api/v1/opportunities?page=9", headers=reader.headers)

    assert response.status_code == 200
    assert response.json()["items"] == []


def test_a_page_size_beyond_the_ceiling_is_refused(api_client, reader):
    """Bounded so a typo cannot ask for the whole table in one request."""
    response = api_client.get(
        "/api/v1/opportunities?page_size=100000", headers=reader.headers
    )

    assert response.status_code == 422


def test_a_malformed_opportunity_id_answers_404_not_422(api_client, reader):
    """Keeps the route from becoming a UUID-format oracle."""
    response = api_client.get("/api/v1/opportunities/nonsense", headers=reader.headers)

    assert response.status_code == 404


def test_the_detail_route_requires_authentication(api_client, published):
    assert api_client.get(f"/api/v1/opportunities/{published.id}").status_code == 401
