"""Wire schemas for ``/institutions`` â€” Â§12.3, field for field with the client.

**Every field here is one ``src/types/onboarding.ts`` parses.** That file declares
``Institution``, ``MyInstitutionSummary``, ``Program`` and a shared
``VerificationRequestResponse``, and the college screens render every one of them, so a
renamed or extra field is a contract break rather than a preference.

**``owner_id`` is on the wire, and that is not a privacy leak.** It is the *caller's
own* id on every route, because Â§12.3 makes every route ownership-scoped: there is no
route that returns somebody else's institution, so ``owner_id`` can only ever be the
person reading the response.

**``industry`` and ``company_size`` are deliberately absent.** Â§14.9 defines the table
as "as ``companies``", so both **columns exist** â€” the migration creates them â€” but
neither appears in the client's ``Institution`` type and neither is writable through
any Â§12.3 route. Sending them would be inventing a field the client does not parse.
They are storage, not contract.

**``logo_url`` is derived, not stored.** It is Â§14.11's relative ``served_at`` path for
the asset ``logo_media_id`` points at, so the service resolves it and the client joins
it onto its configured base URL. Never absolute.

**``VerificationRequestResponse`` is imported from ``schemas.companies``, not
redeclared.** The mobile type is shared between the two domains, and Â§12.2 and Â§12.3
describe the identical request-only flow, so one schema serves both. A second copy
would be free to drift from the first.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import InstitutionStatus, VerificationStatus

#: Identical ceilings to ``schemas.companies``: Â§14.9 defines ``institutions`` as "as
#: ``companies``", so the columns carry the same widths. ``InstitutionStep.tsx``
#: enforces smaller client-side maxima (NAME_MAX=200, WEBSITE_MAX=300,
#: LOCATION_MAX=160, DESCRIPTION_MAX=4000); being more permissive than the client is
#: safe, being narrower would reject input the app itself is willing to send.
MAX_NAME_CHARS = 200
MAX_DESCRIPTION_CHARS = 5000

#: Â§14.9 gives ``programs.name`` no length, only ``text NOT NULL``. These bounds exist
#: so a stray multi-megabyte string cannot be written through an unbounded column.
MAX_PROGRAM_NAME_CHARS = 200
MAX_PROGRAM_DESCRIPTION_CHARS = 5000

#: The message a blank name gets. Matches the phrasing ``schemas.messaging`` uses for a
#: blank body, so the client sees one convention for "you sent whitespace" everywhere.
_NO_BLANK_NAME = "Give a name that is not just whitespace."


class Institution(BaseModel):
    """``Institution`` â€” Â§12.3's ``GET /institutions/{id}`` body.

    Built explicitly rather than ``from_attributes`` because ``logo_url`` is not a
    column.
    """

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    #: The registering contact person. The caller's own id on every route.
    owner_id: uuid.UUID
    name: str
    #: Server-generated and immutable. See the module docstring.
    slug: str
    website: str | None
    location: str | None
    description: str | None
    #: Â§14.11's relative path, or null. Never absolute.
    logo_url: str | None
    #: Server-owned â€” see the module docstring.
    verification_status: VerificationStatus
    status: InstitutionStatus
    created_at: datetime
    updated_at: datetime


class MyInstitutionSummary(BaseModel):
    """``MyInstitutionSummary`` â€” ``GET /institutions/mine``, and the create result.

    A wrapper because ``program_count`` belongs to neither the institution nor its
    programs; it is a live count over the programs table.

    **The count is a real ``COUNT``, never a stored column.** Section 14.9 says so
    outright - "``program_count`` is a live ``COUNT``, not a column" - because a
    counter goes stale the moment a program is added or removed anywhere other than the
    one screen that maintains it.
    """

    model_config = ConfigDict(frozen=True)

    institution: Institution
    program_count: int


class Program(BaseModel):
    """``Program`` â€” Â§12.3's program list item and detail body are the same shape."""

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    institution_id: uuid.UUID
    name: str
    #: Free text, not a level enum: Â§14.9 says "``level`` text NULL".
    level: str | None
    description: str | None
    created_at: datetime
    updated_at: datetime


