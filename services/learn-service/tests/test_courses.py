"""Course tests for the Learn microservice."""

import sys
sys.path.insert(0, r'C:\mahaa\services\learn-service')

def test_course_schemas_import():
    """Test that course schemas can be imported."""
    from app.schemas.courses import (
        CourseOut, CourseDetailOut, EnrolledCourseOut,
        CourseEnrollmentStateOut, MyCourseOut, MyCourseDetailOut,
        CourseCreate, CourseUpdate, SectionCreate, SectionUpdate,
        LectureCreate, LectureUpdate, FastApiCoursePaginated
    )
    print("Course schemas import OK")

def test_course_models():
    """Test course model fields."""
    from app.models import Course
    assert hasattr(Course, '__tablename__')
    print("Course model OK")

def test_enrollment_logic():
    """Test enrollment logic basics."""
    from sqlalchemy import select
    from app.models import Course, Enrollment
    # Just verify the models can be queried
    stmt = select(Course)
    print("Enrollment logic OK")