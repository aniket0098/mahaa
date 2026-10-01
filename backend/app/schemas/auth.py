"""Request and response models for the authentication domain.

Every field here exists in the mobile client. Nothing is invented, and nothing is
renamed:

* ``src/types/auth.ts`` — ``SignupFormValues``, ``LoginFormValues``,
  ``TokenResponse``, ``Principal``, ``SignupRole``.
* ``src/api/integration.test.ts`` asserts ``token_type === 'bearer'`` and
  ``expires_in > 0``, and a duplicate signup must be a 409 while a rejected
  password must be a 422.

``TokenResponse`` deliberately has **no** ``refresh_token``: V1 is
access-token-only, and adding one would be a silent breaking change to a client
that does not read it.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models.enums import UserRole
from app.services.passwords import (
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    password_policy_errors,
)


class SignupRequest(BaseModel):
    """``POST /auth/signup``.

    ``extra="forbid"`` is the project-wide convention: a client that sends a
    field the server does not understand gets a 422 instead of silently having it
    dropped, which is how "my change had no effect" bugs start.

    The mobile client always sends ``phone``, sending ``null`` when the field was
    left blank — so it must be accepted as null, not merely as a string.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(
        min_length=PASSWORD_MIN_LENGTH,
        max_length=PASSWORD_MAX_LENGTH,
        # Never echoed back. Pydantic masks it in reprs and in validation errors,
        # so a password cannot leak through a traceback or a 422 body.
        repr=False,
    )
    phone: str | None = Field(default=None, max_length=32)
    #: The client may only register as one of three roles. ``admin`` is a
    #: database value but is never self-registerable, so it is excluded from
    #: this enum rather than rejected later by a hand-written check.
    role: UserRole = Field(default=UserRole.CANDIDATE)

    @field_validator("password")
    @classmethod
    def _password_must_satisfy_the_policy(cls, value: str) -> str:
        """Enforce the policy here, not only in the service.

        This is the only place a signup password is judged. Length is also
        declared on the ``Field`` above, which gives the framework's own message
        for the two length bounds; this validator adds the two content rules.

        Every broken rule is raised as one error so the 422 carries one detail
        per rule and the client can show them all, rather than making the person
        discover them one attempt at a time.
        """

        problems = password_policy_errors(value)
        if problems:
            raise ValueError(" ".join(problems))
        return value

    @field_validator("role")
    @classmethod
    def _role_must_be_self_registerable(cls, value: UserRole) -> UserRole:
        """``admin`` is a valid database value but never a self-service one.

        Checked here rather than in the route so the failure arrives as a 422
        with a field detail the signup form can render next to the role picker,
        instead of a 403 the screen has no place for.
        """

        if value is UserRole.ADMIN:
            raise ValueError("This role cannot be self-registered.")
        return value


class LoginRequest(BaseModel):
    """``POST /auth/login``."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH, repr=False)


class TokenResponse(BaseModel):
    """``POST /auth/signup`` and ``POST /auth/login``.

    Exactly the mobile ``TokenResponse``. No refresh token in V1.
    """

    access_token: str
    #: Lower-case "bearer" — the integration suite asserts this exact string.
    token_type: str = "bearer"
    #: Seconds until the token expires.
    expires_in: int


class MembershipSummary(BaseModel):
    """One company a member belongs to. Empty in V1; companies arrive later."""

    company_id: str
    company_name: str
    role: str
    status: str


class PrincipalResponse(BaseModel):
    """``GET /auth/me`` — the session, as ``src/types/auth.ts`` defines it.

    Used by the client's auth provider to resolve who is signed in, so it is the
    route that decides whether the app shows a candidate, employer or college
    tree. ``designation`` is nullable, matching the client.
    """

    id: str
    public_id: str
    username: str
    name: str
    email: str
    role: str
    designation: str | None = None
    memberships: list[MembershipSummary] = Field(default_factory=list)


class MeResponse(BaseModel):
    """``GET /users/me`` — the caller's own account.

    Mirrors the mobile ``Me`` type in ``src/types/onboarding.ts``: it is the
    account screen's read model, and it is a *different* shape from
    ``PrincipalResponse``. ``/auth/me`` answers "who am I signing in as" and
    carries company memberships; ``/users/me`` answers "show my account" and
    carries the profile fields the settings screen edits.

    There is no ``password_hash`` here, and no schema field for one exists — the
    account read model simply cannot express it, so it cannot leak.
    """

    id: str
    public_id: str
    username: str
    name: str
    email: str
    phone: str | None = None
    role: str
    designation: str | None = None
    #: Null until the media phase exists and a photo is uploaded. Resolved from
    #: the stored media id later; always null in Phase 2.
    avatar_url: str | None = None
    created_at: str
