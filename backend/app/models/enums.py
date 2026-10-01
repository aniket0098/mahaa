"""Closed value sets the database enforces.

Each one is a PostgreSQL ``CHECK`` constraint backed by a Python enum, so an
invalid value is rejected by the database even if it arrives from a client the
schema layer never saw. The members are named after their database values, so
the stored text is exactly the value in the specification's ``CHECK in (...)``.

The mobile client already switches on these literals
(``src/types/profile.ts``, ``src/types/opportunity.ts``), so the values are a
contract and must not be renamed.
"""

from __future__ import annotations

from enum import StrEnum

from sqlalchemy import Enum as SAEnum


def pg_enum[E: StrEnum](enum_cls: type[E], constraint_name: str) -> SAEnum:
    """A ``VARCHAR`` column plus a real ``CHECK`` constraint.

    ``native_enum=False`` is deliberate. A native PostgreSQL ``ENUM`` type
    cannot be extended cheaply — adding a value means ``ALTER TYPE`` and a
    lock — whereas the specification's vocabularies are expected to grow. A
    ``VARCHAR`` with a ``CHECK`` gives identical database-level enforcement and
    a value is just a code change.

    ``create_constraint=True`` is explicit because SQLAlchemy 2.0 defaults it to
    ``False``, which would silently ship an unconstrained column. ``values_callable``
    makes the constraint list the *values* rather than the member names, so the
    database text matches the specification's ``CHECK in (...)`` exactly.
    """

    return SAEnum(
        enum_cls,
        name=constraint_name,
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
        values_callable=lambda members: [member.value for member in members],
    )


class UserRole(StrEnum):
    """``users.role``. ``admin`` exists but is never self-registerable."""

    CANDIDATE = "candidate"
    EMPLOYER = "employer"
    COLLEGE = "college"
    ADMIN = "admin"


class UserStatus(StrEnum):
    """``users.status``.

    ``deactivated`` is the mobile client's soft pause: signing in again
    reactivates the account. Nothing is deleted.
    """

    ACTIVE = "active"
    SUSPENDED = "suspended"
    DEACTIVATED = "deactivated"


class ProfileVisibility(StrEnum):
    """``profile_privacy.profile_visibility``."""

    PRIVATE = "private"
    EMPLOYERS = "employers"
    PUBLIC = "public"


class SkillLevel(StrEnum):
    """``user_skills.level``."""

    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"
    EXPERT = "expert"


class EducationLevel(StrEnum):
    """``education.level``."""

    SCHOOL = "school"
    DIPLOMA = "diploma"
    UNDERGRADUATE = "undergraduate"
    POSTGRADUATE = "postgraduate"
    DOCTORATE = "doctorate"
    OTHER = "other"


class WorkMode(StrEnum):
    """``experience.work_mode`` and ``profile_preferences.work_modes``."""

    REMOTE = "remote"
    HYBRID = "hybrid"
    ONSITE = "onsite"


class AchievementCategory(StrEnum):
    """``achievements.category``. Required on create in the mobile contract."""

    COMPETITION = "competition"
    AWARD = "award"
    ACADEMIC = "academic"
    HACKATHON = "hackathon"
    PUBLICATION = "publication"
    LEADERSHIP = "leadership"


class ConnectionStatus(StrEnum):
    """``connections.status`` — the four **stored** values (spec §14.5).

    The client's ``Connection['status']`` union has five members. The fifth,
    ``removed``, is deliberately absent: §6.1 calls it "a projection for a deleted
    connection, not necessarily a stored row", and a row that has been deleted
    cannot carry a status. Listing it here would put a value in the database CHECK
    that the state machine can never produce, and a ``?status=removed`` filter
    would then mean "rows that were deleted" — which is always the empty set.
    """

    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    CANCELED = "canceled"


class NotificationType(StrEnum):
    """``notifications.type`` — the V1 registry, exactly as §13.1 enumerates it.

    The specification lists eight types and marks each with the dependency that
    makes it producible. Four of those dependencies are unmet, so the four are
    **deliberately absent from this CHECK** rather than modelled and never
    emitted:

    * ``incoming_call`` / ``missed_call`` — "After §8". LiveKit is Phase 7 and
      the `calls` table does not exist.
    * ``post_interaction`` — "No"; §9 states likes and comments are not built.
    * ``opportunity`` — "After opportunity publishing exists"; it does not.

    An emitted-notification contract is a promise to the client that a given type
    can arrive. Listing a type here that no code path can ever produce would make
    the registry a list of lies, which is exactly what §13.1's closing sentence —
    "the others must not be modelled as if they were live" — forbids.

    **``message`` is present because §7 now exists.** §13.1 gates it on "After
    §7", and Phase 5 shipped messaging; §22 makes the dependency explicit by
    saying Phase 6 "depends on Phase 4 (its first producers) **and Phase 5**". The
    "honest V1 set is {connection_request, connection_accepted, system}" sentence
    was written while §7 was still unimplemented, and keeping `message` out would
    contradict §22 while stranding the one producer §22 names.

    The CHECK is what stops this drifting: a fifth type is not a code change here
    alone, it is a migration, which is the reviewable event a client contract
    deserves.
    """

    CONNECTION_REQUEST = "connection_request"
    CONNECTION_ACCEPTED = "connection_accepted"
    MESSAGE = "message"
    #: Always available — no domain dependency (§13.1). ``actor_id`` is null on
    #: one of these, which is the only way to reach §13.2's "not shown" state.
    SYSTEM = "system"


