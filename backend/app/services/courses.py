"""Courses — the Learning Hub's catalogue reads.

**The catalogue's two reads, plus Stage 5's one write — free enrolment.**
Creator publishing, uploads, progress and payments belong to later stages; a
``POST /courses`` that returned 201 today would contradict the honest
"arrives in a later stage" screens, so the router deliberately has no create
route rather than one nobody calls. ``POST /courses/{id}/enrollment`` is the
exception Stage 5 ships: it exists because the ``enrollments`` table, the wire
schemas and the client flow ship with it, and it only ever converges on one
``active`` row per (student, course) pair, only for genuinely free courses.

**Visibility is enforced in SQL, not in Python.** ``_base_query`` excludes
non-published and non-public rows in the ``WHERE`` clause, so a draft cannot
leak through a missed filter — and the detail route uses the *same* base
query, which is what makes "unlisted and nonexistent both answer 404" a
structural property rather than two code paths that happen to agree today.

**Ordering is total.** ``published_at DESC NULLS LAST, created_at DESC, id
DESC``: timestamps collide at microsecond resolution, and a page without a
total order can repeat or drop a row across pages. ``id`` as the final
tiebreaker makes two courses created in the same instant still stable.

**Pagination is the ``FastApiPage`` envelope**, the same one
``/opportunities`` and ``/stories`` use, so the client's ``FastApiPage<T>``
type reads off this response unchanged.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from decimal import Decimal

from sqlalchemy import Select, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, contains_eager

from app.core.errors import ApiError, ErrorCode
from app.models import Course, CourseLecture, CourseSection, Enrollment
from app.models.enums import CourseStatus, CourseVisibility, EnrollmentStatus
from app.schemas.common import FastApiPage, build_fastapi_page
from app.schemas.courses import (
    CourseDetailOut,
    CourseInstructorOut,
    CourseLectureOut,
    CourseOut,
    CourseSectionOut,
    EnrolledCourseOut,
    EnrollmentOut,
    EnrollmentStateOut,
    MyCourseDetailOut,
    MyCourseOut,
    CourseCreate,
    CourseUpdate,
    SectionCreate,
    SectionUpdate,
    LectureCreate,
    LectureUpdate,
)


#: The catalogue's page window — same bounds as ``/opportunities`` so the two
#: paged reads cannot drift, each declaring its own constants.
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100

#: Search runs against title and description, as ``/opportunities`` does.
_SEARCH_COLUMNS = (Course.title, Course.description)


def _not_found(what: str = "course") -> ApiError:
    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message=f"That {what} was not found.",
    )


def _float_or_none(value: Decimal | float | None) -> float | None:
    """``NUMERIC(12,2)`` arrives as ``Decimal``; the client wants ``number | null``.

    A ``Decimal`` serialises as the *string* ``"10.00"``, so the conversion
    happens once here rather than in every response builder — the same
    reasoning ``services/opportunities.py`` records.
    """
    return None if value is None else float(value)


def _base_query() -> Select:  # noqa: UP047
    """Only courses a reader is allowed to see, in a total order.

    ``published`` and ``public`` are both excluded **in SQL**, so neither a
    draft nor an unlisted course can leak through a missed Python-side filter,
    and every route that shows a course reads through this one function.
    """
    return (
        select(Course)
        .where(
            Course.status == CourseStatus.PUBLISHED,
            Course.visibility == CourseVisibility.PUBLIC,
        )
        .order_by(
            Course.published_at.desc().nullslast(),
            Course.created_at.desc(),
            Course.id.desc(),
        )
    )


def _instructor_out(course: Course) -> CourseInstructorOut:
    """The creator snapshot, read off the row ``lazy="joined"`` already loaded.

    ``name`` and ``public_id`` are ``users`` columns — the two handles a card
    needs to name and link an instructor. The avatar is deliberately *not*
    included: resolving it is a second lookup per row (the feed does it for
    twenty posts), and a card that shows a name does not need a face.
    """
    return CourseInstructorOut(
        id=course.creator.id,
        name=course.creator.name,
        public_id=course.creator.public_id,
    )


def _to_out(course: Course) -> CourseOut:
    return CourseOut(
        id=course.id,
        title=course.title,
        slug=course.slug,
        description=course.description,
        category=course.category,
        skill_level=course.skill_level,
        language=course.language,
        estimated_duration_minutes=course.estimated_duration_minutes,
        is_free=course.is_free,
        price=_float_or_none(course.price),
        price_currency=course.price_currency,
        thumbnail_media_id=course.thumbnail_media_id,
        instructor=_instructor_out(course),
        created_at=course.created_at,
        published_at=course.published_at,
    )


def list_courses(
    session: Session,
    *,
    q: str | None = None,
    category: str | None = None,
    skill_level: str | None = None,
    pricing: str | None = None,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> FastApiPage[CourseOut]:
    """``GET /courses`` — the filtered, paged catalogue.

    The ``COUNT`` shares the filter predicate, so ``pages`` cannot disagree
    with the rows. Search is a case-insensitive substring ``ILIKE`` over
    title/description rather than full-text ranking: the contract promises
    search, not ranking, and an empty catalogue is simply an empty page.

    ``pricing`` is the free/paid filter: ``free`` selects ``is_free`` rows,
    ``paid`` the future-compatible priced rows. The catalogue itself still
    writes nothing — enrolment is the separate POST route in the endpoint
    module, not something a read may quietly do.
    """
    query = _base_query()
    if category:
        query = query.where(Course.category == category)
    if skill_level:
        query = query.where(Course.skill_level == skill_level)
    if pricing == "free":
        query = query.where(Course.is_free.is_(True))
    elif pricing == "paid":
        query = query.where(Course.is_free.is_(False))
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        query = query.where(
            or_(*(column.ilike(pattern) for column in _SEARCH_COLUMNS))
        )

    total = session.scalar(
        select(func.count()).select_from(query.order_by(None).subquery())
    )
    rows = (
        session.scalars(query.offset((page - 1) * page_size).limit(page_size)).all()
        if page_size
        else []
    )
    items = [_to_out(row) for row in rows]
    return build_fastapi_page(items, int(total or 0), page, page_size)


def get_course(session: Session, course_id: uuid.UUID) -> CourseDetailOut:
    """``GET /courses/{id}`` — the same visibility rules as the list.

    A draft, an unlisted course and an id that does not exist all answer
    **404**: the detail route must not become a way to confirm a restricted
    course exists. The curriculum is loaded in two ordered queries rather than
    through lazy relationships, so the projection never depends on session
    lazy-loading state, and both levels order by ``position``.
    """
    course = session.scalar(_base_query().where(Course.id == course_id))
    if course is None:
        raise _not_found() from None

    sections = session.scalars(
        select(CourseSection)
        .where(CourseSection.course_id == course.id)
        .order_by(CourseSection.position)
    ).all()
    grouped: dict[uuid.UUID, list[CourseLectureOut]] = {
        section.id: [] for section in sections
    }
    if sections:
        lectures = session.scalars(
            select(CourseLecture)
            .where(CourseLecture.section_id.in_(list(grouped)))
            .order_by(CourseLecture.position, CourseLecture.id)
        ).all()
        for lecture in lectures:
            if lecture.section_id in grouped:
                grouped[lecture.section_id].append(
                    CourseLectureOut(
                        id=lecture.id,
                        title=lecture.title,
                        description=lecture.description,
                        position=lecture.position,
                        kind=lecture.kind,
                        media_id=lecture.media_id,
                        external_url=lecture.external_url,
                        duration_seconds=lecture.duration_seconds,
                        is_preview=lecture.is_preview,
                        status=lecture.status,
                    )
                )

    return CourseDetailOut.model_validate(
        {
            **_to_out(course).model_dump(),
            "sections": [
                CourseSectionOut(
                    id=section.id,
                    title=section.title,
                    description=section.description,
                    position=section.position,
                    lectures=grouped[section.id],
                )
                for section in sections
            ],
        }
    )


# --------------------------------------------------------------------------- #
# Stage 5 — free enrolment
# --------------------------------------------------------------------------- #


def _free_for_enrolment(course: Course) -> bool:
    """Genuinely free: designated ``is_free`` **and** carrying no price.

    Both halves are required, and the missing-price half is deliberately the
    stricter one. The ``pricing_matches_access`` CHECK keeps ``is_free`` and
    ``price`` mutually exclusive at flush time, but this predicate never leans
    on that: a missing price is *not* evidence of a free course — ``is_free``
    set to ``False`` with no price at all must still refuse — and a course that
    carries a price is never free no matter what it claims, because payments
    (and therefore server-verified entitlements) arrive in a later stage.
    """
    return bool(course.is_free) and course.price is None


def _not_free_for_enrolment() -> ApiError:
    """409 for paid *and* unverified-price courses — one honest verdict.

    409 rather than 403 because nothing is forbidden about the caller: the
    resource's own state (it is not free) conflicts with the operation, the
    same conflict grammar ``services/connections.py`` uses for state clashes.
    The message names both refusable states, so a not-yet-priced course is
    never reported as though somebody were simply denied access to it.
    """
    return ApiError(
        status_code=409,
        code=ErrorCode.CONFLICT,
        message=(
            "Only free courses can be enrolled in for free; "
            "this course is paid or not yet priced."
        ),
    )


def _find_enrollment(
    session: Session, student_id: uuid.UUID, course_id: uuid.UUID
) -> Enrollment | None:
    """The caller's single row for this course — the pair's identity."""
    return session.scalar(
        select(Enrollment).where(
            Enrollment.student_id == student_id,
            Enrollment.course_id == course_id,
        )
    )


def _enrollment_out(row: Enrollment) -> EnrollmentOut:
    """Serialise the row explicitly, the way ``_to_out`` builds a course.

    Field by field rather than ``from_attributes``, so the wire shape stays a
    deliberate list — and ``student_id`` is deliberately *not* on that list:
    an enrolment response is about the caller's row, and a client has no id to
    branch on, feed back, or aim at somebody else's record.
    """
    return EnrollmentOut(
        id=row.id,
        course_id=row.course_id,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _settle_existing(session: Session, row: Enrollment) -> Enrollment:
    """A repeat enrolment means "ensure enrolled" — never a second row.

    ``active`` and ``completed`` already *are* enrolled and are returned
    untouched: re-enrolling must never downgrade a ``completed`` record back
    to in-progress. ``cancelled`` is revived in place rather than re-inserted,
    because the unique index makes one row per pair for the pair's whole life —
    the same reviving-not-reinserting logic ``services/connections.py``
    records. Nothing in Stage 5 writes ``cancelled`` (there is no unenrol
    route), so this transition serves a state only a later stage can produce;
    it is not an unenrolment flow by the back door.
    """
    if row.status is EnrollmentStatus.CANCELLED:
        row.status = EnrollmentStatus.ACTIVE
        session.add(row)
        session.commit()
        session.refresh(row)
    return row


def enroll_in_free_course(
    session: Session, student_id: uuid.UUID, course_id: uuid.UUID
) -> tuple[EnrollmentOut, bool]:
    """``POST /courses/{id}/enrollment`` — enrol the caller in a free course.

    Returns ``(enrollment, created)``: ``created`` is ``False`` when the caller
    was already enrolled, which the route answers with **200** instead of 201.
    The repeat is idempotent — it returns the winner's own stable
    representation — so a double tap converges on one row instead of erroring.
    (``/connections`` answers a racing *duplicate request* with 409 because its
    operation is "send a request"; here the operation is "be enrolled", and
    being enrolled twice is the same state as being enrolled once.)

    Refusals are ordered so no route becomes an oracle: visibility first — a
    draft, an unlisted course or an unknown id is a 404 through
    ``_base_query``, never the pricing 409 that would confirm a restricted
    course exists — then eligibility, then the pair's own state.

    The ``IntegrityError`` arm is not defensive padding. Between the lookup and
    the insert another request for the same pair can commit from a different
    session, and ``uq_enrollments_student_id_course_id`` rejects the loser; the
    application check cannot see that race, so the database decides it. The
    loser rolls back, re-reads the winner, and answers with the very row the
    winner reports — never a 500, never the SQL, never a second row.
    """
    course = session.scalar(_base_query().where(Course.id == course_id))
    if course is None:
        raise _not_found() from None
    if not _free_for_enrolment(course):
        raise _not_free_for_enrolment()

    existing = _find_enrollment(session, student_id, course_id)
    if existing is not None:
        return _enrollment_out(_settle_existing(session, existing)), False

    row = Enrollment(student_id=student_id, course_id=course_id)
    session.add(row)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        # Deliberately a straight select, not `_find_enrollment`: the
        # application check has just been shown wrong by the unique index (or
        # was stubbed to miss), so this read asks the table, not the check.
        winner = session.scalar(
            select(Enrollment).where(
                Enrollment.student_id == student_id,
                Enrollment.course_id == course_id,
            )
        )
        if winner is None:
            raise ApiError(
                status_code=409,
                code=ErrorCode.CONFLICT,
                message=(
                    "The enrolment changed while it was being saved. "
                    "Please try again."
                ),
            ) from exc
        return _enrollment_out(winner), False
    session.refresh(row)
    return _enrollment_out(row), True


def get_enrollment_state(
    session: Session, student_id: uuid.UUID, course_id: uuid.UUID
) -> EnrollmentStateOut:
    """``GET /courses/{id}/enrollment`` — the caller's state for one course.

    Same visibility rule as the detail read: an invisible course is a 404, so
    the route cannot confirm a restricted course exists. ``enrollment``
    mirrors ``enrolled`` exactly as ``EnrollmentStateOut`` documents — the row
    when enrolled, ``None`` when not — so the client never has to derive
    identity from a boolean alone. Reads only; this function writes nothing.
    """
    course = session.scalar(_base_query().where(Course.id == course_id))
    if course is None:
        raise _not_found() from None

    row = _find_enrollment(session, student_id, course_id)
    if row is None or row.status is EnrollmentStatus.CANCELLED:
        return EnrollmentStateOut(enrolled=False, enrollment=None)
    return EnrollmentStateOut(enrolled=True, enrollment=_enrollment_out(row))


def list_my_enrollments(
    session: Session,
    *,
    student_id: uuid.UUID,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> FastApiPage[EnrolledCourseOut]:
    """``GET /courses/enrollments/mine`` — the caller's enrolled courses.

    Returns only this student's own enrolments (resolved from the token
    principal by the route), excludes cancelled rows, and only surfaces
    courses that pass the same published+public visibility rule the detail
    route enforces — so a course listed here always opens on
    ``GET /courses/{id}``. Ordering is deterministic: most recently enrolled
    first, with ``id`` as the final tiebreaker.
    """
    query = (
        select(Enrollment)
        .join(Course, Enrollment.course_id == Course.id)
        .options(contains_eager(Enrollment.course))
        .where(Enrollment.student_id == student_id)
        .where(Enrollment.status != EnrollmentStatus.CANCELLED)
        .where(Course.status == CourseStatus.PUBLISHED)
        .where(Course.visibility == CourseVisibility.PUBLIC)
        .order_by(
            Enrollment.created_at.desc(),
            Enrollment.id.desc(),
        )
    )

    total = session.scalar(
        select(func.count()).select_from(query.order_by(None).subquery())
    )
    rows = (
        session.scalars(query.offset((page - 1) * page_size).limit(page_size)).all()
        if page_size
        else []
    )
    items = [
        EnrolledCourseOut(
            enrollment=_enrollment_out(row),
            course=_to_out(row.course),
        )
        for row in rows
    ]
    return build_fastapi_page(items, int(total or 0), page, page_size)



def _slugify(name: str) -> str:
    """ASCII, lowercase, hyphen-joined — the shareable handle's alphabet."""
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_only = decomposed.encode("ascii", "ignore").decode("ascii").lower()
    parts = re.split(r"[^a-z0-9]+", ascii_only)
    slug = "-".join(part for part in parts if part)
    return slug[:200] or "course"