class InstitutionCreate(BaseModel):
    """``POST /institutions`` â€” the registering contact person becomes owner.

    ``owner_id`` is **absent**, and ``extra="forbid"`` turns an attempt to send one
    into a 422 rather than a silent drop: Â§12.3 makes the owner server-side, exactly
    as Â§12.2 does for a company's creator. No route would honour a client-supplied
    owner anyway â€” it would be an ownership transfer with no specification behind it.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_NAME_CHARS)
    website: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_CHARS)

    @field_validator("name")
    @classmethod
    def _name_is_not_blank(cls, value: str) -> str:
        """Refuse a whitespace-only name.

        ``min_length=1`` counts characters, so ``"   "`` passes it and then fails the
        ``btrim(name) <> ''`` CHECK at the database â€” which surfaces as a 500 carrying
        a driver message. Validating here gives the 422 that names the field, the same
        reason ``schemas.messaging`` refuses a blank message body.
        """
        if not value.strip():
            raise ValueError(_NO_BLANK_NAME)
        return value.strip()


class InstitutionUpdate(BaseModel):
    """``PATCH /institutions/{id}`` â€” every field optional.

    **Not ``InstitutionCreate``.** Reusing the create model would make
    ``PATCH {"name": "New"}`` clear the website and the description, which is not what
    a patch means.

    ``owner_id``, ``slug`` and ``verification_status`` are absent, and extras are
    forbidden, so all three are 422s. ``slug`` is the shareable handle (Â§12.3 calls it
    server-owned) and ``verification_status`` moves only through the
    verification-request route.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME_CHARS)
    website: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_CHARS)

    @field_validator("name")
    @classmethod
    def _name_is_not_blank(cls, value: str | None) -> str | None:
        """Same rule as ``InstitutionCreate``, and it must tolerate ``None``.

        Every field in a patch is optional, so an omitted ``name`` arrives as ``None``
        and has to pass straight through â€” only a *present* blank name is refused.
        """
        if value is None:
            return None
        if not value.strip():
            raise ValueError(_NO_BLANK_NAME)
        return value.strip()


class ProgramCreate(BaseModel):
    """``POST .../programs`` - the body is ``{name, level?, description?}``.

    ``institution_id`` is absent and extras are forbidden: the institution is in the
    path, and a body that disagreed with the path would be ambiguous about which one
    the caller meant.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_PROGRAM_NAME_CHARS)
    level: str | None = Field(default=None, max_length=100)
    description: str | None = Field(
        default=None, max_length=MAX_PROGRAM_DESCRIPTION_CHARS
    )

    @field_validator("name")
    @classmethod
    def _name_is_not_blank(cls, value: str) -> str:
        """Same rule as the institution name.

        Â§14.9 gives ``programs`` **no** ``CHECK (btrim(name) <> '')`` â€” it names only
        ``name text NOT NULL`` â€” so a whitespace-only program name has nothing to stop
        it and would be stored as blank. This validator is the only thing refusing it,
        which is exactly why it is stated in the migration's docstring too.
        """
        if not value.strip():
            raise ValueError(_NO_BLANK_NAME)
        return value.strip()


class ProgramUpdate(BaseModel):
    """``PATCH /institutions/{id}/programs/{program_id}`` â€” every field optional.

    ``name`` is optional here because ``ProgramsStep``'s rename action sends
    ``{name: next}`` and nothing else.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(
        default=None, min_length=1, max_length=MAX_PROGRAM_NAME_CHARS
    )
    level: str | None = Field(default=None, max_length=100)
    description: str | None = Field(
        default=None, max_length=MAX_PROGRAM_DESCRIPTION_CHARS
    )

    @field_validator("name")
    @classmethod
    def _name_is_not_blank(cls, value: str | None) -> str | None:
        """Same rule as ``ProgramCreate``; ``None`` passes through when omitted."""
        if value is None:
            return None
        if not value.strip():
            raise ValueError(_NO_BLANK_NAME)
        return value.strip()
