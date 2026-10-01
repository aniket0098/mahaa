"""Notification read models — the wire shapes for §13's four endpoints.

**No mobile module exists.** §23's parity table records notifications as having
no client module and both screens as `StageScreen`, and §13 notes the app
deliberately carries "no badge, dot, or count anywhere". So these shapes come from
the specification alone (§13.2) and are written to be what a Phase 10 module
binds to — the same situation Phase 5 documented for messaging.

**``actor`` is deliberately narrower than ``UserSummary``.** §13.2 writes it out:
``actor{user_id, name, avatar_url}``. That is three fields where
:class:`~app.schemas.users.UserSummary` has six — no ``public_id``, no
``username``, no ``role``. Following §13.2 literally *shrinks* what a notification
can disclose about a person: even a handle a recipient has never been told is not
in the payload, and no notification endpoint can leak a role. Narrower than the
general case is the point, so this is a separate model rather than a reuse.

**"Not shown" and "shown and empty" stay distinct** (§13.2), the same rule as
``PublicProfile`` (§5.3). A ``system`` notification has no actor, and the client
must be able to tell that apart from a notification whose actor happens to be
missing — so ``actor`` is nullable and there is no ``is_anonymous`` flag that
could fall out of step with it. Both are declared without a default, so the key is
required in the generated OpenAPI.

**``data`` is an open object, not a union of shapes.** §13.2 says the client
"renders from ``type`` + ``data``, so a wording change must not require a client
release" — a per-type Pydantic model would put the copy back under the type
system and undo that. The server owns the contents (§13.2: "never a rendered
message"), so a notification row is the only thing that can write here.

**The page envelope carries a real ``total``, which keyset normally avoids.**
§13.3 is explicit — "``total`` is the full count, not the page length" — and §17
independently forbids deriving it from the page. That is why this envelope is not
the messaging one: a conversation list needs no count, but a notification list is
what a "3 new" badge would be computed from, and §22 orders the count endpoint to
be built *before* any badge. So this costs one ``COUNT`` and buys the client the
number it is about to draw.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class NotificationActor(BaseModel):
    """The person who caused this — §13.2's three fields exactly.

    No ``public_id``, no ``username``, no ``role``: §13.2 names none of them, and a
    notification is the most widely-read object in the product.
    """

    model_config = ConfigDict(extra="forbid")

    user_id: str
    name: str
    #: Null for the same reason it is null on ``UserSummary`` — there is no media
    #: row to resolve ``avatar_media_id`` against until the media phase.
    avatar_url: str | None = None


class NotificationRead(BaseModel):
    """One notification, exactly §13.2's field order."""

    model_config = ConfigDict(extra="forbid")

    id: str
    type: str
    #: Null **only** when ``actor_id`` is null — i.e. a ``system`` notification,
    #: or one whose actor has since been deleted (§13.4).
    actor: NotificationActor | None
    target_type: str | None
    target_id: str | None
    title: str
    body: str | None
    data: dict[str, Any]
    is_read: bool
    created_at: str


class NotificationPage(BaseModel):
    """Keyset page of notifications — §13.3.

    ``items`` are newest-first and stay that way; marking something read changes
    ``is_read`` and never ``created_at``, so a row cannot move under a cursor the
    client is already holding.
    """

    items: list[NotificationRead]
    #: A real ``COUNT`` over the caller's notifications matching the same filter
    #: as ``items`` — §13.3 and §17. Not ``len(items)``.
    total: int
    limit: int
    #: Opaque. Pass it back as ``cursor``. Null when there is nothing older.
    next_cursor: str | None
    has_more: bool


class UnreadCount(BaseModel):
    """``GET /notifications/unread-count`` — a bare object, not an envelope.

    §13 requires this before any badge is drawn, because a badge is "a number the
    server cannot supply" until it does. One field is the whole payload: a count
    endpoint that also returned the list would make the badge a second read.
    """

    model_config = ConfigDict(extra="forbid")

    count: int = Field(ge=0, description="Notifications the caller has not read.")
