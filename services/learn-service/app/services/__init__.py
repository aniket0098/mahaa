"""Service layer for the Learn microservice.

Contains business logic for lectures, media, uploads, and engagement
operations. Each module handles database operations and enforces
ownership/authorization rules. Only modules that exist on disk are imported
here so the package never raises ``ImportError`` on a missing feature stage.
"""

from app.services import lectures as lectures_svc
from app.services import media as media_svc
from app.services import upload as upload_svc
from app.services import lecture_engagement as lecture_engagement_svc

__all__ = [
    "lectures_svc",
    "media_svc",
    "upload_svc",
    "lecture_engagement_svc",
]