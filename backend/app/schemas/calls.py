"""Call wire shapes — the five endpoints Phase 14 adds.

**No token is ever in a read or write model.** The LiveKit token is minted by
``GET /calls/{id}/token`` and returned there alone. A token inside
``CallRead`` would mean every list response carried a live credential, and
``call.incoming`` on the socket would carry one too — a token that outlives its
frame in a log or a replayed buffer. Keeping the token to its own endpoint is
what lets it be short-lived: it is re-minted on each join attempt, and the
socket payload stays identifiers only.

**``mode`` is the only field a client sends to start a call**, and there is no
``callee_id`` on ``CallCreate``. The callee is the *other member of the
conversation*, which the service derives from the bound conversation's
membership — a client cannot name a ring target, so it cannot ring a third
person or join a room it was not invited to. That is the same shape
``POST /conversations/{id}/messages`` uses, for the same reason.

**``CallHistoryItem`` carries no token and no room name.** Call history is a
record of what happened: direction, mode, outcome and duration. The room name is
an internal identifier with no meaning to a client, and exposing it would
invite a client to try joining a finished room.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import CallMode


class CallCreate(BaseModel):
    """``POST /conversations/{id}/calls``.

    ``mode`` defaults to audio because that is the common case, and omitting it
    is not a mistake worth refusing. ``callee_id`` does not exist: the other
    member of the conversation is the callee by construction.
    """

    model_config = ConfigDict(extra="forbid")

    mode: CallMode = Field(default=CallMode.AUDIO)


class CallRead(BaseModel):
    """One call, as a member of its conversation sees it.

    ``caller_id`` and ``callee_id`` are the two participants; a client decides
    whether a call is incoming or outgoing by comparing ``caller_id`` to its own
    id, so there is no ``direction`` field that could disagree with the rows.
    """

    id: str
    conversation_id: str
    caller_id: str
    callee_id: str
    mode: str
    status: str
    created_at: str
    answered_at: str | None
    ended_at: str | None
    ended_by: str | None


class CallTokenRead(BaseModel):
    """A short-lived LiveKit join token, returned only by the token endpoint.

    ``server_url`` is the LiveKit WSS endpoint the client connects to, taken from
    server configuration. ``token`` is signed server-side and valid only for this
    call's room and this member's identity; it is never stored, and a client
    re-requests it for each join rather than caching it.
    """

    token: str
    server_url: str
    room_name: str
    identity: str
    expires_at: str


class CallPage(BaseModel):
    """Offset page of call history, newest first.

    Offset rather than keyset, unlike messages: call history is bounded by a
    pair's actual conversations and is read for a "recent calls" list, not an
    unbounded thread. A real ``total`` is useful here — the client shows it —
    and affordable at this size.
    """

    items: list[CallRead]
    total: int
    limit: int
    offset: int
