"""Account creation and credential verification.

The two operations the auth routes delegate to. Kept out of the route bodies so
the rules — no account enumeration, no plaintext retention, reactivation on
sign-in — are testable without going through HTTP.
"""

from __future__ import annotations

import secrets
import string

from argon2 import PasswordHasher
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import INVALID_CREDENTIALS_MESSAGE, ApiError, ErrorCode
from app.models import User
from app.models.enums import UserStatus
from app.schemas.auth import SignupRequest
from app.services.passwords import (
    hash_password,
    password_needs_rehash,
    verify_password,
)
from app.services.tokens import AccessToken, create_access_token

#: Used to build a human-typeable ``username`` from the person's name. Keeping
#: usernames to this alphabet means they are safe to put in a URL, a share sheet
#: and a search box without escaping.
_USERNAME_ALPHABET = string.ascii_lowercase + string.digits

#: Reserved handles that would collide with a route or read as a system account.
_RESERVED_USERNAMES = frozenset(
    {
        "admin",
        "api",
        "auth",
        "billing",
        "help",
        "login",
        "logout",
        "me",
        "signup",
        "support",
        "system",
        "user",
        "users",
    }
)

#: A real Argon2id hash of a value nobody can supply, used only to equalise the
#: cost of a failed lookup. Generated once at import; it is not a secret and
#: protects nothing. It exists so an unknown email costs the same as a wrong
#: password.
_DUMMY_HASH = PasswordHasher().hash("mahaa-timing-equalisation-sentinel")


class AccountSuspended(Exception):
    """The account exists and the password is right, but it is suspended.

    Raised separately from a credential failure so the route can answer 403
    ("you are known, but not allowed") without that distinction leaking into the
    wrong-password path.
    """


def _random_suffix(length: int = 6) -> str:
    return "".join(secrets.choice(_USERNAME_ALPHABET) for _ in range(length))


def normalize_email(email: str) -> str:
    """Trim, and lowercase the whole address.

    The column is ``citext``, so uniqueness already compares case-insensitively
    and normalising is not needed for *correctness* — it is for tidiness, so the
    stored value always looks the same however the person typed it.
    """

    return email.strip().lower()


def _generate_public_id() -> str:
    """``MJ-XXXXXXXX`` — assigned once, never changed by any endpoint."""

    return f"MJ-{_random_suffix(8).upper()}"


def _generate_username(name: str, session: Session) -> str:
    """Derive a unique handle from the person's name.

    The client has no username field on signup, so the server assigns one. A
    random suffix keeps two people called "Aditi Sharma" from colliding, and the
    loop resolves the rare case where the suffix does too.
    """

    base = "".join(c for c in name.lower().split() if c.isalnum())[:20] or "user"
    if base in _RESERVED_USERNAMES:
        base = f"{base}user"

    for _ in range(10):
        candidate = f"{base}{_random_suffix()}"
        if candidate in _RESERVED_USERNAMES:
            continue
        taken = session.scalar(
            select(func.count())
            .select_from(User)
            .where(func.lower(User.username) == candidate)
        )
        if not taken:
            return candidate
    # Ten collisions on a 36^6 suffix means something is wrong; a wider random
    # component is the safe fallback rather than failing a signup.
    return f"{base}{secrets.token_hex(4)}"


def create_user(session: Session, payload: SignupRequest) -> User:
    """Create one account, or raise a 409 if the email is taken.

    The uniqueness check is a convenience for a good error message, not the
    guarantee. Two simultaneous signups for the same address both pass it, so the
    ``citext`` unique index is what actually prevents a duplicate — and the
    ``IntegrityError`` handler below turns that race into the same 409.
    """

    email = normalize_email(str(payload.email))

    if session.scalar(select(User.id).where(User.email == email)) is not None:
        raise _duplicate_email_error()

    user = User(
        public_id=_generate_public_id(),
        username=_generate_username(payload.name, session),
        email=email,
        phone=payload.phone.strip() if payload.phone else None,
        # The only place a plaintext password is ever accepted; it is hashed on
        # the next line, and the plaintext is not stored, logged or returned.
        password_hash=hash_password(payload.password),
        name=payload.name.strip(),
        role=payload.role,
        status=UserStatus.ACTIVE,
    )
    session.add(user)
    try:
        session.commit()
    except IntegrityError as exc:
        # The concurrent-signup case. Same answer a sequential duplicate gets,
        # so a race is not distinguishable from a repeat attempt either.
        session.rollback()
        raise _duplicate_email_error() from exc
    return user


def _duplicate_email_error() -> ApiError:
    """The 409 both the check and the database race produce."""

    return ApiError(
        status_code=409,
        code=ErrorCode.CONFLICT,
        message=(
            "An account already exists with this email. Sign in instead, or use "
            "a different email."
        ),
    )


def authenticate(session: Session, email: str, password: str) -> User:
    """Verify credentials, or raise a 401 that says nothing about which part failed.

    Two deliberate details:

    * **A dummy hash is verified when the email is unknown.** Otherwise an unknown
      email returns in microseconds while a real one pays the ~75 ms of an
      Argon2 verification, and that timing gap is enough to enumerate accounts.
    * **One message, one code, one status for both failures**, so nothing in the
      response distinguishes "no such account" from "wrong password".

    A ``deactivated`` account signs in successfully and becomes active again:
    that is the mobile client's soft pause, and nothing was deleted. A
    ``suspended`` account is refused with 403 — the one case where 403 is
    correct, because the caller is authenticated and merely not permitted.
    """

    user = session.scalar(select(User).where(User.email == normalize_email(email)))

    if user is None:
        verify_password(password, _DUMMY_HASH)
        raise _invalid_credentials()

    if not verify_password(password, user.password_hash):
        raise _invalid_credentials()

    if user.status is UserStatus.SUSPENDED:
        raise AccountSuspended

    if user.status is UserStatus.DEACTIVATED:
        # The soft pause: signing in again reactivates. Deliberately not a 403 —
        # the person owns this account and is coming back to it.
        user.status = UserStatus.ACTIVE

    if password_needs_rehash(user.password_hash):
        # Parameters were raised after this password was stored. Upgrade it now,
        # while the plaintext is legitimately in hand, so nobody has to change
        # their password for a security improvement.
        user.password_hash = hash_password(password)

    user.last_login_at = func.now()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _invalid_credentials() -> ApiError:
    return ApiError(
        status_code=401,
        code=ErrorCode.INVALID_CREDENTIALS,
        message=INVALID_CREDENTIALS_MESSAGE,
    )


def issue_access_token(user: User) -> AccessToken:
    """Mint this user's access token."""

    return create_access_token(
        user_id=str(user.id),
        role=user.role.value,
        public_id=user.public_id,
    )
