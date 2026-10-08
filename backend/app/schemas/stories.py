"""Wire schemas for ``/stories`` — §10.1 exactly, in the client's field names.

**Every field here is one the mobile client already parses.** `src/api/stories.ts`
declares a `RawStory` with exactly these names and maps them one-for-one, so a
renamed or extra field is a contract break rather than a nicety. §10.1's shape is
``{id, content_type, caption, status, publisher{...}, opportunity, viewed,
created_at}`` and that is the whole of it.

**``expires_at`` is deliberately absent**, even though it is the column the list
query filters on. The client never reads it: §10.2 says "the client sends no date
filter, so the server owns the window", so a client that received the deadline
could compute its own filter and drift from the server's. Sending it would invite
exactly the bug the specification is avoiding.

**``viewed`` is per viewer, so it cannot be a column.** §10.1 requires it "returned
on the list, so the ring can render viewed/unviewed without a second request",
which means it is computed per request against the authenticated principal — the
same reason posts' `author.is_self` is a response field and not a column.

**``publisher`` is a display snapshot with exactly three fields.** The stored JSONB
holds only ``{name, logo_url, verified}``; `kind` is a separate column because
§10.1 puts it beside the others but §14.10 constrains it with a CHECK. Nothing else
from the authorising user is stored — no email, no id, no role, no token material —
because a publisher banner is display state, not an account record, and a copy of
it must never be able to leak one.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import MediaKind, StoryContentType, StoryPublisherKind, StoryStatus

#: §10.2's example window: "``created_at + interval '24h'``". Stored as an explicit
#: `expires_at` so a per-story window is adjustable without a migration, which is
#: the reason §10.2 gives for the column.
DEFAULT_TTL_HOURS = 24

#: A story is a caption plus at most one image or video. The ceiling is generous
#: rather than tight: §10 sets no limit, so this bounds the request body, it does
#: not encode a product decision the specification did not make.
MAX_CAPTION_CHARS = 2000


class StoryPublisherOut(BaseModel):
    """``publisher`` — §10.1's three display fields.

    Read straight out of the stored snapshot rather than re-derived from a `User`,
    so the banner shows what the publisher looked like when the story was
    published. See the module docstring for why that is the Phase 8 shape.
    """

    model_config = ConfigDict(frozen=True)

    name: str
    logo_url: str | None
    #: Hard-coded ``False`` in the service, for §9.2's reason applied here: the
    #: client renders a badge from this field and nothing else, and V1 has no
    #: publisher verification signal at all.
    verified: bool
    #: §10.1's discriminator, from its own column rather than the payload.
    kind: StoryPublisherKind


class StoryOpportunityOut(BaseModel):
    """``opportunity`` — §10.1's summary, or null.

    A summary and not a record: §10.1 says a story "is often an advertisement for
    an opportunity", and the viewer only needs enough to render a "View Job" link.
    Nothing in V1 populates this (the `opportunities` table is Phase 9), so it is
    always null today, and it is typed anyway so the client's optional chain is
    satisfied by the shape rather than by luck.
    """

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    title: str
    location: str | None
    work_mode: str | None


class StoryMediaOut(BaseModel):
    """``media`` — the asset a story carries, or the story has none.

    **This exists because the viewer cannot play what it is never given.** The
    original V1 contract returned no media field at all, so a story whose upload
    succeeded rendered as caption-only text: the bytes were stored, the row
    referenced them, and no client could ever fetch them. That is the field the
    upload-to-playback pipeline was missing.

    The shape is :class:`app.schemas.posts.PostMediaOut` minus ``position`` — a
    story holds at most one asset (§10.1), so a slot index would always be 0 and
    a field that is always 0 is a claim of variability that does not exist.

    ``uri`` is ``MediaAsset.served_at``: a **relative path** such as
    ``/api/v1/media/{id}`` (§14.11) that the client joins onto its configured
    base itself. Publishing a host here would hard-code an environment into the
    wire and contradict §14.11 — the same reason `absoluteMediaUri()` exists.

    ``duration_ms`` is nullable and **always null in V1** (no decoder; §11.4's
    ``video_duration_enforced: false``). The field is typed so the client can
    distinguish "unknown duration" from "no such field" rather than guessing.
    """

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    kind: MediaKind
    mime_type: str
    width: int | None
    height: int | None
    duration_ms: int | None
    size_bytes: int
    #: A relative path such as ``/api/v1/media/{id}`` (§14.11's `served_at`).
    uri: str


class StoryOut(BaseModel):
    """One story, as ``GET /stories`` and ``GET /stories/{id}`` return it.

    Built explicitly rather than via ``from_attributes``: ``viewed`` and
    ``publisher`` are not columns, so there is no ORM object that would satisfy an
    attribute-driven model.
    """

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    content_type: StoryContentType
    caption: str
    status: StoryStatus
    publisher: StoryPublisherOut
    opportunity: StoryOpportunityOut | None
    #: Per viewer. See the module docstring.
    viewed: bool
    created_at: datetime
    #: The asset this story carries, or ``None`` for a text-only story. Without
    #: this the upload-to-playback pipeline dead-ends server-side: the bytes
    #: exist, the row points at them, and no client can ever ask for them.
    media: StoryMediaOut | None
    #: The author's **public** id (``MJ-…``) — the identifier `GET /users/{public_id}`
    #: is already designed to receive, so publishing it here leaks nothing the
    #: lookup route does not. It is deliberately *not* inside ``publisher``: the
    #: publisher snapshot stays a three-field display payload (module docstring),
    #: and grouping stories by person needs a stable per-author key the snapshot
    #: intentionally refuses to carry.
    author_public_id: str
    #: Whether *this* viewer is the author, computed per request against the
    #: authenticated principal — the same reason posts' ``author.is_self`` is a
    #: response field and not a column. The client uses it to hide the Connect
    #: control on your own story.
    is_self: bool


class StoryCreate(BaseModel):
    """``POST /stories`` body — the server-side publication path.

    **This route is [F] in §10.1**: "No mobile caller. Stories are published
    server-side (platform/company)". It exists because stories are recruiter- and
    platform-published content, so *something* has to be able to create them, and
    because the feed cannot be exercised at all without a way in. There is no client
    call site and `src/api/stories.ts` has no publish function, which is the
    specification's "[F]" claim being true in both directions.

    ``extra="forbid"`` matches every other write path here. It also means a caller
    cannot smuggle in ``publisher`` or ``author_id``: those are derived from the
    authenticated principal, and refusing to parse the field at all is stronger
    than ignoring it — the same argument §9.3 makes for posts.

    ``expires_in_hours`` is the one knob a publisher gets, because §10.2's whole
    reason for an ``expires_at`` column is that "a per-story window is then
    adjustable without a migration". A publisher who cannot set it could never
    prove that, and the column would be decorative.
    """

    model_config = ConfigDict(extra="forbid")

    content_type: StoryContentType
    caption: str = Field(min_length=1, max_length=MAX_CAPTION_CHARS)
    #: Optional; a story may be text-only (an announcement with no artwork).
    media_id: uuid.UUID | None = None
    #: §10.2's adjustable window, bounded to a year so a typo cannot publish
    #: something that outlives the feed it appears in.
    expires_in_hours: int = Field(default=DEFAULT_TTL_HOURS, ge=1, le=8760)
    #: §10.1's publisher discriminator. `company` is accepted so the vocabulary is
    #: complete, but Phase 8 cannot verify a company exists — see the service.
    publisher_kind: StoryPublisherKind = StoryPublisherKind.PLATFORM


class StoryViewOut(BaseModel):
    """``POST /stories/{id}/view`` — §10.1's four fields, exactly.

    ``already_recorded`` is the honest answer to "did *this* call insert the row,
    or was it already there?". §10.2 requires the flag and requires it to come with
    "the original ``viewed_at``", which is what makes a retried request
    indistinguishable from the first one — §18's keyed-retry contract, expressed in
    the response rather than in a header.

    ``viewed`` is always ``True`` on this route: a view that was not recorded is a
    404 (the story is gone), never a success with ``viewed: false``.
    """

    model_config = ConfigDict(frozen=True)

    story_id: uuid.UUID
    viewed: bool
    already_recorded: bool
    viewed_at: datetime