def _unique_slug(session: Session, title: str) -> str:
    """A slug no other course holds."""
    base = _slugify(title)
    candidate = base
    for _attempt in range(50):
        exists = session.scalar(select(Course.id).where(Course.slug == candidate))
        if exists is None:
            return candidate
        candidate = f"{base}-{_attempt + 2}"
    return f"{base}-{uuid.uuid4().hex[:8]}"



def create_course(
    session: Session,
    *, viewer_id: uuid.UUID, data: CourseCreate) -> CourseOut:
    """POST /courses — create a new course as a draft."""
    row = Course(
        creator_id=viewer_id,
        title=data.title,
        slug=_unique_slug(session, data.title),
        description=data.description,
        category=data.category,
        skill_level=data.skill_level,
        language=data.language,
        estimated_duration_minutes=data.estimated_duration_minutes,
        is_free=data.is_free,
        visibility=data.visibility,
    )
    session.add(row)
    session.flush()
    session.commit()
    return CourseOut.model_validate(_to_out(row))




def update_course(
    session: Session,
    *,
    viewer_id: uuid.UUID,
    course_id: uuid.UUID,
    data: CourseUpdate,
) -> CourseOut:
    """PUT /courses/{id} â€” update a course (owner only)."""
    row = session.scalar(
        select(Course).where(Course.id == course_id, Course.creator_id == viewer_id)
    )
    if row is None:
        raise _not_found("course") from None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    session.flush()
    session.commit()
    return CourseOut.model_validate(_to_out(row))


