import sys
sys.path.insert(0, r'C:\mahaa\services\learn-service')

from app.schemas.courses import CourseOut, CourseCreate, CourseSectionOut, CourseLectureOut, CourseSearchFilters, FastApiCoursePaginated
from app.schemas.lectures import LectureProgressCreate, LectureProgressOut, LectureViewCreate, LectureViewOut, LectureLikeCreate, LectureLikeOut, LectureCommentCreate, LectureCommentOut, LectureCommentThreadOut, LectureEngagementFilters, LectureSaveCreate, LectureSaveOut
from app.schemas.media import MediaLimits, MediaRead, MediaUploadSessionCreate, MediaUploadSessionOut, MediaPartInfo, MediaStreamToken, MediaDeleteResponse
from app.schemas.saved import SavedItemOut, SavedItemCreate, SavedItemList
from app.schemas.upload import UploadSessionCreate, UploadSessionOut, UploadPartRequest, UploadPartResponse, UploadComplete, UploadStatusOut, UploadError
from app.schemas.errors import ErrorResponse, ValidationErrorResponse, NotFoundErrorResponse, UnauthorizedErrorResponse, ForbiddenErrorResponse, ConflictErrorResponse, PaginationMeta, ApiErrorEnvelope

print("All schemas import OK")

# Verify key classes
print(f"CourseOut: {CourseOut.model_fields.keys()}")
print(f"CourseCreate: {CourseCreate.model_fields.keys()}")
print(f"LectureProgressOut: {LectureProgressOut.model_fields.keys()}")
print(f"LectureCommentOut: {LectureCommentOut.model_fields.keys()}")
print(f"MediaRead: {MediaRead.model_fields.keys()}")
print(f"SavedItemOut: {SavedItemOut.model_fields.keys()}")
print(f"UploadSessionOut: {UploadSessionOut.model_fields.keys()}")
print(f"ErrorResponse: {ErrorResponse.model_fields.keys()}")
print(f"ApiErrorEnvelope: {ApiErrorEnvelope.model_fields.keys()}")

# Verify enums if any
print("\nAll schema verification PASSED")