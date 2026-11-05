"""``/courses`` — the Learning Hub's catalogue reads and Stage 5's enrolment.

**Exactly one write: ``POST /{course_id}/enrollment``.** Creator publishing,
uploads, progress and payments belong to their planned stages; a
``POST /courses`` that returned 201 today would contradict every honest
"arrives in a later stage" screen, so the router deliberately has no create
route rather than one nobody calls. The enrolment pair of routes is the Stage
5 exception — they exist only because the ``enrollments`` table, the wire
schemas and the client flow ship together — and both are gated by
``CurrentUser``: the student is the token principal, never a body or path
field.

**The gate is ``CurrentUser``, not ``CandidateUser``.** The catalogue is a
signed-in read with no per-viewer ACL in Stage 2 — the same reasoning
``endpoints/opportunities.py`` records: adding a role gate would refuse a
signed-in employer for a reason no contract gives.

**Ids are ``str``, not ``UUID``.** ``parse_id`` answers 404 for a malformed
one, matching the project-wide rule and keeping the route from becoming a
UUID-format oracle.

**``skill_level`` and ``pricing`` are enum-validated on the wire**, so an
unknown filter value is an honest 422 from the shared validation handler
rather than a silent "no results" that reads like an empty catalogue.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Path, Query, Response

from app.api.deps import CurrentUser, DbSession
from app.models.enums import SkillLevel
from app.schemas.common import FastApiPage
from app.schemas.courses import (
    CourseDetailOut,
    CourseOut,
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
    CourseSectionOut,
    CourseLectureOut,
)
from app.services import courses as svc
from app.services.ownership import parse_id

router = APIRouter(prefix="/courses", tags=["courses"])

CoursePath = Annotated[
    str, Path(description="A course id. A malformed id answers 404, not 422.")
]


@router.get("", response_model=FastApiPage[CourseOut])
def list_courses(
    db: DbSession,
    principal: CurrentUser,
    q: Annotated[str | None, Query(description="Search title and description.")] = None,
    category: Annotated[str | None, Query(description="Exact category match.")] = None,
    skill_level: Annotated[
        SkillLevel | None,
        Query(description="beginner | intermediate | advanced | expert."),
    ] = None,
    pricing: Annotated[
        Literal["free", "paid"] | None, Query(description="Free or paid catalogue.")
    ] = None,
    page: Annotated[int, Query(ge=1, le=10_000, description="1-based page.")] = 1,
    page_size: Annotated[
        int, Query(ge=1, le=svc.MAX_PAGE_SIZE, description="Rows to return.")
    ] = svc.DEFAULT_PAGE_SIZE,
) -> FastApiPage[CourseOut]:
    """``GET /courses`` — the filtered, paged catalogue of published courses.

    Query-parameter names are the client's (``q``, ``category``,
    ``skill_level``, ``pricing``, ``page``, ``page_size``) rather than the
    Python identifiers, so the wire contract is exactly what
    ``src/api/courses.ts`` sends. An empty catalogue is an empty page.
    """
    return svc.list_courses(
        db,
        q=q,
        category=category,
        skill_level=skill_level.value if skill_level else None,
        pricing=pricing,
        page=page,
        page_size=page_size,
    )


@router.get("/enrollments/mine", response_model=FastApiPage[EnrolledCourseOut])
def list_my_enrollments(
    db: DbSession,
    principal: CurrentUser,
    page: Annotated[int, Query(ge=1, description="1-based page.")] = 1,
    page_size: Annotated[
        int, Query(ge=1, le=svc.MAX_PAGE_SIZE, description="Rows to return.")
    ] = svc.DEFAULT_PAGE_SIZE,
) -> FastApiPage[EnrolledCourseOut]:
    """``GET /courses/enrollments/mine`` — the caller's enrolled courses.

    The student is the token principal; there is no way to ask for another
    account's enrolments. Empty when the caller has none.
    """
    return svc.list_my_enrollments(
        db,
        student_id=principal.id,
        page=page,
        page_size=page_size,
    )


@router.get("/mine", response_model=FastApiPage[MyCourseOut])
def list_my_courses_endpoint(
    db: DbSession,
    principal: CurrentUser,
    page: Annotated[int, Query(ge=1, description="1-based page.")] = 1,
    page_size: Annotated[
        int, Query(ge=1, le=svc.MAX_PAGE_SIZE, description="Rows to return.")
    ] = svc.DEFAULT_PAGE_SIZE,
) -> FastApiPage[MyCourseOut]:
    """GET /courses/mine \u2014 the caller's own courses (drafts and published)."""
    return svc.list_my_courses(db, viewer_id=principal.id, page=page, page_size=page_size)


