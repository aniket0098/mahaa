"""``/users/me`` — the caller's own account, plus finding other people.

Phase 2 added the read. Phase 3 adds the lifecycle: update, password change,
deactivation and deletion. Phase 5.5 adds the one route here that deliberately
looks at *somebody else's* row: ``GET /users/lookup``.

Two design points carry the security weight of this file:

* **Every ``/users/me`` route is self-only.** They read and write
  ``current_user``, and none of them accepts a user id. There is no parameter
  through which a caller could name somebody else's account, which is a stronger
  guarantee than remembering to check ownership on each route. ``/users/lookup`` is
  the single deliberate exception, and it returns only
  :class:`~app.schemas.users.UserSummary` — never ``MeResponse`` — so it cannot
  become a way to read another account's email or phone.
* **A sensitive change carries the password.** ``email`` and ``username`` require
  ``current_password``, checked in the service. This stack has no email
  verification, so without that a stolen session could be used to take an account
  over permanently.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query, Response, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.errors import ApiError, ErrorCode
from app.models import User
from app.schemas.auth import MeResponse
from app.schemas.profile import PublicProfile
from app.schemas.users import (
    ChangePasswordRequest,
    DeleteAccountRequest,
    UsernameAvailability,
    UserSummary,
    UserUpdate,
)
from app.services import account as svc
from app.services import lookup as lookup_service
from app.services import media as media_service
from app.services import profile_service
from app.services.lookup import LOOKUP_QUERY_MAX

router = APIRouter(tags=["users"])


@router.get("/users/me", response_model=MeResponse, summary="My account")
def read_me(current_user: CurrentUser, session: DbSession) -> MeResponse:
    """The caller's own account.

    Carries no ``password_hash``: the read model has no such field, so it cannot
    appear even by accident.
    """

    return MeResponse(
        id=str(current_user.id),
        public_id=current_user.public_id,
        username=current_user.username,
        name=current_user.name,
        email=current_user.email,
        phone=current_user.phone,
        role=current_user.role.value,
        designation=current_user.designation,
        # Resolved from the pointer Phase 1 declared and this phase constrained.
        # `served_at` is the path the client joins onto its base URL (§14.11), so
        # this is exactly what `absoluteMediaUri()` expects — not an absolute URL
        # and not a filesystem path, which would leak the storage backend.
        avatar_url=media_service.avatar_url_for(current_user, session),
        created_at=current_user.created_at.isoformat(),
    )


@router.patch("/users/me", response_model=MeResponse, summary="Update my account")
def update_me(
    payload: UserUpdate, current_user: CurrentUser, session: DbSession
) -> MeResponse:
    """Patch the account.

    Absent fields are left alone. Changing ``email`` or ``username`` requires the
    current password, and a wrong one is a 401 with the same generic message as a
    wrong login — this endpoint must not become a password oracle.
    """

    user = svc.update_account(session, current_user, payload)
    return read_me(user, session)


@router.get(
    "/users/me/username/availability",
    response_model=UsernameAvailability,
    summary="Is this handle free?",
)
def username_availability(
    current_user: CurrentUser, session: DbSession, username: str
) -> UsernameAvailability:
    """Check a handle before committing to it.

    The caller's own handle reads as available: they already hold it, and the
    account screen asks this while the field still has its current value. Anything
    else is a plain yes/no.
    """

    if username == current_user.username:
        return UsernameAvailability(username=username, available=True)
    return UsernameAvailability(
        username=username,
        available=not svc.username_taken(session, username),
    )


@router.post(
    "/users/me/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change my password",
)
def change_password(
    payload: ChangePasswordRequest,
    current_user: CurrentUser,
    session: DbSession,
) -> Response:
    """Replace the password after proving the current one.

    Reuses the Phase 2 Argon2id hasher, so there is one hashing implementation in
    the system. The new value is validated by the same policy as signup.

    Returns 204: the client's ``changePassword`` is typed ``Promise<void>``.
    Existing access tokens are **not** revoked — V1 has no revocation list, so a
    token already issued stays valid until it expires (60 minutes). That is the
    documented cost of access-token-only.
    """

    svc.change_password(
        session, current_user, payload.current_password, payload.new_password
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/users/me/deactivate", response_model=MeResponse, summary="Pause my account"
)
def deactivate(current_user: CurrentUser, session: DbSession) -> MeResponse:
    """Soft pause.

    Sets the status to ``deactivated``; nothing is deleted and signing in again
    reactivates the account. The client treats this as reversible, so a physical
    delete here would be a data-loss bug.
    """

    return read_me(svc.deactivate(session, current_user), session)


@router.delete(
    "/users/me",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete my account",
)
def delete_me(
    payload: DeleteAccountRequest,
    current_user: CurrentUser,
    session: DbSession,
) -> Response:
    """Irreversible deletion, behind two independent confirmations.

    The typed phrase is checked by the schema and the password by the service, so
    neither alone can destroy an account. The profile, sections and links go with
    it through the database's own cascades.
    """

    svc.delete_account(session, current_user, payload.password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- discovery ---------------------------------------------------------------
#
# Declared last on purpose. When `GET /users/{public_id}` (§5.2) is added it will
# match `/users/lookup` as a path parameter, and FastAPI resolves routes in
# declaration order — so a literal route registered after a `{param}` route is
# shadowed by it. Keeping the literal here means the next person to add the
# public-profile route has to put it *after* this one.


@router.get(
    "/users/lookup",
    response_model=list[UserSummary],
    summary="Find people to connect with",
)
def lookup_users(
    current_user: CurrentUser,
    session: DbSession,
    query: Annotated[
        str,
        Query(
            min_length=1,
            max_length=LOOKUP_QUERY_MAX,
            description="Name, handle, or public ID.",
        ),
    ],
) -> list[UserSummary]:
    """Search for people, as ``src/api/users.ts``'s ``lookupUsers`` asks.

    A **bare array**, not a page envelope — §17 lists ``/users/lookup`` among the
    bare-array endpoints, and the client's return type has nowhere to put a total.

    **An exact handle or public ID resolves regardless of the owner's privacy
    settings; a name only reaches an account that opted into being discoverable.**
    That is §5.2's rule, and the asymmetry is deliberate: a handle and a public ID
    are things a person hands out, while a name is not.

    The result is ``UserSummary`` — six identifying fields. There is no email,
    phone, headline or private preference in the model, so this route cannot leak
    one however the owner's privacy is configured; the full filtered profile is
    ``GET /users/{public_id}``, which does not exist yet.

    A suspended or deactivated account can still be *found*; nothing here filters on
    status, because §5.2 does not ask for it. A suspended caller is refused by the
    shared dependency before this runs, exactly as on every other route.
    """

    return lookup_service.find_users(session, current_user, query)


@router.get(
    "/users/{public_id}",
    response_model=PublicProfile,
    # §5.3's whole rule: a field the viewer may not see is **absent**, not null.
    # Only the service's explicitly-passed fields are "set", so only those are
    # serialised. `exclude_none` would have been wrong here — it would also drop a
    # field that is genuinely shown and genuinely empty, collapsing the two claims
    # §5.3 exists to keep apart.
    response_model_exclude_unset=True,
    summary="A person's public profile",
)
def read_public_profile(
    current_user: CurrentUser,
    session: DbSession,
    public_id: Annotated[str, Path(max_length=100)],
) -> PublicProfile:
    """``PublicProfile`` (§5.2/§5.3), filtered by the owner's privacy settings.

    **Declared after `/users/lookup` on purpose** — the comment above that route
    reserved this slot, and the reason is routing, not taste: FastAPI matches in
    declaration order, so a ``{public_id}`` route registered before the literal
    ``/users/lookup`` would swallow every lookup request and the search would 404
    as a missing user.

    Authentication is required, matching every other route here: an anonymous
    caller gets no profile at all rather than a reduced one.

    **This route never returns `MeResponse`, and that is the privacy boundary.**
    `MeResponse` carries an email and a phone; this carries only what the owner's
    own settings permit, and the read model has no `password_hash` field to expose
    even by accident — the same property that makes `/users/me` safe, applied to
    somebody else's account.

    An unknown or suspended-looking handle is answered with the standard 404
    envelope rather than 403, so the route cannot be used to confirm which public
    ids exist. That matters less than it would for a password, and the caller
    already has to possess the id to ask, but a 200/404 pair that answered "this
    id exists" for an arbitrary string would still be a harvest.
    """

    owner = session.scalar(
        select(User).where(func.lower(User.public_id) == public_id.strip().lower())
    )
    if owner is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code=ErrorCode.NOT_FOUND,
            message="No profile was found for that link.",
        )

    return profile_service.public_profile_read(session, current_user, owner)

