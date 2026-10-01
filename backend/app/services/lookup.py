"""Finding people to connect with — ``GET /users/lookup``.

Kept out of :mod:`app.services.account` on purpose: every function there operates on
**the caller's own row** and that module says so, whereas this is the one query in
the users domain that deliberately looks at *other* people's rows.

**The matching rule is the specification's, not this module's.** §5.2 states it in
one line: "name search only reaches discoverable accounts; exact handle/public_id
resolves regardless". Both halves matter, and the asymmetry is the point:

* A **name** is not a handle. People share their names; nobody has agreed to be
  findable by it. So a partial name match only reaches accounts whose owner turned
  ``discoverable`` on — and that column defaults to **false**, so a brand-new
  account is invisible to a name search until it opts in.
* A **handle** and a **public id** are the two things a person deliberately hands
  out. ``public_id`` exists precisely to be shared, so an exact match on either
  resolves even for a fully private account. That is not a privacy leak: the
  caller already possessed the identifier.

The asymmetry is also what stops this becoming an enumeration endpoint. Searching
``"Aditi Sharma"`` across a platform's accounts is exactly the harvest the
``discoverable`` flag exists to prevent, and it is refused. Searching a handle you
were given is not.

**The caller is never in their own results.** Not a privacy rule — the caller
already knows their own row — but a correctness one: the only consumer of this
result is ``sendConnectionRequest(userId)``, and a self-connection is a 422. The
filter can only ever *narrow* results, so it cannot weaken anything.

**No pagination, and a hard cap.** §17 lists ``/users/lookup`` among the bare-array
endpoints and its "grows without bound" list is messages, notifications, call
history and conversations — not this. So there is no envelope and no cursor; the cap
below is a safety bound on one query, not a contract the client has to honour.
"""

from __future__ import annotations

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError, ErrorCode, error_detail
from app.models import ProfilePrivacy, User
from app.schemas.users import UserSummary

#: The longest search term. Long enough for any real name or handle; short enough
#: that a pathological input cannot turn into a big scan.
LOOKUP_QUERY_MAX = 100

#: How many rows one lookup may return. The contract is a bare array with no limit
#: parameter, so this is the only thing between a one-character query and the whole
#: table. Twenty fills a person-picker and keeps the response phone-sized.
LOOKUP_RESULT_MAX = 20


def _escape_like(value: str) -> str:
    """Escape LIKE wildcards so a typed ``%`` searches for a literal ``%``.

    The same reasoning, and nearly the same function, as ``endpoints/skills.py``'s
    catalogue search: without it ``%`` would match every account on the platform.
    Duplicated rather than shared because the two searches have nothing else in
    common, and a cross-domain import for one line would couple them.
    """

    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _is_discoverable() -> object:
    """A correlated EXISTS on the owner's privacy row with ``discoverable`` on.

    A user with no privacy row is **not** discoverable. The row is created lazily on
    first profile read and the column's own default is false, so treating "absent"
    as "off" is both the conservative answer and the one that matches what a user
    would see on their own settings screen.
    """

    return (
        select(ProfilePrivacy.user_id)
        .where(
            ProfilePrivacy.user_id == User.id,
            ProfilePrivacy.discoverable.is_(True),
        )
        .exists()
    )


def find_users(session: Session, viewer: User, query: str) -> list[UserSummary]:
    """People matching ``query``, as the caller is allowed to see them.

    An exact handle or public id outranks a name match, because that is the flow the
    endpoint exists for: somebody pastes ``MJ-A1B2C3D4`` and expects *that person*
    first, not a list of strangers who happen to share a surname. Ties inside each
    group break on ``name`` then ``id``, so two identical requests cannot reshuffle.
    """

    term = query.strip()
    if not term:
        # A blank search must never mean "everyone". Answering the whole table to an
        # empty query is the one thing this endpoint must not be able to do.
        raise ApiError(
            status_code=422,
            code=ErrorCode.VALIDATION_ERROR,
            message="Type a name, handle or public ID to search for.",
            details=[
                error_detail("query", "This search cannot be empty.", "value_error")
            ],
        )

    lowered = term.lower()
    exact_handle = or_(
        func.lower(User.username) == lowered,
        func.lower(User.public_id) == lowered,
    )
    name_match = User.name.ilike(f"%{_escape_like(term)}%", escape="\\")

    statement = (
        select(User)
        .where(
            # The caller is never a result.
            User.id != viewer.id,
            or_(
                # Resolves regardless of privacy: they were handed this identifier.
                exact_handle,
                # A name only reaches somebody who opted into being discoverable.
                and_(name_match, _is_discoverable()),
            ),
        )
        .order_by(
            case((exact_handle, 0), else_=1),
            User.name,
            User.id,
        )
        .limit(LOOKUP_RESULT_MAX)
    )

    return [
        UserSummary(
            user_id=str(user.id),
            public_id=user.public_id,
            username=user.username,
            name=user.name,
            role=user.role.value,
            avatar_url=None,  # media phase
        )
        for user in session.scalars(statement)
    ]
