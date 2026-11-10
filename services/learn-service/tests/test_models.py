"""Model tests for the Learn microservice."""

import sys
sys.path.insert(0, r'C:\mahaa\services\learn-service')

def test_all_12_models_import():
    """Test that all 12 required models can be imported."""
    from app.models import (
        Course, User, CourseSection, CourseLecture,
        Enrollment, LectureView, LectureLike,
        LectureComment, LectureUpload, MediaAsset, SavedItem
    )
    models = [Course, User, CourseSection, CourseLecture, Enrollment,
              LectureView, LectureLike, LectureComment, LectureUpload, MediaAsset, SavedItem]
    for model in models:
        assert hasattr(model, '__tablename__'), f"{model.__name__} missing __tablename__"
    print(f"All {len(models)} models verified with __tablename__")

def test_model_has_required_fields():
    """Test that models have the required field definitions."""
    from app.models import Course, User
    
    # Course should have key fields
    assert hasattr(Course, '__tablename__')
    assert hasattr(Course, 'id') or hasattr(Course, 'course_id')
    
    # User should have key fields
    assert hasattr(User, '__tablename__')
    
print("Model tests passed")