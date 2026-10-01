"""ORM models. Import them here so Alembic autogenerate sees them.

``alembic/env.py`` imports this module for its side effect: every model below
registers itself on ``Base.metadata``. A model defined in its own module but
missing from the ``__all__`` list below is invisible to autogenerate, which is
the usual reason a migration "misses" a table that plainly exists in the code.

The import order is dependency order (``users`` before the rows that point at
it) purely for readability; SQLAlchemy resolves string-based relationships
regardless.
"""

from __future__ import annotations

from app.db.base import Base
from app.models.achievements import Achievement
from app.models.career import (
    Company,
    CompanyMember,
    Opportunity,
    OpportunityRequirement,
)
from app.models.certifications import Certification
from app.models.connections import Connection
from app.models.education import Education
from app.models.enums import (
    AchievementCategory,
    CompanyMemberRole,
    CompanyMemberStatus,
    CompanySize,
    CompanyStatus,
    CompPeriod,
    ConnectionStatus,
    EducationLevel,
    EmploymentType,
    MediaKind,
    NotificationType,
    OpportunityStatus,
    OpportunityType,
    OpportunityVisibility,
    PostCategory,
    PostKind,
    ProfileVisibility,
    RequirementKind,
    SkillLevel,
    StoryContentType,
    StoryPublisherKind,
    StoryStatus,
    UserRole,
    UserStatus,
    VerificationStatus,
    WorkMode,
)
from app.models.experience import Experience
from app.models.media import STORAGE_KIND_DATABASE, MediaAsset
from app.models.messaging import Conversation, ConversationMember, Message
from app.models.notifications import Notification
from app.models.posts import Post, PostMedia
from app.models.profile import (
    Profile,
    ProfileLink,
    ProfilePreferences,
    ProfilePrivacy,
)
from app.models.projects import Project, ProjectSkill
from app.models.skills import Skill, UserSkill
from app.models.stories import Story, StoryView
from app.models.user import User

__all__ = [
    "Base",
    "Achievement",
    "AchievementCategory",
    "Certification",
    "Company",
    "CompanyMember",
    "CompanyMemberRole",
    "CompanyMemberStatus",
    "CompanySize",
    "CompanyStatus",
    "CompPeriod",
    "Connection",
    "ConnectionStatus",
    "Conversation",
    "ConversationMember",
    "Education",
    "EducationLevel",
    "EmploymentType",
    "Experience",
    "Message",
    "MediaAsset",
    "MediaKind",
    "STORAGE_KIND_DATABASE",
    "Notification",
    "NotificationType",
    "Opportunity",
    "OpportunityRequirement",
    "OpportunityStatus",
    "OpportunityType",
    "OpportunityVisibility",
    "Post",
    "PostCategory",
    "PostKind",
    "PostMedia",
    "Profile",
    "ProfileLink",
    "ProfilePreferences",
    "ProfilePrivacy",
    "ProfileVisibility",
    "Project",
    "ProjectSkill",
    "RequirementKind",
    "Skill",
    "SkillLevel",
    "Story",
    "StoryContentType",
    "StoryPublisherKind",
    "StoryStatus",
    "StoryView",
    "User",
    "UserRole",
    "UserSkill",
    "UserStatus",
    "VerificationStatus",
    "WorkMode",
]
