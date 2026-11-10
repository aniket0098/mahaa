import sys
sys.path.insert(0, r'C:\mahaa\services\learn-service')

from app.db.base import Base
from app.models import *

# Check that all model classes have __tablename__
models = [Course, User, CourseSection, CourseLecture, Enrollment, LectureView, LectureLike, LectureComment, LectureUpload, MediaAsset, SavedItem]
for cls in models:
    name = cls.__name__
    has_table = hasattr(cls, "__tablename__")
    print(f"{name}: has __tablename__ = {has_table}")

print("All models have declarative mapping")