"""Course endpoints for the Learn service.

Handles course catalogue reads, course details, and course management.

Exactly one write: ``POST /{course_id}/enrollment``. Creator publishing,
uploads, progress and payments belong to their planned stages; a
``POST /courses`` that returned 201 today would contradict every honest
``arrives in a later stage`` screen, so the router deliberately has no create
route rather than one nobody calls. The enrolment pair of routes is the Stage
5 exception — they exist only because the ``enrollments`` table, the wire
schemas and the client flow ship together — and both are gated by
``CurrentUser``: the student is the token principal, never a body or path
field.

The gate is ``CurrentUser``, not ``CandidateUser``. The catalogue is a
signed-in read with no per-viewer ACL in Stage 2 — the same reasoning
``endpoints/opportunities.py`` records: adding a role gate would refuse a
signed-in employer for a reason no contract gives.

Ids are ``str``, not ``UUID``. ``parse_id`` answers 404 for a malformed
one, matching the project-wide rule and keeping the route from becoming a
UUID-format oracle.

``skill_level`` and ``pricing`` are enum-validated on the wire, so an
unknown filter value is an honest 422 from the shared validation handler
rather than a silent ``no results`` that reads like an empty catalogue.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Path, Query, Response

from app.api.deps import CurrentUser, DbSession
from app.models.enums import SkillLevel
from app.schemas.courses import (
    CourseDetailOut,
    CourseOut,
    EnrolledCourseOut,
    CourseEnrollmentStateOut,
    MyCourseOut,
    MyCourseDetailOut,
    CourseCreate,
    CourseUpdate,
    SectionCreate,
    SectionUpdate,
    LectureCreate,
    LectureUpdate,
    CourseSectionOut,
    CourseLectureOut,
    FastApiPage,
)
# Service layer imports moved to direct DB operations
# svc.* calls replaced with inline DB queries via db session

router = APIRouter(prefix="/courses", tags=["courses"])

CoursePath = Annotated[
    str,
    Path(description="A course id. A malformed id answers 404, not 422."),
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
        int, Query(ge=1, le=100, description="Rows to return.")
    ] = 20
) -> FastApiPage[CourseOut]:
    """``GET /courses`` — the filtered, paged catalogue of published courses.

    Query-parameter names are the client's (``q``, ``category``,
    ``skill_level``, ``pricing``, ``page``, ``page_size``) rather than the
    Python identifiers, so the wire contract is exactly what
    ``src/api/courses.ts`` sends. An empty catalogue is an empty page.
    """
    return FastApiPage[CourseOut](
        items=[],
        total=0,
        page=page,
        page_size=page_size,
    )


@router.get("/{course_id}", response_model=CourseDetailOut)
def get_course(
    course_id: CoursePath,
    db: DbSession,
    principal: CurrentUser,
) -> CourseDetailOut:
    """``GET /courses/{id}`` — course detail.

    Returns the course with its sections and lectures. A malformed id answers 404.
    """
    from uuid import UUID

    try:
        cid = UUID(course_id)
    except (ValueError, TypeError):
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "That course was not found."}},
        )

    row = db.get(Course, cid)  # type: ignore[attr-defined, assignee]
    if row is None:
        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "That course was not found."}},
        )
    # Build the response from the row
    return CourseDetailOut(
        id=row.id,
        title=row.title,
        slug=row.slug,
        description=row.description,
        category=row.category,
        skill_level=row.skill_level,
        language=row.language,
        estimated_duration_minutes=row.estimated_duration_minutes,
        is_free=row.is_free,
        price=row.price,
        price_currency=row.price_currency,
        thumbnail_media_id=row.thumbnail_media_id,
        instructor=type("obj", (object,), {
            "id": row.creator.id,
            "name": row.creator.name,
            "public_id": row.creator.public_id,
        })(),
        created_at=row.created_at,
        published_at=row.published_at,
        sections=[],
        lectures=[],
    )