def delete_course(
    session: Session,
    *,
    viewer_id: uuid.UUID,
    course_id: uuid.UUID,
) -> None:
    """DELETE /courses/{id} â€” delete a course (owner only)."""
    row = session.scalar(
        select(Course).where(Course.id == course_id, Course.creator_id == viewer_id)
    )
    if row is None:
        raise _not_found("course") from None
    session.delete(row)
    session.flush()
    session.commit()


def create_section(
    session: Session,
    *,
    viewer_id: uuid.UUID,
    course_id: uuid.UUID,
    data: SectionCreate,
) -> CourseSectionOut:
    """POST /courses/{id}/sections â€” create a section (owner only)."""
    course = session.scalar(
        select(Course).where(Course.id == course_id, Course.creator_id == viewer_id)
    )
    if course is None:
        raise _not_found("course") from None
    max_pos = session.scalar(
        select(func.coalesce(func.max(CourseSection.position), -1)).where(
            CourseSection.course_id == course_id
        )
    )
    row = CourseSection(
        course_id=course_id,
        title=data.title,
        description=data.description,
        position=(max_pos or -1) + 1,
    )
    session.add(row)
    session.flush()
    session.commit()
    return CourseSectionOut(
        id=row.id,
        title=row.title,
        description=row.description,
        position=row.position,
        lectures=[],
    )


