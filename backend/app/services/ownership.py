"""Ownership enforcement for user-owned records.

Every profile row belongs to exactly one user, and every read, update and delete
has to prove the caller is that user. This module is the single place that
decision is made, because "did we remember to check?" is not a question that
should be answered differently in twelve endpoints.

**Why a missing row and someone else's row both answer 404, not 403.**

A 403 on *someone else's* record confirms the record exists, which turns the
endpoint into an oracle: a caller can probe ids and learn how many education
entries the platform holds. A 404 gives the same answer for "no such id" and
"not yours", so the response reveals nothing. The specification makes the same
call for connections ("a request that is not the caller's answers 404, not
403"), and the same reasoning applies here.

A **role** mismatch is a different question and does answer 403: a route the
caller's role may not use at all is a real, nameable refusal, and the client
relies on the 403 to show its "not available to you" state.
"""

from __future__ import annotations

import uuid
from typing import TypeVar

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError, ErrorCode

#: A module-level TypeVar rather than PEP 695 function type parameters
#: (``def f[T](...)``). A function's type parameters are function-scoped, and this
#: module uses ``from __future__ import annotations``, so Pydantic re-evaluates the
#: annotation *string* at request time — outside that scope — and would fail with
#: ``NameError: name 'ModelT' is not defined``. A module-level TypeVar is visible to
#: the evaluation, which is what makes these helpers usable as FastAPI handlers'
#: return types.
ModelT = TypeVar("ModelT")


def _not_found(what: str) -> ApiError:
    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message=f"That {what} was not found.",
    )


def parse_id(raw: str, what: str) -> uuid.UUID:
    """Turn a path parameter into a UUID, or answer 404.

    A malformed id is treated as "no such record" rather than a 422 or a 500.
    That keeps the endpoint from becoming a UUID-format oracle and matches what
    the integration suite expects: removing `'00000000-0000-0000-0000-000000000000'`
    is a 404, and so is removing `'nonsense'`.
    """

    try:
        return uuid.UUID(str(raw))
    except (TypeError, ValueError):
        raise _not_found(what) from None


def owned_query(model: type[ModelT], user_id: uuid.UUID) -> Select:  # noqa: UP047
    """A SELECT already scoped to one user's rows.

    Scoping in the *query* rather than fetching and filtering in Python means a
    list endpoint cannot accidentally return another user's rows because a filter
    was forgotten, and it lets the database use its index.
    """

    return select(model).where(model.user_id == user_id)


def get_owned(  # noqa: UP047
    session: Session,
    model: type[ModelT],
    record_id: uuid.UUID,
    user_id: uuid.UUID,
    what: str,
) -> ModelT:
    """Fetch one row, proving it belongs to ``user_id``. Else 404.

    The ownership test is part of the lookup, not a check afterwards: there is no
    window in which a row belonging to somebody else has been loaded.
    """

    record = session.scalar(
        select(model).where(model.id == record_id, model.user_id == user_id)
    )
    if record is None:
        raise _not_found(what)
    return record