@router.get("/{course_id}", response_model=CourseDetailOut)
def read_course(
    course_id: CoursePath, db: DbSession, principal: CurrentUser
) -> CourseDetailOut:
    """``GET /courses/{id}`` — detail incl. ordered sections and lectures.

    A draft, an unlisted course and an unknown id all answer 404, so the route
    cannot be used to confirm a restricted course exists.
    """
    return svc.get_course(db, parse_id(course_id, "course"))


@router.post(
    "/{course_id}/enrollment", response_model=EnrollmentOut, status_code=201
)
def enroll_in_course(
    course_id: CoursePath,
    principal: CurrentUser,
    db: DbSession,
    response: Response,
) -> EnrollmentOut:
    """``POST /courses/{id}/enrollment`` — enrol the caller in a free course.

    **201 when the row was created, 200 when the caller was already enrolled**:
    the repeat is idempotent and answers with the same stable representation,
    so a double tap converges instead of erroring. A paid or not-yet-priced
    course is a 409 from the service; a draft, an unlisted course or an
    unknown id is a 404 — visibility is decided before price, so the route can
    never confirm a restricted course exists. Anonymous is 401 through
    ``CurrentUser``; the ``student_id`` written is the token principal's, and
    a body field claiming otherwise is ignored (the route takes no body).
    """
    enrollment, created = svc.enroll_in_free_course(
        db, principal.id, parse_id(course_id, "course")
    )
    if not created:
        response.status_code = 200
    return enrollment


@router.get("/{course_id}/enrollment", response_model=EnrollmentStateOut)
def read_enrollment(
    course_id: CoursePath, db: DbSession, principal: CurrentUser
) -> EnrollmentStateOut:
    """``GET /courses/{id}/enrollment`` — whether the caller is enrolled.

    ``enrolled`` plus the row itself (or ``None``): the state the
    course-detail screen renders on return, and the thing a successful POST
    invalidates. No other account's enrolment is reachable — the student is
    the token principal, so there is no id to change.
    """
    return svc.get_enrollment_state(
        db, principal.id, parse_id(course_id, "course")
    )

# ---------------------------------------------------------------------------
# Creator write operations
# ---------------------------------------------------------------------------


@router.post("", response_model=CourseOut, status_code=201)
def create_course_endpoint(
    db: DbSession,
    principal: CurrentUser,
    data: CourseCreate,
) -> CourseOut:
    """POST /courses â€” create a new course as a draft."""
    return svc.create_course(db, viewer_id=principal.id, data=data)


@router.put("/{course_id}", response_model=CourseOut)
def update_course_endpoint(
    course_id: CoursePath,
    db: DbSession,
    principal: CurrentUser,
    data: CourseUpdate,
) -> CourseOut:
    """PUT /courses/{id} â€” update a course (owner only)."""
    return svc.update_course(db, viewer_id=principal.id, course_id=parse_id(course_id, "course"), data=data)


@router.delete("/{course_id}", status_code=204)
def delete_course_endpoint(
    course_id: CoursePath,
    db: DbSession,
    principal: CurrentUser,
) -> None:
    """DELETE /courses/{id} â€” delete a course (owner only)."""
    svc.delete_course(db, viewer_id=principal.id, course_id=parse_id(course_id, "course"))