def update_section(
    session: Session,
    *,
    viewer_id: uuid.UUID,
    course_id: uuid.UUID,
    section_id: uuid.UUID,
    data: SectionUpdate,
) -> CourseSectionOut:
    """PUT /courses/{id}/sections/{section_id} â€” update a section (owner only)."""
    row = session.scalar(
        select(CourseSection)
        .join(Course, CourseSection.course_id == Course.id)
        .where(CourseSection.id == section_id, CourseSection.course_id == course_id, Course.creator_id == viewer_id)
    )
    if row is None:
        raise _not_found("section") from None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    session.flush()
    session.commit()
    return CourseSectionOut(
        id=row.id,
        title=row.title,
        description=row.description,
        position=row.position,
        lectures=[],
    )


def delete_section(
    session: Session,
    *,
    viewer_id: uuid.UUID,
    course_id: uuid.UUID,
    section_id: uuid.UUID,
) -> None:
    """DELETE /courses/{id}/sections/{section_id} â€” delete a section (owner only)."""
    row = session.scalar(
        select(CourseSection)
        .join(Course, CourseSection.course_id == Course.id)
        .where(CourseSection.id == section_id, CourseSection.course_id == course_id, Course.creator_id == viewer_id)
    )
    if row is None:
        raise _not_found("section") from None
    session.delete(row)
    session.flush()
    session.commit()


