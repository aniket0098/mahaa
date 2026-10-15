"""Wire shapes for the message-request endpoints.

Mirrors the main backend's schema conventions: ``extra="forbid"`` so a client
cannot smuggle a sender id into a create, ids and timestamps as strings on the
wire, and a sender summary that carries **only** fields a request card shows —
name, handle, role, designation and avatar path. No email, no phone, nothing
``profile_privacy`` governs: this is the most exposed object this service
produces, so the schema is the redaction.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

#: The longest a request note may be. Long enough for "Hi, I saw your profile
#: and…" and short enough that the card stays a card.
NOTE_MAX = 500

#: Whitespace-only notes are refused rather than stored — otherwise a note of
#: three spaces renders as an empty line forever.
_NO_CONTENT_NOTE = "A note cannot be empty."


class MessageRequestCreate(BaseModel):
    """``POST /message-requests`` — body is exactly ``{recipient_id, note?}``.

    There is no ``sender_id`` field at all, and ``extra="forbid"`` turns an
    attempt to supply one into a 422 rather than a silently ignored key: the
    sender is always the authenticated caller.
    """

    model_config = ConfigDict(extra="forbid")

    recipient_id: uuid.UUID
    note: str | None = Field(default=None, max_length=NOTE_MAX)

    @field_validator("note")
    @classmethod
    def _note_is_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.strip():
            raise ValueError(_NO_CONTENT_NOTE)
        return value.strip()


class SenderSummary(BaseModel):
    """What a request card shows about the sender — and nothing more."""

    user_id: str
    public_id: str
    username: str
    name: str
    role: str
    #: ``users.designation``; null when the account never set one.
    designation: str | None = None
    #: Relative media path (``/api/v1/media/<id>``), resolved against the main
    #: API's base URL by the client — this service does not serve bytes.
    avatar_url: str | None = None


class MessageRequestRead(BaseModel):
    """One request, as the **recipient** sees it."""

    id: str
    status: str
    note: str | None
    created_at: str
    responded_at: str | None
    sender: SenderSummary


class MessageRequestPage(BaseModel):
    """A single bounded page — pending requests never grow without limit."""

    items: list[MessageRequestRead]
    #: Server-derived count of *all* pending requests for the caller, not just
    #: this page: the tab badge is a count query, and the client must never
    #: compute it by adding up pages.
    pending_count: int


class PendingCount(BaseModel):
    """``GET /message-requests/count``."""

    pending: int


#: ``?status=`` accepts one of the three states, or nothing for pending.
StatusFilter = Literal["pending", "accepted", "rejected"]