class MediaKind(StrEnum):
    """``media_assets.kind`` — §14.11's three values, and only those three.

    ``audio``, ``gif`` and ``archive`` are all absent on purpose. §11.5 scopes
    this phase to "Images: PNG/JPEG/WebP", "Video", and "Documents: PDF only",
    and the client's picker cannot produce the others. A kind the server cannot
    validate a MIME set for is a kind it would have to accept on trust, and §11.3
    is explicit that the client must not be trusted about content type.
    """

    IMAGE = "image"
    VIDEO = "video"
    DOCUMENT = "document"



class PostCategory(StrEnum):
    """``posts.category`` — §9.2's four values, in the client's order.

    A closed CHECK rather than free text: the feed renders one filter chip per
    value, so a fifth would render a chip with no filter behind it.
    """

    PROJECTS = "projects"
    ACHIEVEMENTS = "achievements"
    LEARNING = "learning"
    COMMUNITY = "community"


class PostKind(StrEnum):
    """``posts.kind`` — **derived**, never accepted from the client (§9.2).

    §9.2 is unambiguous: "kind is **derived server-side** from which payload is
    present, never accepted as a free string. The client sends it, and this
    vocabulary is the server's answer rather than a shape the client picks from.

    ``LEARNING`` is the one value that is not a payload. It exists because
    ``FeedPostKind`` in the client's ``feedModel.ts`` lists it and a learning post
    carrying nothing but prose would otherwise be indistinguishable from
    ``community`` prose. It is reachable (a learning post with no payload and no
    media) and unreachable otherwise — the same discipline §13.1 applied to
    notification types.
    """

    TEXT = "text"
    IMAGE = "image"
    VIDEO = "video"
    PROJECT = "project"
    ACHIEVEMENT = "achievement"
    LEARNING = "learning"


class StoryContentType(StrEnum):
    """``stories.content_type`` — §10.1's four values, exactly.

    A closed CHECK rather than free text: the client's story viewer renders one
    badge per value (``typeLabel`` in ``src/features/stories/demoStories.ts``), so a
    fifth would render a badge the server has no meaning for.

    The client's own comment records that "career information" is deliberately
    **not** here — a demo story carries that as a display-only string instead of
    widening this enum. Keeping the registry closed is what makes that possible.
    """

    JOB = "job"
    INTERNSHIP = "internship"
    ANNOUNCEMENT = "announcement"
    EVENT = "event"


class StoryPublisherKind(StrEnum):
    """``stories.publisher_kind`` — §10.1's ``{company, platform}``.

    §10.1 is explicit about why both exist: this is why the app is described as a
    *student* feed, because "stories are recruiter/platform-published, not peer
    content".

    §14.10 pairs this with ``CHECK (publisher_kind = 'company') =
    (company_id IS NOT NULL)`` — a company story must name its company. That
    constraint is **deferred to Phase 9**, because ``companies`` is not built yet;
    see ``models/stories.py`` for what Phase 8 holds in its place.
    """

    COMPANY = "company"
    PLATFORM = "platform"


class StoryStatus(StrEnum):
    """``stories.status`` — §10.1's ``{published, archived}``.

    A closed CHECK. ``ARCHIVED`` is how a story is withdrawn while its
    ``story_views`` history is kept: §10.2's retention job may delete the row
    later, but until then the archived story must be invisible, which is a filter
    on the list query rather than a third status value.
    """

    PUBLISHED = "published"
    ARCHIVED = "archived"


class CompanySize(StrEnum):
    """``companies.company_size`` — §14.9's 6-value CHECK.

    Closed, because the client's `CompanyCreate`/`CompanyUpdate` offer exactly these
    six and a seventh would render a filter with no rows behind it. The *values* are
    the ones the client sends (`'1000+'`, not `'1001'`), so the wire format and the
    stored value are the same string rather than a code the client has to translate.
    """

    S_1_10 = "1-10"
    S_11_50 = "11-50"
    S_51_200 = "51-200"
    S_201_500 = "201-500"
    S_501_1000 = "501-1000"
    S_1000_PLUS = "1000+"


