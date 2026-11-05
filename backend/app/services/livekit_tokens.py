"""Mint LiveKit join tokens.

**The server signs a token and never carries media.** Its only job here is to
answer one question — "is this member allowed into this call's room?" — with a
short-lived credential. Audio and video travel client-to-client through LiveKit;
routing them through the API would make a career call a bandwidth line item on
the backend and would put recorded media inside the process that holds the
database.

**The token is scoped to exactly one room and one identity.** The room name is
derived from the call id and the identity from the member's user id, so a token
minted for call A cannot join call B's room, and a client cannot join under
somebody else's identity. Both values come from the *row* after the caller's
membership has been verified — never from the request.

**The token is short-lived and never persisted.** ``livekit_token_ttl_seconds``
(default 600, capped at 3600) is the whole lifetime. A client that is still in a
call when it expires re-requests one; a token outliving its call would be a key
to an empty room, and a stored token would be a credential in a database dump.
Nothing here writes to the session.

**Configuration is all-or-nothing.** A missing ``LIVEKIT_URL``, key or secret
means calling is not configured, and the answer is a 503 rather than a half-built
token — see :func:`assert_configured`. That keeps the endpoint honest: the
endpoint exists, and it says the service is not wired, rather than returning a
token that LiveKit would reject.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from livekit import api

from app.core.config import get_settings
from app.core.errors import ApiError, ErrorCode


def is_configured() -> bool:
    """Whether LiveKit credentials are present.

    Delegates to the same property the admin/health surface reads, so there is
    one definition of "configured" rather than two that can drift.
    """

    return get_settings().livekit_configured


def not_configured() -> ApiError:
    """503, not 500: the request was valid and the caller is allowed in, but the
    deployment has no LiveKit credentials. A client can distinguish "not wired
    yet" from "broken" and render accordingly.
    """

    return ApiError(
        status_code=503,
        code=ErrorCode.SERVICE_UNAVAILABLE,
        message="Calling is not configured on this server.",
    )


def room_name_for(call_id: uuid.UUID) -> str:
    """The room a call lives in, derived from its id.

    Derived rather than stored at call-creation time by the service, which is
    what keeps it out of the request entirely: there is no column a client could
    name and no way to ask for somebody else's room. The prefix keeps rooms
    recognisable in the LiveKit dashboard.
    """

    return f"mahaa-call-{call_id}"


def mint(
    *,
    room_name: str,
    user_id: uuid.UUID,
    display_name: str,
    can_publish: bool,
) -> dict[str, str]:
    """Return the fields ``CallTokenRead`` needs, or raise 503 if unconfigured.

    ``room_name`` and ``user_id`` both come from the *row* after the caller has
    verified participation, never from the request — that is what makes a token
    for call A unable to open call B's room, and stops a client joining under
    somebody else's identity.

    ``can_publish`` is the only authorisation this function applies, and it is
    passed in rather than decided here: the service has already established the
    call's state, and a token module that re-derived it would be a second,
    drifting opinion about when a member may speak.

    ``display_name`` is what the other participant sees in LiveKit's own UI. It is
    the name the caller already resolved, not a new query.
    """

    settings = get_settings()
    if not settings.livekit_configured:
        raise not_configured()

    ttl = settings.livekit_token_ttl_seconds
    expires_at = datetime.now(UTC) + timedelta(seconds=ttl)
    identity = str(user_id)

    token = (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(identity)
        .with_name(display_name)
        .with_ttl(timedelta(seconds=ttl))
        .with_grants(
            api.VideoGrants(room_join=True, room=room_name, can_publish=can_publish)
        )
        .to_jwt()
    )

    return {
        "token": token,
        "server_url": settings.livekit_url,
        "room_name": room_name,
        "identity": identity,
        "expires_at": expires_at.isoformat(),
    }
