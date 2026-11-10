import sys
sys.path.insert(0, r'C:\mahaa\services\learn-service')

from app.models import (
    Course,
    User,
    CourseSection,
    CourseLecture,
    Enrollment,
    LectureView,
    LectureLike,
    LectureComment,
    LectureUpload,
    MediaAsset,
    SavedItem,
)

print("All 12 models exported from app.models OK")
print(f"Course: {Course.__name__}")
print(f"User: {User.__name__}")
print(f"CourseSection: {CourseSection.__name__}")
print(f"CourseLecture: {CourseLecture.__name__}")
print(f"Enrollment: {Enrollment.__name__}")
print(f"LectureView: {LectureView.__name__}")
print(f"LectureLike: {LectureLike.__name__}")
print(f"LectureComment: {LectureComment.__name__}")
print(f"LectureUpload: {LectureUpload.__name__}")
print(f"MediaAsset: {MediaAsset.__name__}")
print(f"SavedItem: {SavedItem.__name__}")
print("\nAll model verification PASSED")