class VerificationStatus(StrEnum):
    """``companies.verification_status`` — §14.9's 4-value CHECK.

    **Server-owned.** §12.2 says `verification_status` is "**server-owned**" and is
    absent from the update schema, so no client write can reach this column. The only
    transition V1 performs is ``unverified → pending`` via
    ``POST /companies/{id}/verification-request``; ``verified`` and ``rejected`` have
    no producer, because §23 records that no review process exists yet.

    They are still modelled, deliberately. §1015 is explicit that verification is
    "request-only in V1", and modelling the vocabulary keeps the client type
    (`VerificationStatus`) honest rather than leaving the server able to return a
    value the client cannot name.
    """

    UNVERIFIED = "unverified"
    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"


class CompanyStatus(StrEnum):
    """``companies.status`` — §14.9 names the column but not its vocabulary.

    §12.2 has no lifecycle prose for a company (unlike `stories`, where §10.1 spells
    out ``published``/``archived``), so this is the smallest set that can express the
    two states the rest of the system actually distinguishes: a company a member is
    administering, and one that has been retired. `inactive` is what makes the media
    reference guard meaningful — §14.11 needs to know whether a logo belongs to
    something a reader can still reach.
    """

    ACTIVE = "active"
    INACTIVE = "inactive"


class CompanyMemberRole(StrEnum):
    """``company_members.role`` — §14.9's 5 values.

    ``OWNER`` is in the vocabulary but **cannot be granted by an invite**: §12.2's
    first hard constraint is that "an invite can never mint an owner" and that
    `InvitableRole` excludes `owner`. The column must still be able to represent an
    owner, so the prohibition is a service-layer rule and not a table CHECK — exactly
    as §14.9 says.
    """

    OWNER = "owner"
    ADMIN = "admin"
    RECRUITER = "recruiter"
    HIRING_MANAGER = "hiring_manager"
    VIEWER = "viewer"


class CompanyMemberStatus(StrEnum):
    """``company_members.status`` — §14.9's 3 values.

    §12.2's invite flow creates the membership as ``INVITED`` and the invitee accepts
    it while signed in — "**No email is sent for an invite in V1**" — so `invited` is
    a real, reachable state and not a formality. `suspended` is reachable through
    ``PATCH /companies/{id}/members/{member_id}``.
    """

    INVITED = "invited"
    ACTIVE = "active"
    SUSPENDED = "suspended"


class OpportunityType(StrEnum):
    """``opportunities.opportunity_type`` — §14.9's 4-value CHECK.

    §14.9 names the count; `src/types/opportunity.ts` names the members, and they
    agree. The member names are the stored values, so no translation table exists to
    drift.
    """

    JOB = "job"
    INTERNSHIP = "internship"
    APPRENTICESHIP = "apprenticeship"
    PROJECT_GIG = "project_gig"


class OpportunityStatus(StrEnum):
    """``opportunities.status`` — §14.9 names the column; §14.10 indexes on it.

    ``draft`` is reachable only through the ORM in V1 because employer posting is
    [F] (§12.1), but it must exist: the index §14.10 names is
    ``(status, published_at DESC)``, and a feed that filters published rows needs a
    non-published state to exclude.
    """

    DRAFT = "draft"
    PUBLISHED = "published"
    CLOSED = "closed"


class OpportunityVisibility(StrEnum):
    """``opportunities.visibility`` — §14.9 names the column, not its vocabulary.

    ``public`` is the default because §12.1 makes the opportunity feed a member-
    visible read for candidates with no ACL ("read-only for candidates in V1"), and
    there is nothing in the specification that grants a per-opportunity audience. The
    second value exists so the column is a real discriminator rather than a constant.
    """

    PUBLIC = "public"
    UNLISTED = "unlisted"


class EmploymentType(StrEnum):
    """``opportunities.employment_type`` — §14.9's 4-value CHECK, nullable.

    Nullable in the database **and** in the client type (`EmploymentType | null`),
    which §12.1 calls out: making it non-nullable would break the client type.
    """

    FULL_TIME = "full_time"
    PART_TIME = "part_time"
    INTERNSHIP = "internship"
    CONTRACT = "contract"


class CompPeriod(StrEnum):
    """``opportunities.comp_period`` — §14.9's CHECK (hour, month, year).

    Null whenever the compensation is null, so a row with no comp figures does not
    have to invent a period. `src/types/opportunity.ts` has the same three values.
    """

    HOUR = "hour"
    MONTH = "month"
    YEAR = "year"


class RequirementKind(StrEnum):
    """``opportunity_requirements.kind`` — §14.9's CHECK (required, preferred)."""

    REQUIRED = "required"
    PREFERRED = "preferred"