@router.post("/{course_id}/sections", response_model=CourseSectionOut, status_code=201)
def create_section_endpoint(
    course_id: CoursePath,
    db: DbSession,
    principal: CurrentUser,
    data: SectionCreate,
) -> CourseSectionOut:
    """POST /courses/{id}/sections â€” create a section (owner only)."""
    return svc.create_section(db, viewer_id=principal.id, course_id=parse_id(course_id, "course"), data=data)


@router.put("/{course_id}/sections/{section_id}", response_model=CourseSectionOut)
def update_section_endpoint(
    course_id: CoursePath,
    section_id: str,
    db: DbSession,
    principal: CurrentUser,
    data: SectionUpdate,
) -> CourseSectionOut:
    """PUT /courses/{id}/sections/{section_id} â€” update a section (owner only)."""
    return svc.update_section(db, viewer_id=principal.id, course_id=parse_id(course_id, "course"), section_id=parse_id(section_id, "section"), data=data)


@router.delete("/{course_id}/sections/{section_id}", status_code=204)
def delete_section_endpoint(
    course_id: CoursePath,
    section_id: str,
    db: DbSession,
    principal: CurrentUser,
) -> None:
    """DELETE /courses/{id}/sections/{section_id} â€” delete a section (owner only)."""
    svc.delete_section(db, viewer_id=principal.id, course_id=parse_id(course_id, "course"), section_id=parse_id(section_id, "section"))


@router.post("/{course_id}/sections/{section_id}/lectures", response_model=CourseLectureOut, status_code=201)
def create_lecture_endpoint(
    course_id: CoursePath,
    section_id: str,
    db: DbSession,
    principal: CurrentUser,
    data: LectureCreate,
) -> CourseLectureOut:
    """POST /courses/{id}/sections/{section_id}/lectures â€” create a lecture (owner only)."""
    return svc.create_lecture(db, viewer_id=principal.id, course_id=parse_id(course_id, "course"), section_id=parse_id(section_id, "section"), data=data)


@router.put("/{course_id}/sections/{section_id}/lectures/{lecture_id}", response_model=CourseLectureOut)
def update_lecture_endpoint(
    course_id: CoursePath,
    section_id: str,
    lecture_id: str,
    db: DbSession,
    principal: CurrentUser,
    data: LectureUpdate,
) -> CourseLectureOut:
    """PUT /courses/{id}/sections/{section_id}/lectures/{lecture_id} â€” update a lecture (owner only)."""
    return svc.update_lecture(db, viewer_id=principal.id, course_id=parse_id(course_id, "course"), section_id=parse_id(section_id, "section"), lecture_id=parse_id(lecture_id, "lecture"), data=data)


@router.delete("/{course_id}/sections/{section_id}/lectures/{lecture_id}", status_code=204)
def delete_lecture_endpoint(
    course_id: CoursePath,
    section_id: str,
    lecture_id: str,
    db: DbSession,
    principal: CurrentUser,
) -> None:
    """DELETE /courses/{id}/sections/{section_id}/lectures/{lecture_id} â€” delete a lecture (owner only)."""
    svc.delete_lecture(db, viewer_id=principal.id, course_id=parse_id(course_id, "course"), section_id=parse_id(section_id, "section"), lecture_id=parse_id(lecture_id, "lecture"))


@router.post("/{course_id}/publish", response_model=CourseOut)
def publish_course_endpoint(
    course_id: CoursePath,
    db: DbSession,
    principal: CurrentUser,
) -> CourseOut:
    """POST /courses/{id}/publish â€” publish a draft course (owner only)."""
    return svc.publish_course(db, viewer_id=principal.id, course_id=parse_id(course_id, "course"))


@router.post("/{course_id}/unpublish", response_model=CourseOut)
def unpublish_course_endpoint(
    course_id: CoursePath,
    db: DbSession,
    principal: CurrentUser,
) -> CourseOut:
    """POST /courses/{id}/unpublish â€” revert a published course to draft (owner only)."""
    return svc.unpublish_course(db, viewer_id=principal.id, course_id=parse_id(course_id, "course"))