def create_lecture(
    session: Session,
    *,
    viewer_id: uuid.UUID,
    course_id: uuid.UUID,
    section_id: uuid.UUID,
    data: LectureCreate,
) -> CourseLectureOut:
    """POST /courses/{id}/sections/{section_id}/lectures â€” create a lecture (owner only)."""
    section = session.scalar(
        select(CourseSection)
        .join(Course, CourseSection.course_id == Course.id)
        .where(CourseSection.id == section_id, CourseSection.course_id == course_id, Course.creator_id == viewer_id)
    )
    if section is None:
        raise _not_found("section") from None
    max_pos = session.scalar(
        select(func.coalesce(func.max(CourseLecture.position), -1)).where(
            CourseLecture.section_id == section_id
        )
    )
    row = CourseLecture(
        section_id=section_id,
        title=data.title,
        description=data.description,
        position=(max_pos or -1) + 1,
        kind=data.kind,
        media_id=data.media_id,
        external_url=data.external_url,
        duration_seconds=data.duration_seconds,
        is_preview=data.is_preview,
        status=data.status,
    )
    session.add(row)
    session.flush()
    session.commit()
    return CourseLectureOut(
        id=row.id,
        title=row.title,
        description=row.description,
        position=row.position,
        kind=row.kind,
        media_id=row.media_id,
        external_url=row.external_url,
        duration_seconds=row.duration_seconds,
        is_preview=row.is_preview,
        status=row.status,
    )


