"""Account lifecycle: update, password change, deactivation, deletion.

Every function here operates on **the caller's own row**, passed in as
``user``. There is no ``user_id`` parameter to get wrong, so there is no way for
one of these to be called against somebody else's account.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import INVALID_CREDENTIALS_MESSAGE, ApiError, ErrorCode
from app.models import User
from app.models.enums import UserStatus
from app.schemas.users import UserUpdate
from app.services.identity import normalize_email
from app.services.passwords import hash_password, verify_password


def username_taken(session: Session, username: str, exclude_user_id=None) -> bool:
    """Whether a handle is already in use.

    Compared case-insensitively even though the column is case-sensitive, because
    a person who sees ``aditi`` and ``Aditi`` on two profiles would reasonably
    read that as a bug — and the client types handles as lowercase, so the
    comparison is done lowered on both sides rather than lowercasing the stored
    value.
    """

    statement = select(func.count()).select_from(User).where(
        func.lower(User.username) == username.lower()
    )
    if exclude_user_id is not None:
        statement = statement.where(User.id != exclude_user_id)
    return int(session.scalar(statement) or 0) > 0


def update_account(session: Session, user: User, payload: UserUpdate) -> User:
    """Apply a partial account update.

    ``exclude_unset`` is what makes this a PATCH: only the fields the client
    actually sent are touched, so an account screen that submits just ``name``
    does not blank the phone number.
    """

    changes = payload.model_dump(exclude_unset=True)
    # Strip the confirmation before it can reach the model: it is a gate, not a
    # column, and `User` has no such attribute.
    current_password = changes.pop("current_password", None)

    sensitive = "email" in changes or "username" in changes
    if sensitive and not verify_password(current_password or "", user.password_hash):
        # The schema already requires the field to be present; this checks it is
        # *correct*. A wrong password and a missing one must be indistinguishable
        # to the client, or this endpoint becomes a password oracle.
        raise ApiError(
            status_code=401,
            code=ErrorCode.INVALID_CREDENTIALS,
            message=INVALID_CREDENTIALS_MESSAGE,
        )

    if "username" in changes and username_taken(
        session, changes["username"], exclude_user_id=user.id
    ):
        raise _conflict("That username is already taken.")

    if "email" in changes:
        email = normalize_email(str(changes["email"]))
        if email != str(user.email):
            clash = session.scalar(
                select(User.id).where(User.email == email, User.id != user.id)
            )
            if clash is not None:
                raise _conflict("An account already exists with this email.")
        changes["email"] = email

    if "name" in changes and changes["name"]:
        changes["name"] = changes["name"].strip()

    for field, value in changes.items():
        setattr(user, field, value)

    session.add(user)
    try:
        session.commit()
    except IntegrityError as exc:
        # The race: two accounts claiming one handle at the same instant. Same
        # answer as the checked path, so a race is not distinguishable.
        session.rollback()
        raise _conflict("That username or email is already taken.") from exc
    session.refresh(user)
    return user


def _conflict(message: str) -> ApiError:
    return ApiError(status_code=409, code=ErrorCode.CONFLICT, message=message)


def change_password(
    session: Session, user: User, current_password: str, new_password: str
) -> None:
    """Replace the password, after proving the old one.

    The new value goes through the same Argon2id hasher as signup, so there is
    exactly one hashing implementation in the system. An already-weak stored hash
    is transparently upgraded on this path, which is the one moment the plaintext
    is legitimately in hand.
    """

    if not verify_password(current_password, user.password_hash):
        raise ApiError(
            status_code=401,
            code=ErrorCode.INVALID_CREDENTIALS,
            message=INVALID_CREDENTIALS_MESSAGE,
        )

    user.password_hash = hash_password(new_password)
    session.add(user)
    session.commit()


def deactivate(session: Session, user: User) -> User:
    """Pause the account.

    Sets ``status = deactivated``. Nothing is deleted, and signing in again
    reactivates it (see ``app.services.identity.authenticate``) — that is the
    mobile client's soft pause, and it is why this is a status change and not a
    DELETE.
    """

    user.status = UserStatus.DEACTIVATED
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def delete_account(session: Session, user: User, password: str) -> None:
    """Delete the account, irreversibly.

    Both confirmations have already been checked by the schema (password
    verified here, the typed ``DELETE`` phrase verified there). The row is removed
    with the database's own ``ON DELETE CASCADE`` taking the profile, the
    sections and the links with it.

    Everything belonging to the account goes: this is the specification's one
    place where a physical delete is the correct answer, because the person asked
    for it twice — once by submitting the form and once by typing the phrase.
    """

    if not verify_password(password, user.password_hash):
        raise ApiError(
            status_code=401,
            code=ErrorCode.INVALID_CREDENTIALS,
            message=INVALID_CREDENTIALS_MESSAGE,
        )
    session.delete(user)
    session.commit()
