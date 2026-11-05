"""``GET /courses/enrollments/mine`` — list the caller's own enrolments.

Contract: anonymous is 401; the student is the token principal (never a
request parameter); only this account's rows come back; cancelled enrolments
and courses that fail the published+public visibility rule are excluded;
ordering is deterministic (most recent first); an empty account still gets a
valid empty page.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import get_db
from app.main import create_app
from app.models import Course, Enrollment
from app.models.enums import CourseStatus, CourseVisibility, EnrollmentStatus
from app.services import courses as svc


def _make_course(
    db_session,
    creator,
    *,
    title="Free Course",
    status="published",
    visibility="public",
    is_free=True,
    price=None,
    price_currency=None,
    published_at=None,
):
    if published_at is None and status == "published":
        published_at = datetime.now(tz=UTC)
    row = Course(
        creator_id=creator.id,
        title=title,
        slug=f"{title.lower().replace(' ', '-')}-{uuid.uuid4().hex[:8]}",
        category="Testing",
        skill_level="beginner",
        language="en",
        estimated_duration_minutes=60,
        is_free=is_free,
        price=price,
        price_currency=price_currency,
        status=status,
        visibility=visibility,
        published_at=published_at,
    )
    db_session.add(row)
    db_session.flush()
    return row


@pytest.fixture()
def creator(user_factory):
    return user_factory()


@pytest.fixture()
def free_course(db_session, creator):
    return _make_course(db_session, creator)


@pytest.fixture()
def paid_course(db_session, creator):
    return _make_course(
        db_session,
        creator,
        title="Paid Course",
        is_free=False,
        price=49.0,
        price_currency="INR",
    )


def _headers(account):
    return {"Authorization": f"Bearer {account.token}"}


def _enroll(api_client, account, course):
    return api_client.post(
        f"/api/v1/courses/{course.id}/enrollment", headers=_headers(account)
    )



# --------------------------------------------------------------------------- #
# Who may list, and what they see
# --------------------------------------------------------------------------- #


def test_anonymous_list_answers_401(api_client):
    """No token — same 401 as every gated route."""

    response = api_client.get("/api/v1/courses/enrollments/mine")
    assert response.status_code == 401, response.text


def test_empty_account_receives_a_valid_empty_page(api_client, candidate):
    """Zero enrolments is still a page: items empty, total 0, pages 0."""

    response = _mine(api_client, candidate)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert body["pages"] == 0


def test_authenticated_student_receives_own_enrolments(api_client, candidate, free_course):
    """An enrolment the caller made appears with its real course metadata."""

    created = _enroll(api_client, candidate, free_course)
    assert created.status_code == 201, created.text

    response = _mine(api_client, candidate)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1

    item = body["items"][0]
    assert item["enrollment"]["id"] == created.json()["id"]
    assert item["enrollment"]["course_id"] == str(free_course.id)
    assert item["enrollment"]["status"] == "active"
    assert item["course"]["id"] == str(free_course.id)
    assert item["course"]["title"] == free_course.title
    assert item["course"]["is_free"] is True


def test_second_student_never_sees_the_first_students_enrolments(
    api_client, db_session, candidate, other_candidate, free_course
):
    """Privacy: enrolment rows are per student, never shared across accounts."""

    mine = _enroll(api_client, candidate, free_course)
    assert mine.status_code == 201, mine.text

    theirs = _mine(api_client, other_candidate)
    assert theirs.status_code == 200, theirs.text
    assert theirs.json()["items"] == []
    assert theirs.json()["total"] == 0

    # The enrolment still exists for its owner.
    rows = _rows(db_session)
    assert len(rows) == 1
    assert str(rows[0].student_id) == str(candidate.id)

# --------------------------------------------------------------------------- #
# Data correctness: ordering, pagination, exclusions
# --------------------------------------------------------------------------- #


def test_enrolment_order_is_most_recent_first(api_client, db_session, candidate):
    """Most recently enrolled first, id as tiebreaker — deterministic."""

    base = datetime.now(tz=UTC)
    courses = [
        _make_course(db_session, candidate, title=f"Course {n}", published_at=base)
        for n in range(3)
    ]
    times = [base - timedelta(hours=2), base - timedelta(hours=1), base]
    for course, when in zip(courses, times):
        _enrol_direct(db_session, candidate, course, when)

    response = _mine(api_client, candidate)
    assert response.status_code == 200, response.text
    titles = [item["course"]["title"] for item in response.json()["items"]]
    assert titles == ["Course 2", "Course 1", "Course 0"]


def test_multiple_enrolled_courses_are_returned(api_client, db_session, candidate):
    """Multiple enrolments, each once, total correct."""

    base = datetime.now(tz=UTC)
    courses = [
        _make_course(db_session, candidate, title=f"Course {n}", published_at=base)
        for n in range(3)
    ]
    for course in courses:
        _enrol_direct(db_session, candidate, course, base)

    response = _mine(api_client, candidate)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 3
    assert len(body["items"]) == 3
    ids = {item["course"]["id"] for item in body["items"]}
    assert ids == {str(c.id) for c in courses}


def test_pagination_returns_correct_page(api_client, db_session, candidate):
    """page_size=1 over two enrolments yields two pages."""

    base = datetime.now(tz=UTC)
    courses = [
        _make_course(db_session, candidate, title=f"P{n}", published_at=base)
        for n in range(2)
    ]
    for course in courses:
        _enrol_direct(db_session, candidate, course, base)

    page1 = _mine(api_client, candidate, page=1, page_size=1)
    assert page1.status_code == 200, page1.text
    assert len(page1.json()["items"]) == 1
    assert page1.json()["total"] == 2
    assert page1.json()["pages"] == 2

    page2 = _mine(api_client, candidate, page=2, page_size=1)
    assert page2.status_code == 200, page2.text
    assert len(page2.json()["items"]) == 1
    assert (
        page2.json()["items"][0]["course"]["id"]
        != page1.json()["items"][0]["course"]["id"]
    )


def test_invalid_pagination_is_rejected(api_client, candidate):
    """page < 1 and page_size > MAX_PAGE_SIZE are honest 422s."""

    assert _mine(api_client, candidate, page=0, page_size=20).status_code == 422
    assert _mine(api_client, candidate, page=1, page_size=101).status_code == 422


def test_unpublished_and_unlisted_courses_are_excluded(api_client, db_session, candidate):
    """Courses that fail the visibility rule never appear in My Learning."""

    draft = _make_course(
        db_session, candidate, title="Draft", status="draft", published_at=None
    )
    unlisted = _make_course(
        db_session, candidate, title="Unlisted", visibility="unlisted"
    )
    _enrol_direct(db_session, candidate, draft, datetime.now(tz=UTC))
    _enrol_direct(db_session, candidate, unlisted, datetime.now(tz=UTC))

    response = _mine(api_client, candidate)
    assert response.status_code == 200, response.text
    assert response.json()["items"] == []
    assert response.json()["total"] == 0

# --------------------------------------------------------------------------- #
# Regression
# --------------------------------------------------------------------------- #


def test_paid_course_cannot_be_enrolled_and_absent_from_list(
    api_client, candidate, paid_course
):
    """Paid course: POST is 409 with no row, and nothing appears in My Learning."""

    post = api_client.post(
        f"/api/v1/courses/{paid_course.id}/enrollment", headers=_headers(candidate)
    )
    assert post.status_code == 409, post.text

    response = _mine(api_client, candidate)
    assert response.status_code == 200, response.text
    assert response.json()["items"] == []


def test_database_failure_is_sanitised_to_shared_envelope(
    db_session, candidate, free_course, monkeypatch
):
    """A broken database is a generic 500 — never the DSN or SQL."""

    def _exploded(*args, **kwargs):
        raise SQLAlchemyError("connection lost: postgres://app:sekrit-dsn@db.example/app")

    monkeypatch.setattr(svc, "list_my_enrollments", _exploded)

    application = create_app()

    def _override_get_db():
        yield db_session

    application.dependency_overrides[get_db] = _override_get_db
    with TestClient(application, raise_server_exceptions=False) as client:
        response = client.get(
            "/api/v1/courses/enrollments/mine", headers=_headers(candidate)
        )

    assert response.status_code == 500, response.text
    error = response.json()["error"]
    assert error["code"] == "internal_error"
    assert error["message"] == "Something went wrong on our side."
    assert "sekrit-dsn" not in response.text
    assert "postgres://" not in response.text
    assert "SELECT" not in response.text and "INSERT" not in response.text


def test_cancelled_enrolment_is_excluded(api_client, db_session, candidate):
    """A cancelled row is not treated as an enrolment (mirrors state read)."""

    course = _make_course(db_session, candidate, published_at=datetime.now(tz=UTC))
    _enrol_direct(db_session, candidate, course, datetime.now(tz=UTC))
    # Mark the only row cancelled.
    db_session.execute(
        Enrollment.__table__.update().where(
            Enrollment.course_id == course.id,
            Enrollment.student_id == candidate.id,
        ),
        {"status": EnrollmentStatus.CANCELLED},
    )
    db_session.commit()

    response = _mine(api_client, candidate)
    assert response.status_code == 200, response.text
    assert response.json()["items"] == []


def test_no_parameter_can_select_another_student(
    api_client, candidate, other_candidate, free_course
):
    """The route takes no student selector; output follows the token principal."""

    _enroll(api_client, candidate, free_course)
    _enroll(api_client, other_candidate, free_course)

    mine = _mine(api_client, candidate)
    assert mine.status_code == 200, mine.text
    mine_ids = {item["course"]["id"] for item in mine.json()["items"]}
    assert mine_ids == {str(free_course.id)}
    assert len(mine.json()["items"]) == 1

    theirs = _mine(api_client, other_candidate)
    theirs_ids = {item["course"]["id"] for item in theirs.json()["items"]}
    assert theirs_ids == {str(free_course.id)}
    assert len(theirs.json()["items"]) == 1

def _mine(api_client, account, page=1, page_size=20):
    return api_client.get(
        f"/api/v1/courses/enrollments/mine?page={page}&page_size={page_size}",
        headers=_headers(account),
    )


def _rows(db_session) -> list[Enrollment]:
    return list(db_session.scalars(select(Enrollment)).all())


def _enrol_direct(db_session, student, course, created_at):
    """Insert an enrolment row with a controllable created_at for ordering."""

    row = Enrollment(student_id=student.id, course_id=course.id)
    db_session.add(row)
    db_session.flush()
    db_session.execute(
        Enrollment.__table__.update()
        .where(Enrollment.id == row.id)
        .values(created_at=created_at, updated_at=created_at)
    )
    db_session.commit()
    return row
