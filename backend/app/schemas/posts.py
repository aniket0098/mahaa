"""Wire schemas for ``/posts`` — §9.2 exactly, in the client's field names.

**`WirePost` has no `deleted_at`.** §9.3's soft delete is a storage decision: the
row survives so its position and comments do, but nothing the client parses
mentions the tombstone. A `deleted_at` field here would be an invitation to
render a tombstone, which §9.3 forbids by implication.

**`kind` appears in the response but is not in `PostCreate`'s trusted surface.**
§9.2 is blunt: "The client sends it, but the server decides." `PostCreate` still
accepts `kind` so the composer's payload validates — rejecting a field the client
sends would fail a legitimate request — but `PostCreate.derive_kind()` overrides
it, and a test asserts a mismatched `kind` is ignored rather than stored.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import MediaKind, PostCategory, PostKind

MAX_BODY_CHARS = 5000
MAX_TITLE_CHARS = 200
MAX_TAGS = 20
MAX_MEDIA_ITEMS = 10


class ProjectPayload(BaseModel):
    """``posts.project`` — a display payload, so it is a shape and nothing else.

    Every field beyond ``title`` is optional because §9.2 calls this a duplicate
    of ``ProfileTimeline`` output, and a timeline row may legitimately carry only
    a name and a date.
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=MAX_BODY_CHARS)
    technologies: list[str] | None = None
    category: str | None = Field(default=None, max_length=64)
    status: str | None = Field(default=None, max_length=64)
    team: str | None = Field(default=None, max_length=200)
    role: str | None = Field(default=None, max_length=200)
    source_url: str | None = Field(default=None, max_length=2000)
    live_url: str | None = Field(default=None, max_length=2000)


class AchievementPayload(BaseModel):
    """``posts.achievement`` — same reasoning as :class:`ProjectPayload`."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    issuer: str | None = Field(default=None, max_length=200)
    achieved_on: str | None = None
    description: str | None = Field(default=None, max_length=MAX_BODY_CHARS)
    verification_url: str | None = Field(default=None, max_length=2000)


class PostCreate(BaseModel):
    """``POST /posts`` body. §9.3's limits, as constraints rather than checks.

    ``extra="forbid"`` matches "every other write path" (§9.3). It also means a
    client sending ``author_id`` is rejected outright instead of having the field
    silently dropped — §9.3's impersonation rule is enforced by refusing to parse
    the field at all, which is stronger than ignoring it.
    """

    model_config = ConfigDict(extra="forbid")

    #: Accepted, then overridden. See the module docstring.
    kind: PostKind
    category: PostCategory
    title: str | None = Field(default=None, max_length=MAX_TITLE_CHARS)
    body: str | None = Field(default=None, max_length=MAX_BODY_CHARS)
    media_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_MEDIA_ITEMS)
    project: ProjectPayload | None = None
    achievement: AchievementPayload | None = None
    tags: list[str] = Field(default_factory=list, max_length=MAX_TAGS)

    def derive_kind(self, media_kinds: list[MediaKind]) -> PostKind:
        """§9.2's rule: the payload decides, in a fixed precedence order.

        ``achievement`` beats ``project`` beats media beats the category. The
        order is not arbitrary: an achievement post that also links a project is
        an achievement, and a project post with a screenshot is still a project —
        otherwise the same post would render a different block depending on
        whether an image happened to be attached.

        ``media_kinds`` is passed in rather than read from the database because
        the service has already loaded and ownership-checked those rows; this
        function must not re-query.
        """
        if self.achievement is not None:
            return PostKind.ACHIEVEMENT
        if self.project is not None:
            return PostKind.PROJECT
        if media_kinds:
            return PostKind.VIDEO if MediaKind.VIDEO in media_kinds else PostKind.IMAGE
        if self.category is PostCategory.LEARNING:
            return PostKind.LEARNING
        return PostKind.TEXT

    def has_payload(self, media_count: int) -> bool:
        """§9.3: at least one of ``body``, ``media``, ``project``, ``achievement``.

        The database CHECK is the weaker one — it cannot see ``post_media`` yet,
        because those rows are written after this one. This is the rule §9.3
        actually states, and the service calls it before the insert. A
        whitespace-only body counts as absent: it is not a payload the client
        can render.
        """
        return bool(
            (self.body and self.body.strip())
            or media_count
            or self.project is not None
            or self.achievement is not None
        )


class PostUpdate(BaseModel):
    """``PATCH /posts/{id}`` body — §9.1: "{body?, title?}", and only that.

    Not ``PostCreate``: a patch cannot change the category, swap the payload, or
    re-point the attachments. Allowing that here would make a patch silently
    rewrite a post's `kind`, which §9.2 reserves for the server's own derivation.
    """

    model_config = ConfigDict(extra="forbid")

    body: str | None = Field(default=None, max_length=MAX_BODY_CHARS)
    title: str | None = Field(default=None, max_length=MAX_TITLE_CHARS)


class PostMediaOut(BaseModel):
    """One ``media[]`` entry — §9.2's list, field for field.

    ``width``/``height`` are Phase 7's server-derived PNG/JPEG/WebP dimensions.
    §9.2: they "**must be accurate** — the client sizes every image from them and
    never decodes an image itself", so they are nullable rather than defaulted to
    zero here; a null is the honest answer for a document or a video, and the
    client already maps `null` to 0.
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
    position: int


class PostAuthorOut(BaseModel):
    """``author`` — §9.2's five fields, all derived from the caller's view.

    ``verified`` is hard-coded ``False`` in the service. §9.2: it "**must default
    to `false`` and require a real signal. The client renders a badge from this
    field and nothing else, so a wrong `true`` is a false credential claim". No
    verification system exists in V1, so there is no signal to read.

    ``is_self`` is computed per request against the authenticated principal, which
    is why this is a response schema and not a column.
    """

    model_config = ConfigDict(frozen=True)

    name: str
    headline: str | None
    avatar_url: str | None
    verified: bool
    is_self: bool


class WirePost(BaseModel):
    """The stored post, as ``POST /posts`` and ``PATCH /posts/{id}`` return it.

    Built explicitly rather than via ``from_attributes``: three of its fields
    (``media``, ``author``, ``kind``) are *not* columns, so there is no ORM object
    that would satisfy an attribute-driven model anyway. `posts.project` and
    `posts.achievement` round-trip as ``dict`` because they are jsonb display
    payloads (§14.9), not typed records — the client reads them as
    `WireProject`/`WireAchievement` and treats every field as optional, so
    re-validating them here would add constraints the storage contract does not
    have.
    """

    id: uuid.UUID
    kind: PostKind
    category: PostCategory
    title: str | None
    body: str | None
    media: list[PostMediaOut]
    project: dict[str, Any] | None
    achievement: dict[str, Any] | None
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    author: PostAuthorOut


#: ``/posts`` answers with ``Page[WirePost]`` — ``{items, total, limit, offset,
#: has_more}`` — which is what §9.1 and §17 require and what
#: ``docs/feed-api-contract.md`` names. It is deliberately **not** the
#: ``/stories`` ``FastApiPage`` (§17 explains the difference); the client carries
#: both types and reads only the fields this envelope actually has.
#:
#: There is deliberately no ``PostPage = Page`` alias here. A second name for one
#: class is a second thing to keep in sync, and the endpoints import ``Page``
#: directly from ``app.schemas.common`` exactly as ``profile.py`` and
#: ``skills.py`` do.