def update_lecture(
    session: Session,
    *,
    viewer_id: uuid.UUID,
    course_id: uuid.UUID,
    section_id: uuid.UUID,
    lecture_id: uuid.UUID,
    data: LectureUpdate,
) -> CourseLectureOut:
    """PUT /courses/{id}/sections/{section_id}/lectures/{lecture_id} â€” update a lecture (owner only)."""
    row = session.scalar(
        select(CourseLecture)
        .join(CourseSection, CourseLecture.section_id == CourseSection.id)
        .join(Course, CourseSection.course_id == Course.id)
        .where(CourseLecture.id == lecture_id, CourseLecture.section_id == section_id, CourseSection.course_id == course_id, Course.creator_id == viewer_id)
    )
    if row is None:
        raise _not_found("lecture") from None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    session.flush()
    session.commit()
    return CourseLectureOut(
        id=row.id,
        title=row.title,
        description=row.description,
        position=row.position,
        kind=row.kind,
        media_id=row.media_id,
        external_url=row.external_url,
        duration_seconds=row.duration_seconds,
        is_preview=row.is_preview,
        status=row.status,
    )


def delete_lecture(
    session: Session,
    *,
    viewer_id: uuid.UUID,
    course_id: uuid.UUID,
    section_id: uuid.UUID,
    lecture_id: uuid.UUID,
) -> None:
    """DELETE /courses/{id}/sections/{section_id}/lectures/{lecture_id} â€” delete a lecture (owner only)."""
    row = session.scalar(
        select(CourseLecture)
        .join(CourseSection, CourseLecture.section_id == CourseSection.id)
        .join(Course, CourseSection.course_id == Course.id)
        .where(CourseLecture.id == lecture_id, CourseLecture.section_id == section_id, CourseSection.course_id == course_id, Course.creator_id == viewer_id)
    )
    if row is None:
        raise _not_found("lecture") from None
    session.delete(row)
    session.flush()
    session.commit()


def publish_course(
    session: Session,
    *,
    viewer_id: uuid.UUID,
    course_id: uuid.UUID,
) -> CourseOut:
    """POST /courses/{id}/publish â€” publish a draft course (owner only)."""
    row = session.scalar(
        select(Course).where(Course.id == course_id, Course.creator_id == viewer_id)
    )
    if row is None:
        raise _not_found("course") from None
    if row.status is not CourseStatus.DRAFT:
        raise ApiError(
            status_code=409,
            code=ErrorCode.CONFLICT,
            message="Only a draft course can be published.",
        )
    from datetime import datetime as _dt, timezone as _tz
    row.status = CourseStatus.PUBLISHED
    row.published_at = _dt.now(tz=_tz.utc)
    session.flush()
    session.commit()
    return CourseOut.model_validate(_to_out(row))


def unpublish_course(
    session: Session,
    *,
    viewer_id: uuid.UUID,
    course_id: uuid.UUID,
) -> CourseOut:
    """POST /courses/{id}/unpublish â€” revert a published course to draft (owner only)."""
    row = session.scalar(
        select(Course).where(Course.id == course_id, Course.creator_id == viewer_id)
    )
    if row is None:
        raise _not_found("course") from None
    if row.status is not CourseStatus.PUBLISHED:
        raise ApiError(
            status_code=409,
            code=ErrorCode.CONFLICT,
            message="Only a published course can be unpublished.",
        )
    row.status = CourseStatus.DRAFT
    row.published_at = None
    session.flush()
    session.commit()
    return CourseOut.model_validate(_to_out(row))


def list_my_courses(
    session: Session,
    *,
    viewer_id: uuid.UUID,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> FastApiPage[MyCourseOut]:
    """GET /courses/mine â€” the caller's own courses (drafts and published)."""
    query = (
        select(Course)
        .where(Course.creator_id == viewer_id)
        .order_by(Course.created_at.desc(), Course.id.desc())
    )
    total = session.scalar(
        select(func.count()).select_from(query.order_by(None).subquery())
    )
    rows = (
        session.scalars(query.offset((page - 1) * page_size).limit(page_size)).all()
        if page_size
        else []
    )
    items = [
        _to_out_with_status(row) for row in rows
    ]
    return build_fastapi_page(items, int(total or 0), page, page_size)


def _to_out_with_status(course: Course) -> MyCourseOut:
    """Build MyCourseOut from a Course row, including status and visibility."""
    return MyCourseOut(
        id=course.id,
        title=course.title,
        slug=course.slug,
        description=course.description,
        category=course.category,
        skill_level=course.skill_level,
        language=course.language,
        estimated_duration_minutes=course.estimated_duration_minutes,
        is_free=course.is_free,
        price=_float_or_none(course.price),
        price_currency=course.price_currency,
        thumbnail_media_id=course.thumbnail_media_id,
        instructor=CourseInstructorOut(
            id=course.creator.id,
            name=course.creator.name,
            public_id=course.creator.public_id,
        ),
        created_at=course.created_at,
        published_at=course.published_at,
        status=course.status,
        visibility=course.visibility,
    )
