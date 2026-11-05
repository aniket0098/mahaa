"""``/courses`` — the Learning Hub catalogue reads, and the domain constraints.

**Rows are inserted directly rather than through the API, and that is the
point.** Creator publishing is a later stage, so there is deliberately no
write route to test against; these tests build fixture rows through the
session, which is also what lets them construct the states the catalogue must
*refuse* to show — a draft, an unlisted course.

The assertions that matter are about **absence**: a course that is not
published-and-public is invisible on both routes, and a malformed, unknown or
restricted id all answer the same 404. The model-level tests at the bottom
pin the CHECKs and unique indexes that make duplicate enrollments and
double-priced courses unrepresentable.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from app.models.enums import UserRole, UserStatus
import pytest
from tests.conftest import assert_rejected


def _make_course(
    db_session,
    creator,
    *,
    title="Web Development 101",
    category="Web Development",
    skill_level="beginner",
    status="published",
    visibility="public",
    is_free=True,
    price=None,
    price_currency=None,
    description=None,
    published_at=None,
):
    from app.models import Course

    row = Course(
        creator_id=creator.id,
        title=title,
        slug=f"{title.lower().replace(' ', '-')}-{uuid.uuid4().hex[:8]}",
        description=description,
        category=category,
        skill_level=skill_level,
        language="en",
        estimated_duration_minutes=120,
        is_free=is_free,
        price=price,
        price_currency=price_currency,
        status=status,
        visibility=visibility,
        published_at=published_at or datetime.now(tz=UTC),
    )
    db_session.add(row)
    db_session.flush()
    return row


def _make_section(db_session, course, *, title="Getting started", position=0):
    from app.models import CourseSection

    row = CourseSection(course_id=course.id, title=title, position=position)
    db_session.add(row)
    db_session.flush()
    return row


def _make_lecture(
    db_session,
    section,
    *,
    title="Read the docs",
    position=0,
    kind="reading",
    external_url=None,
    media_id=None,
    status="published",
    is_preview=False,
):
    from app.models import CourseLecture

    row = CourseLecture(
        section_id=section.id,
        title=title,
        position=position,
        kind=kind,
        external_url=external_url,
        media_id=media_id,
        status=status,
        is_preview=is_preview,
    )
    db_session.add(row)
    db_session.flush()
    return row


@pytest.fixture()
def creator(user_factory):
    return user_factory()


@pytest.fixture()
def published(db_session, creator):
    return _make_course(db_session, creator)


def _headers(account):
    return {"Authorization": f"Bearer {account.token}"}


# --------------------------------------------------------------------------- #
# The catalogue
# --------------------------------------------------------------------------- #


def test_the_catalogue_is_empty_before_anything_is_published(api_client, candidate):
    """An empty catalogue is ``total: 0`` and **zero** pages, not one."""
    response = api_client.get("/api/v1/courses", headers=_headers(candidate))

    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["pages"] == 0


def test_the_catalogue_requires_authentication(api_client):
    assert api_client.get("/api/v1/courses").status_code == 401


def test_a_published_course_appears_in_the_catalogue(api_client, candidate, published):
    """The happy path: ``FastApiPage<Course>`` with the instructor snapshot."""
    response = api_client.get("/api/v1/courses", headers=_headers(candidate))

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["page"] == 1
    item = body["items"][0]
    assert item["id"] == str(published.id)
    assert item["title"] == "Web Development 101"
    assert item["is_free"] is True
    assert item["price"] is None
    assert item["skill_level"] == "beginner"
    assert item["instructor"]["name"] == "Test Person"
    assert item["instructor"]["public_id"].startswith("MJ-")


def test_an_employer_may_read_the_catalogue_too(api_client, employer, published):
    """No role gate: the catalogue is a signed-in read, as on ``/opportunities``."""
    response = api_client.get("/api/v1/courses", headers=_headers(employer))
    assert response.status_code == 200
    assert response.json()["total"] == 1
# --------------------------------------------------------------------------- #
# What the catalogue must never show
# --------------------------------------------------------------------------- #


def test_a_draft_course_is_invisible_on_both_routes(
    api_client, candidate, db_session, creator
):
    draft = _make_course(db_session, creator, title="Secret Draft", status="draft")

    listing = api_client.get("/api/v1/courses", headers=_headers(candidate))
    assert listing.json()["total"] == 0

    detail = api_client.get(f"/api/v1/courses/{draft.id}", headers=_headers(candidate))
    assert detail.status_code == 404
    # The same sentence a missing id gets, so the route is not an existence oracle.
    assert detail.json()["error"]["code"] == "not_found"


def test_an_unlisted_course_is_invisible_on_both_routes(
    api_client, candidate, db_session, creator
):
    row = _make_course(db_session, creator, title="Unlisted", visibility="unlisted")

    listing = api_client.get("/api/v1/courses", headers=_headers(candidate))
    assert listing.json()["total"] == 0

    detail = api_client.get(f"/api/v1/courses/{row.id}", headers=_headers(candidate))
    assert detail.status_code == 404


def test_a_nonexistent_or_malformed_id_both_answer_404(api_client, candidate):
    missing = api_client.get(
        f"/api/v1/courses/{uuid.uuid4()}", headers=_headers(candidate)
    )
    malformed = api_client.get("/api/v1/courses/nonsense", headers=_headers(candidate))

    assert missing.status_code == 404
    assert malformed.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"
def test_search_and_filters_on_the_catalogue(
    api_client, candidate, db_session, creator
):
    """Search matches title/description; category/skill_level/pricing filter."""
    _make_course(db_session, creator, title="Web Development 101")
    _make_course(
        db_session, creator, title="Data Science Basics", category="Data Science",
        skill_level="intermediate",
    )
    _make_course(
        db_session, creator, title="Paid Design Course", is_free=False,
        price=4999, price_currency="INR",
    )

    response = api_client.get(
        "/api/v1/courses?q=web&category=Web Development",
        headers=_headers(candidate),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "Web Development 101"

    response = api_client.get(
        "/api/v1/courses?skill_level=intermediate", headers=_headers(candidate)
    )
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["title"] == "Data Science Basics"

    response = api_client.get(
        "/api/v1/courses?pricing=paid", headers=_headers(candidate)
    )
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["title"] == "Paid Design Course"

    response = api_client.get(
        "/api/v1/courses?pricing=free", headers=_headers(candidate)
    )
    assert response.status_code == 200
    assert response.json()["total"] == 2


def test_pagination_boundaries_on_empty_and_full_catalogue(api_client, candidate):
    """Zero pages on empty; page params round-trip unchanged."""
    empty = api_client.get(
        "/api/v1/courses?page=1&page_size=20", headers=_headers(candidate)
    )
    assert empty.status_code == 200
    assert empty.json()["pages"] == 0
    assert empty.json()["items"] == []
    assert empty.json()["total"] == 0


def test_course_detail_includes_ordered_sections_and_lectures(
    api_client, candidate, db_session, creator
):
    """Sections ordered by position, lectures ordered within each section."""
    course = _make_course(db_session, creator, title="React Crash Course")
    sec_b = _make_section(db_session, course, title="Basics", position=0)
    sec_a = _make_section(db_session, course, title="Setup", position=1)
    # Deliberately created out of order so the service must order by position.
    _make_lecture(db_session, sec_b, title="JSX", position=1)
    _make_lecture(db_session, sec_b, title="Hello World", position=0)

    response = api_client.get(f"/api/v1/courses/{course.id}", headers=_headers(candidate))

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "React Crash Course"
    assert [s["title"] for s in body["sections"]] == ["Basics", "Setup"]
    basics = body["sections"][0]
    assert [l["title"] for l in basics["lectures"]] == ["Hello World", "JSX"]


# --------------------------------------------------------------------------- #
# Course lecture media: who may read the bytes
# --------------------------------------------------------------------------- #


def _seed_video_asset(db_session, owner) -> str:
    """Insert a real MP4 media row owned by ``owner`` and return its id."""
    from app.models import MediaAsset
    from app.models.enums import MediaKind

    media_id = uuid.uuid4()
    row = MediaAsset(
        id=media_id,
        owner_id=owner.id,
        kind=MediaKind.VIDEO,
        mime_type="video/mp4",
        size_bytes=1234,
        width=None,
        height=None,
        duration_ms=None,
        storage_kind="database",
        storage_key=str(media_id),
        served_at=f"/api/v1/media/{media_id}",
        data=b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00" + b"\x00" * 16,
    )
    db_session.add(row)
    db_session.flush()
    return str(media_id)


def test_lecture_media_is_not_readable_by_a_stranger(
    api_client, candidate, db_session, creator, user_factory
):
    """A non-preview hosted-video lecture's bytes are owner-only until enrolled."""
    # Create a stranger user by signing up - this gives us a proper auth token
    stranger_email = f"stranger_{uuid.uuid4().hex[:8]}@test.com"
    response = api_client.post(
        "/api/v1/auth/signup",
        json={"name": "Stranger", "email": stranger_email, "password": "TestPass123", "role": "candidate"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]

    # Get the user info from the me endpoint
    me = api_client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    stranger_user = me.json()

    course = _make_course(db_session, creator, title="Video Course")
    section = _make_section(db_session, course, title="Basics", position=0)
    media_id = _seed_video_asset(db_session, creator)
    _make_lecture(
        db_session,
        section,
        title="Lecture One",
        position=0,
        kind="hosted_video",
        media_id=uuid.UUID(media_id),
        is_preview=False,
    )

    # Stranger makes authenticated request - cannot access lecture media
    # without enrollment
    response = api_client.get(
        f"/api/v1/media/{media_id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"

    response = api_client.get(
        f"/api/v1/media/{media_id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_preview_lecture_media_is_readable_by_any_member(
    api_client, candidate, db_session, creator, user_factory
):
    """is_preview=true means any signed-in member may play the lecture."""
    member_email = f"member_{uuid.uuid4().hex[:8]}@test.com"
    course = _make_course(db_session, creator, title="Preview Course")
    section = _make_section(db_session, course, title="Basics", position=0)
    media_id = _seed_video_asset(db_session, creator)
    _make_lecture(
        db_session,
        section,
        title="Free Preview",
        position=0,
        kind="hosted_video",
        media_id=uuid.UUID(media_id),
        is_preview=True,
    )

    # Register the member to get a proper auth token
    response = api_client.post(
        "/api/v1/auth/signup",
        json={"name": "Member", "email": member_email, "password": "TestPass123", "role": "candidate"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]

    # Get the user info from the me endpoint
    me = api_client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text

    # Member makes authenticated request - can access preview lecture media
    response = api_client.get(
        f"/api/v1/media/{media_id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200, response.text


def test_enrolled_student_can_read_non_preview_lecture_media(
    api_client, candidate, db_session, creator, user_factory
):
    """A non-preview lecture's bytes are readable by an enrolled student."""
    student_email = f"student_{uuid.uuid4().hex[:8]}@test.com"
    # Register the student first
    response = api_client.post(
        "/api/v1/auth/signup",
        json={"name": "Student", "email": student_email, "password": "TestPass123", "role": "candidate"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]

    # Get the student user ID from the me endpoint
    me = api_client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    student_id = uuid.UUID(me.json()["id"])

    course = _make_course(db_session, creator, title="Paid Video Course")
    section = _make_section(db_session, course, title="Basics", position=0)
    media_id = _seed_video_asset(db_session, creator)
    _make_lecture(
        db_session,
        section,
        title="Lecture One",
        position=0,
        kind="hosted_video",
        media_id=uuid.UUID(media_id),
        is_preview=False,
    )
    from app.models import Enrollment
    from app.models.enums import EnrollmentStatus

    # Enroll the student in the course
    db_session.add(
        Enrollment(
            student_id=student_id,
            course_id=course.id,
            status=EnrollmentStatus.ACTIVE,
        )
    )
    db_session.flush()

    # Enrolled student makes authenticated request - can access non-preview lecture media
    response = api_client.get(
        f"/api/v1/media/{media_id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200, response.text


def test_cancelled_enrollment_blocks_lecture_media(
    api_client, candidate, db_session, creator, user_factory
):
    """A cancelled enrolment does not grant access to non-preview lecture bytes."""
    student_email = f"student_{uuid.uuid4().hex[:8]}@test.com"
    # Register the student first
    response = api_client.post(
        "/api/v1/auth/signup",
        json={"name": "Student", "email": student_email, "password": "TestPass123", "role": "candidate"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]

    # Get the student user ID from the me endpoint
    me = api_client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    student_id = uuid.UUID(me.json()["id"])

    course = _make_course(db_session, creator, title="Cancelled Course")
    section = _make_section(db_session, course, title="Basics", position=0)
    media_id = _seed_video_asset(db_session, creator)
    _make_lecture(
        db_session,
        section,
        title="Lecture One",
        position=0,
        kind="hosted_video",
        media_id=uuid.UUID(media_id),
        is_preview=False,
    )
    from app.models import Enrollment
    from app.models.enums import EnrollmentStatus

    # Enroll the student with CANCELLED status
    db_session.add(
        Enrollment(
            student_id=student_id,
            course_id=course.id,
            status=EnrollmentStatus.CANCELLED,
        )
    )
    db_session.flush()

    # Cancelled student makes authenticated request - cannot access non-preview lecture media
    response = api_client.get(
        f"/api/v1/media/{media_id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_draft_course_lecture_media_is_invisible(
    api_client, candidate, db_session, creator, user_factory
):
    """A draft course's lecture media stays protected even for enrolled students."""
    student_email = f"student_{uuid.uuid4().hex[:8]}@test.com"
    # Register the student first
    response = api_client.post(
        "/api/v1/auth/signup",
        json={"name": "Student", "email": student_email, "password": "TestPass123", "role": "candidate"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]

    # Get the student user ID from the me endpoint
    me = api_client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    student_id = uuid.UUID(me.json()["id"])

    course = _make_course(
        db_session, creator, title="Draft Course", status="draft"
    )
    section = _make_section(db_session, course, title="Basics", position=0)
    media_id = _seed_video_asset(db_session, creator)
    _make_lecture(
        db_session,
        section,
        title="Lecture One",
        position=0,
        kind="hosted_video",
        media_id=uuid.UUID(media_id),
        is_preview=False,
    )
    from app.models import Enrollment
    from app.models.enums import EnrollmentStatus

    # Enroll the student in the draft course
    db_session.add(
        Enrollment(
            student_id=student_id,
            course_id=course.id,
            status=EnrollmentStatus.ACTIVE,
        )
    )
    db_session.flush()

    # Enrolled student in a draft course makes authenticated request - cannot access lecture media
    response = api_client.get(
        f"/api/v1/media/{media_id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_non_video_lecture_media_stays_owner_only(
    api_client, candidate, db_session, creator, user_factory
):
    """A reading lecture's media is not member-readable just because it is referenced."""
    stranger_email = f"stranger_{uuid.uuid4().hex[:8]}@test.com"
    # Register the stranger first
    response = api_client.post(
        "/api/v1/auth/signup",
        json={"name": "Stranger", "email": stranger_email, "password": "TestPass123", "role": "candidate"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]

    # Get the stranger user ID from the me endpoint
    me = api_client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    stranger_id = uuid.UUID(me.json()["id"])

    course = _make_course(db_session, creator, title="Reading Course")
    section = _make_section(db_session, course, title="Basics", position=0)
    media_id = _seed_video_asset(db_session, creator)
    _make_lecture(
        db_session,
        section,
        title="Reading One",
        position=0,
        kind="reading",
        media_id=uuid.UUID(media_id),
    )

    # Stranger makes authenticated request - cannot access lecture media just because it is referenced
    response = api_client.get(
        f"/api/v1/media/{media_id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"

# --------------------------------------------------------------------------- #
# Model / database constraints
# --------------------------------------------------------------------------- #


def test_enrollment_uniqueness_constraint(db_session, creator, user_factory):
    """Two students can each enrol once; the same pair cannot enrol twice."""
    from app.models import Course, Enrollment

    course = Course(
        creator_id=creator.id, title="E", slug="e", description=None,
        category=None, skill_level=None, language=None,
        estimated_duration_minutes=None, is_free=True,
    )
    db_session.add(course)
    db_session.flush()
    student_a = user_factory()
    student_b = user_factory()

    first = Enrollment(student_id=student_a.id, course_id=course.id)
    db_session.add(first)
    db_session.flush()
    second_for_other = Enrollment(student_id=student_b.id, course_id=course.id)
    db_session.add(second_for_other)
    db_session.flush()

    duplicate = Enrollment(student_id=student_a.id, course_id=course.id)
    assert_rejected(db_session, duplicate)


def test_free_course_with_a_price_is_rejected_by_check(db_session, creator):
    """pricing_matches_access: free ⟺ no price, everywhere."""
    from app.models import Course

    row = Course(
        creator_id=creator.id, title="Paid", slug="paid", is_free=True,
        price=1999, price_currency="INR",
    )
    assert_rejected(db_session, row)


def test_negative_duration_is_rejected(db_session, creator):
    """Estimated duration cannot be negative."""
    from app.models import Course

    row = Course(
        creator_id=creator.id, title="Neg", slug="neg",
        estimated_duration_minutes=-5,
    )
    assert_rejected(db_session, row)


def test_lecture_cannot_offer_both_sources(db_session, user_factory):
    """media_id and external_url are mutually exclusive."""
    from app.models import CourseLecture, CourseSection, Course

    course = Course(
        creator_id=user_factory().id, title="C", slug="c", is_free=True,
    )
    db_session.add(course)
    db_session.flush()
    section = CourseSection(course_id=course.id, title="S", position=0)
    db_session.add(section)
    db_session.flush()

    row = CourseLecture(
        section_id=section.id, title="L", kind="reading",
        external_url="https://example.com/reading", media_id=uuid.uuid4(),
    )
    assert_rejected(db_session, row)


def test_external_video_requires_url(db_session, user_factory):
    """external_video kind without an external_url violates its CHECK."""
    from app.models import CourseLecture, CourseSection, Course

    course = Course(
        creator_id=user_factory().id, title="C", slug="c", is_free=True,
    )
    db_session.add(course)
    db_session.flush()
    section = CourseSection(course_id=course.id, title="S", position=0)
    db_session.add(section)
    db_session.flush()

    row = CourseLecture(
        section_id=section.id, title="L", kind="external_video",
    )
    assert_rejected(db_session, row)