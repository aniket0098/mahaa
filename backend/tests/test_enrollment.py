"""``/courses/{id}/enrollment`` — Stage 5's free-enrolment flow, end to end.

The contract these tests hold, in the order the stage defines it: anonymous is
401; an invisible course is 404 (never a pricing answer that would confirm it
exists); a paid or not-yet-priced course is 409 with no row written; a
genuinely free course writes exactly one ``active`` row for the *token
principal* — repeats answer 200 with that same row, and the unique index
(``uq_enrollments_student_id_course_id``), not an application check, is what
actually stops a racing second insert.

Enrolment rows now go in through the API, because the route exists; fixture
courses still go in through the session, because creator publishing
deliberately does not.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.models import Course, Enrollment
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
):
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
        published_at=None if status == "draft" else datetime.now(tz=UTC),
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


def _enroll(api_client, account, course, body=None):
    url = f"/api/v1/courses/{course.id}/enrollment"
    if body is None:
        return api_client.post(url, headers=_headers(account))
    return api_client.post(url, headers=_headers(account), json=body)


def _state(api_client, account, course):
    return api_client.get(
        f"/api/v1/courses/{course.id}/enrollment", headers=_headers(account)
    )


def _rows(db_session) -> list[Enrollment]:
    return list(db_session.scalars(select(Enrollment)).all())


# --------------------------------------------------------------------------- #
# Who may enrol, and in what
# --------------------------------------------------------------------------- #


def test_anonymous_enrolment_and_state_both_answer_401(api_client, free_course):
    """No token, no state and no write — the same 401 shape as every gated route."""

    post = api_client.post(f"/api/v1/courses/{free_course.id}/enrollment")
    get = api_client.get(f"/api/v1/courses/{free_course.id}/enrollment")

    assert post.status_code == 401, post.text
    assert post.json()["error"]["code"] == "not_authenticated"
    assert get.status_code == 401, get.text


def test_a_free_enrolment_writes_one_active_row_for_the_token_principal(
    api_client, db_session, candidate, other_candidate, free_course
):
    """201 plus the row — and the student is the caller, not any supplied id."""

    response = _enroll(api_client, candidate, free_course)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["course_id"] == str(free_course.id)
    assert body["status"] == "active"
    assert "created_at" in body and "updated_at" in body
    # No student id on the wire in either direction — nothing to branch on.
    assert "student_id" not in body and "user_id" not in body

    rows = _rows(db_session)
    assert len(rows) == 1
    assert rows[0].student_id == uuid.UUID(candidate.id)
    assert rows[0].course_id == free_course.id
    assert str(other_candidate.id) != str(candidate.id)

    # Committed, not merely flushed: a fresh read (all state expired) still
    # finds the row — the persistence half of the stage's checklist.
    db_session.expire_all()
    assert len(_rows(db_session)) == 1


def test_the_request_body_cannot_choose_whose_enrolment_it_is(
    api_client, db_session, candidate, other_candidate, free_course
):
    """A body naming another account is ignored — the route takes no body."""

    response = _enroll(
        api_client,
        candidate,
        free_course,
        body={
            "user_id": str(other_candidate.id),
            "student_id": str(other_candidate.id),
            "status": "cancelled",
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["status"] == "active"
    rows = _rows(db_session)
    assert len(rows) == 1
    assert rows[0].student_id == uuid.UUID(candidate.id)


# --------------------------------------------------------------------------- #
# Idempotency — one row per pair, whatever the timing
# --------------------------------------------------------------------------- #


def test_a_repeat_enrolment_returns_200_and_never_a_second_row(
    api_client, db_session, candidate, free_course
):
    """The double tap: 201 once, then 200 with the very same representation."""

    first = _enroll(api_client, candidate, free_course)
    second = _enroll(api_client, candidate, free_course)

    assert first.status_code == 201, first.text
    assert second.status_code == 200, second.text
    assert second.json() == first.json()
    assert len(_rows(db_session)) == 1


def test_the_race_loser_converges_on_the_winners_row(
    api_client, db_session, candidate, free_course, monkeypatch
):
    """Prove the ``IntegrityError`` arm by making the application check miss.

    Two requests can both ask "is this pair enrolled?" and both hear no, then
    both insert. Simulating that exactly needs two database sessions; the
    *outcome* is what matters, and it is reachable by stubbing the lookup to
    answer "no" when a row already exists. The unique index — not the stubbed
    check — is what stops the second write, and the loser must answer with the
    winner's row rather than a 500 or a second row.
    """

    winner = _enroll(api_client, candidate, free_course)
    assert winner.status_code == 201, winner.text

    monkeypatch.setattr(svc, "_find_enrollment", lambda *args, **kwargs: None)

    loser = _enroll(api_client, candidate, free_course)

    assert loser.status_code == 200, loser.text
    assert loser.json() == winner.json()
    # No raw SQL, no constraint name, no 500 — and still one row.
    assert "uq_enrollments" not in loser.text
    assert "INSERT INTO" not in loser.text
    assert len(_rows(db_session)) == 1


# --------------------------------------------------------------------------- #
# Eligibility — genuinely free means free *and* unpriced
# --------------------------------------------------------------------------- #


def test_a_paid_course_is_a_409_with_no_row_and_honest_state(
    api_client, db_session, candidate, paid_course
):
    """Paid is refused with the conflict envelope — distinguishable, and empty."""

    response = _enroll(api_client, candidate, paid_course)

    assert response.status_code == 409, response.text
    error = response.json()["error"]
    assert error["code"] == "conflict"
    assert "free" in error["message"]
    assert _rows(db_session) == []

    # The state route stays safe and truthful for the same course: not
    # enrolled, no row handed over.
    state = _state(api_client, candidate, paid_course)
    assert state.status_code == 200, state.text
    assert state.json() == {"enrolled": False, "enrollment": None}


def test_a_missing_price_is_never_evidence_of_a_free_course(creator):
    """The eligibility predicate, straight — both halves, no flush required.

    The ``pricing_matches_access`` CHECK makes the corrupt states
    unrepresentable at flush time, so the one place they can still be tested
    is the predicate itself, on a row that never reaches the database: a
    course with no price but no free designation must refuse all the same,
    and a course carrying a price must refuse even while claiming ``is_free``.
    """

    unpriced_but_not_free = Course(
        creator_id=creator.id,
        title="Unpriced, not designated free",
        slug=f"unpriced-{uuid.uuid4().hex[:8]}",
        is_free=False,
        price=None,
    )
    free_but_carries_a_price = Course(
        creator_id=creator.id,
        title="Claims free, carries a price",
        slug=f"lying-{uuid.uuid4().hex[:8]}",
        is_free=True,
        price=9.99,
    )
    genuinely_free = Course(
        creator_id=creator.id,
        title="Genuinely free",
        slug=f"genuine-{uuid.uuid4().hex[:8]}",
        is_free=True,
        price=None,
    )

    assert svc._free_for_enrolment(unpriced_but_not_free) is False
    assert svc._free_for_enrolment(free_but_carries_a_price) is False
    assert svc._free_for_enrolment(genuinely_free) is True


# --------------------------------------------------------------------------- #
# Visibility — 404 before any pricing verdict
# --------------------------------------------------------------------------- #


def test_invisible_courses_answer_404_before_any_pricing_verdict(
    api_client, db_session, creator, candidate
):
    """A draft (free!), an unlisted course, an unknown id and a malformed id.

    The draft being free matters: if eligibility were checked before
    visibility, the route would answer 409-versus-201 on a course the reader
    cannot see, confirming it exists. Every one of these is the same 404.
    """

    draft = _make_course(db_session, creator, title="Draft", status="draft")
    unlisted = _make_course(
        db_session, creator, title="Unlisted", visibility="unlisted"
    )
    unknown = uuid.uuid4()

    answers = [
        _enroll(api_client, candidate, course) for course in (draft, unlisted)
    ]
    answers.append(
        api_client.post(
            f"/api/v1/courses/{unknown}/enrollment", headers=_headers(candidate)
        )
    )
    answers.append(
        api_client.post(
            "/api/v1/courses/not-a-uuid/enrollment", headers=_headers(candidate)
        )
    )
    answers.append(_state(api_client, candidate, draft))

    for response in answers:
        assert response.status_code == 404, response.text
        assert response.json()["error"]["code"] == "not_found"

    assert _rows(db_session) == []


# --------------------------------------------------------------------------- #
# Each account sees only its own enrolment
# --------------------------------------------------------------------------- #


def test_a_second_student_enrols_independently_and_sees_only_their_own(
    api_client, db_session, candidate, other_candidate, free_course
):
    """Two accounts, two rows, two truths — the pair index is per student."""

    assert _state(api_client, other_candidate, free_course).json() == {
        "enrolled": False,
        "enrollment": None,
    }

    mine = _enroll(api_client, candidate, free_course)
    theirs = _enroll(api_client, other_candidate, free_course)

    assert mine.status_code == 201, mine.text
    assert theirs.status_code == 201, theirs.text
    assert theirs.json()["id"] != mine.json()["id"]

    rows = _rows(db_session)
    assert len(rows) == 2
    students = {str(row.student_id) for row in rows}
    assert students == {str(candidate.id), str(other_candidate.id)}

    # Each state read answers about its own caller, after the other enrolled.
    assert _state(api_client, other_candidate, free_course).json()["enrolled"] is True
    assert _state(api_client, candidate, free_course).json()["enrolled"] is True


def test_the_state_endpoint_is_honest_before_and_after_enrolment(
    api_client, candidate, free_course
):
    """The exact flow the course-detail screen renders, over the wire."""

    before = _state(api_client, candidate, free_course)
    assert before.status_code == 200, before.text
    assert before.json() == {"enrolled": False, "enrollment": None}

    created = _enroll(api_client, candidate, free_course)
    assert created.status_code == 201, created.text

    after = _state(api_client, candidate, free_course)
    assert after.status_code == 200, after.text
    body = after.json()
    assert body["enrolled"] is True
    assert body["enrollment"]["id"] == created.json()["id"]
    assert body["enrollment"]["status"] == "active"


# --------------------------------------------------------------------------- #
# Failures stay inside the shared envelope
# --------------------------------------------------------------------------- #


def test_a_database_failure_is_sanitised_to_the_shared_envelope(
    db_session, candidate, free_course, monkeypatch
):
    """A broken database is a generic 500 — never the DSN, never the SQL.

    Built on its own client with ``raise_server_exceptions=False`` so the
    app's own ``Exception`` handler is the thing under test, exactly as a
    real server would run it.
    """

    from fastapi.testclient import TestClient

    from app.db.session import get_db
    from app.main import create_app

    def _exploded(*args, **kwargs):
        raise SQLAlchemyError(
            "connection lost: postgres://app:sekrit-dsn@db.example/app"
        )

    monkeypatch.setattr(svc, "_find_enrollment", _exploded)

    application = create_app()

    def _override_get_db():
        yield db_session

    application.dependency_overrides[get_db] = _override_get_db
    with TestClient(application, raise_server_exceptions=False) as client:
        response = client.post(
            f"/api/v1/courses/{free_course.id}/enrollment",
            headers=_headers(candidate),
        )

    assert response.status_code == 500, response.text
    error = response.json()["error"]
    assert error["code"] == "internal_error"
    assert error["message"] == "Something went wrong on our side."
    assert "sekrit-dsn" not in response.text
    assert "postgres://" not in response.text
    assert "SELECT" not in response.text and "INSERT" not in response.text
