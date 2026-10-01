from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UUIDPrimaryKeyMixin
from app.models.enums import (
    CompanyMemberRole,
    CompanyMemberStatus,
    CompanySize,
    CompanyStatus,
    CompPeriod,
    EmploymentType,
    OpportunityStatus,
    OpportunityType,
    OpportunityVisibility,
    RequirementKind,
    VerificationStatus,
    WorkMode,
    pg_enum,
)


class Company(UUIDPrimaryKeyMixin, Base):
    """A company workspace — §14.9.

    **There is no ``owner_id`` column here**, and that is not an oversight: ownership
    lives in ``company_members`` as a row with ``role='owner'``, which is what lets a
    company have an owner *and* admins, recruiters and viewers (§12.2's membership
    model). §14.9 gives ``institutions`` an ``owner_id`` because §12.3 makes every
    institution route ownership-scoped to one contact person; companies are
    membership-scoped, and conflating the two would have made a company un-invitable.

    **``slug`` is server-generated and immutable**, per §12.2: it is absent from the
    update schema and "server-owned". A client that could rewrite its own slug could
    break a link somebody had already shared, so no route reaches the column.

    **``logo_media_id`` is RESTRICT** — §14.11's reference check, the same rule as
    ``post_media.media_id`` and ``stories.media_id``: an asset a reachable company
    shows must not be deletable out from under it.
    """

    __tablename__ = "companies"
    __table_args__ = (
        # §14.9's 6-value CHECK; nullable because the client sends it optionally.
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        Index("ix_companies_status", "status"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    #: Server-generated and never writable. See the class docstring.
    slug: Mapped[str] = mapped_column(String(220), nullable=False, unique=True)
    website: Mapped[str | None] = mapped_column(String(500), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(120), nullable=True)
    company_size: Mapped[CompanySize | None] = mapped_column(
        pg_enum(CompanySize, "company_size"), nullable=True
    )
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: §14.9: FK media_assets, NULL. See the class docstring for RESTRICT.
    logo_media_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="RESTRICT"), nullable=True
    )
    #: §12.2: server-owned, absent from every write schema.
    verification_status: Mapped[VerificationStatus] = mapped_column(
        pg_enum(VerificationStatus, "verification_status"),
        nullable=False,
        server_default=VerificationStatus.UNVERIFIED.value,
    )
    status: Mapped[CompanyStatus] = mapped_column(
        pg_enum(CompanyStatus, "company_status"),
        nullable=False,
        server_default=CompanyStatus.ACTIVE.value,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    members: Mapped[list["CompanyMember"]] = relationship(
        back_populates="company", cascade="all, delete-orphan"
    )
    logo: Mapped["MediaAsset | None"] = relationship(  # noqa: F821
        foreign_keys=[logo_media_id], lazy="joined"
    )
    opportunities: Mapped[list["Opportunity"]] = relationship(back_populates="company")


class CompanyMember(UUIDPrimaryKeyMixin, Base):
    """One person's membership of one company — §14.9.

    **The unique ``(company_id, user_id)`` makes an invite a conflict the database can
    name**, rather than a duplicate row that would make "which role am I?" ambiguous
    when somebody is invited twice.

    **The partial unique index guarantees at most one owner per company** — §14.9 asks
    for it explicitly. It is partial (``WHERE role = 'owner'``) because a plain unique
    on ``company_id`` would permit exactly one member *of any kind*, which is not what
    "one owner" means: a company with three recruiters must be representable.

    **An invite cannot mint an owner, and that is a service rule, not a CHECK** —
    §14.9 says so directly: "the table must still be able to *represent* an owner, so
    the prohibition is not a table CHECK." A CHECK would also be wrong because
    *promoting* an existing member to owner is legitimate; only the invite path is
    restricted, and only the service can see which path a write came from.
    """

    __tablename__ = "company_members"
    __table_args__ = (
        # §14.9's unique (company_id, user_id).
        UniqueConstraint("company_id", "user_id", name="uq_company_members_pair"),
        # §14.9's partial unique index: at most one owner per company.
        Index(
            "uq_company_members_one_owner",
            "company_id",
            unique=True,
            postgresql_where=text("role = 'owner'"),
        ),
        # "My companies", resolved from the token on every `/companies/mine` call.
        Index("ix_company_members_user_id_status", "user_id", "status"),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[CompanyMemberRole] = mapped_column(
        pg_enum(CompanyMemberRole, "company_member_role"), nullable=False
    )
    status: Mapped[CompanyMemberStatus] = mapped_column(
        pg_enum(CompanyMemberStatus, "company_member_status"),
        nullable=False,
        server_default=CompanyMemberStatus.INVITED.value,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    company: Mapped[Company] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(lazy="joined")  # noqa: F821


class Opportunity(UUIDPrimaryKeyMixin, Base):
    """One job/internship posting — §14.9.

    **Read-only for candidates in V1** (§12.1): the write routes are [F], because
    "employer job posting is an honest notice". The table and the two [M] reads exist;
    rows arrive from the career pipeline rather than from this API. That is why
    ``status`` carries a ``draft`` member no route can set — see its enum.

    **``company_id`` is RESTRICT, not CASCADE.** A posting must stay explainable even
    if the employer workspace goes away, and §14.9 says RESTRICT. CASCADE would silently
    delete live postings because somebody removed a workspace row.

    **``slug`` is server-generated and unique**, like ``companies.slug``: it is the
    shareable handle and no client may rewrite it.

    **Compensation is three columns plus a period, all nullable.** §12.1 warns that
    ``comp_min``/``comp_max`` are `number | null` on the client and that making them
    non-nullable "would break the client type", so every one stays nullable here. A
    CHECK keeps the range honest rather than leaving an inverted pair to be found by a
    reader.

    **The index is ``(status, published_at DESC)``** — §14.10's, and the one the feed
    uses: "published, newest first" is exactly that predicate plus this ordering.
    ``(company_id)`` backs the company→jobs direction and the FK.
    """

    __tablename__ = "opportunities"
    __table_args__ = (
        Index(
            "ix_opportunities_status_published_at",
            "status",
            text("published_at DESC"),
        ),
        Index("ix_opportunities_company_id", "company_id"),
        CheckConstraint("btrim(title) <> ''", name="title_not_blank"),
        CheckConstraint(
            "comp_min IS NULL OR comp_max IS NULL OR comp_max >= comp_min",
            name="comp_range_ordered",
        ),
        CheckConstraint(
            "comp_min IS NULL OR comp_min >= 0", name="comp_min_not_negative"
        ),
    )

    #: §14.9: FK companies **RESTRICT**.
    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(250), nullable=False)
    slug: Mapped[str] = mapped_column(String(280), nullable=False, unique=True)
    opportunity_type: Mapped[OpportunityType] = mapped_column(
        pg_enum(OpportunityType, "opportunity_type"), nullable=False
    )
    status: Mapped[OpportunityStatus] = mapped_column(
        pg_enum(OpportunityStatus, "opportunity_status"),
        nullable=False,
        server_default=OpportunityStatus.DRAFT.value,
    )
    visibility: Mapped[OpportunityVisibility] = mapped_column(
        pg_enum(OpportunityVisibility, "opportunity_visibility"),
        nullable=False,
        server_default=OpportunityVisibility.PUBLIC.value,
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsibilities: Mapped[str | None] = mapped_column(Text, nullable=True)
    requirements_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: §14.9's 3-value CHECK, reusing the existing `WorkMode` rather than declaring a
    #: second identical vocabulary — the client has one `WorkMode` type shared by both
    #: the profile and the posting.
    work_mode: Mapped[WorkMode | None] = mapped_column(
        pg_enum(WorkMode, "opportunity_work_mode"), nullable=True
    )
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    employment_type: Mapped[EmploymentType | None] = mapped_column(
        pg_enum(EmploymentType, "employment_type"), nullable=True
    )
    comp_min: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    comp_max: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    comp_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    comp_period: Mapped[CompPeriod | None] = mapped_column(
        pg_enum(CompPeriod, "comp_period"), nullable=True
    )
    openings: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    company: Mapped[Company] = relationship(back_populates="opportunities")
    requirements: Mapped[list["OpportunityRequirement"]] = relationship(
        back_populates="opportunity", cascade="all, delete-orphan"
    )


class OpportunityRequirement(UUIDPrimaryKeyMixin, Base):
    """One skill an opportunity asks for — §14.9.

    **A table and not a ``text[]``**, and §14.9 says why in one sentence:
    "`OpportunityRequirement` carries a skill **name** and a `kind`, which a `text[]`
    cannot". The row also stores ``skill_id``, so the requirement resolves against the
    real catalogue rather than a copy of a name that could later be renamed — which is
    exactly why `src/types/opportunity.ts` has both `skill_id` and `skill_name`.

    **``skill_id`` is RESTRICT.** A catalogue skill a live posting names cannot be
    deleted out from under it, the same rule ``post_media.media_id`` follows.

    **No unique constraint on ``(opportunity_id, skill_id)``** — §14.9 does not name
    one, and a posting may legitimately ask for the same skill twice under different
    ``kind`` values. The service de-duplicates identical rows on write instead of
    letting a duplicate become a constraint error.
    """

    __tablename__ = "opportunity_requirements"
    __table_args__ = (
        Index("ix_opportunity_requirements_opportunity_id", "opportunity_id"),
    )

    #: §14.9: FK opportunities CASCADE — a requirement has no meaning without the
    #: posting it describes, unlike a skill reference which outlives the posting.
    opportunity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False
    )
    #: §14.9: FK skills RESTRICT.
    skill_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("skills.id", ondelete="RESTRICT"), nullable=False
    )
    kind: Mapped[RequirementKind] = mapped_column(
        pg_enum(RequirementKind, "requirement_kind"), nullable=False
    )
    #: Free text, not a `SkillLevel` CHECK: §14.9 says "``min_level`` text NULL", and
    #: the client type is ``string | null`` rather than the skill-level enum.
    min_level: Mapped[str | None] = mapped_column(String(50), nullable=True)
    importance: Mapped[str] = mapped_column(String(50), nullable=False)

    opportunity: Mapped[Opportunity] = relationship(back_populates="requirements")
    skill: Mapped["Skill"] = relationship(lazy="joined")  # noqa: F821
