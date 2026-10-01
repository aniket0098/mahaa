"""Connection write and read models — ``src/api/connections.ts`` and
``src/types/onboarding.ts``.

Field-for-field mirror of the mobile ``Connection`` type. Two decisions are worth
stating, because both are places where "reasonable" would have been wrong:

**``user`` is the *other* participant, never the caller.** The mobile comment
calls the type "from the caller's point of view", and ``is_outgoing`` exists to
tell them which side they are on. Returning the caller's own summary would let a
list row render the wrong person, so the service resolves the counterpart and
this model has no way to express anything else.

**A connection carries no profile data.** ``user`` is the existing
:class:`~app.schemas.users.UserSummary` — ``user_id``, ``public_id``, ``username``,
``name``, ``role``, ``avatar_url`` and nothing else. That is what makes privacy a
non-issue here rather than a thing to be careful about: the headline, bio,
location, email and phone that ``profile_privacy`` governs are not fields this
model has, so no connection endpoint can leak them whatever the owner's privacy
setting says. The full, privacy-filtered profile remains the job of
``GET /users/{public_id}``, which does not exist yet.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.users import UserSummary

#: The values the mobile ``Connection['status']`` union can be filtered by.
#:
#: Wider than :class:`~app.models.enums.ConnectionStatus` on purpose, because this
#: is the *query* vocabulary and the client can legitimately send any of the five
#: without a cast. ``removed`` is the client-side projection of a deleted row
#: (spec §6.1), so a filter for it matches nothing by construction — the route
#: answers an empty array rather than a 422, which would punish the client for
#: using a value its own type allows.
ConnectionStatusFilter = Literal[
    "pending", "accepted", "declined", "canceled", "removed"
]


class ConnectionCreate(BaseModel):
    """``POST /connections`` — body is exactly ``{user_id}``.

    ``user_id`` is the **internal** id, which is what ``api/users.ts``'s lookup
    returns; the public id and handle are only ever inputs that find a person, and
    are never accepted here. Typed as a ``UUID`` so a malformed value is a 422
    naming the field rather than a string that fails deeper in the route.
    """

    model_config = ConfigDict(extra="forbid")

    user_id: uuid.UUID


class ConnectionRead(BaseModel):
    """One connection, as the caller sees it."""

    id: str
    status: str
    #: True when the caller is the requester. This is what decides which buttons
    #: the client may render, and the server sends it so the app never has to
    #: infer the direction from a user id.
    is_outgoing: bool
    #: The **other** participant, never the caller.
    user: UserSummary
    created_at: str
    #: Null while the request is still pending. Also set by a cancellation, which
    #: the requester performs — see the ``connections`` model docstring.
    #:
    #: Declared without a default so it is *required* in the generated OpenAPI,
    #: matching the mobile ``responded_at: string | null`` (not
    #: ``string | null | undefined``). The service always passes it, so the key is
    #: on the wire in every response either way; saying so in the contract is what
    #: stops a client from treating the key as possibly-absent.
    responded_at: str | None
