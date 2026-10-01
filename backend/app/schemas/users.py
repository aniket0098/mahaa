"""Account write models — ``src/api/users.ts`` and ``src/types/onboarding.ts``.

Two rules are enforced here rather than in a route:

* **A sensitive change carries the password.** ``email`` and ``username`` are
  identity fields and this stack has no email verification, so changing either
  requires ``current_password``. Without that, anyone who finds a logged-in
  session could take the account over permanently.
* **Nothing here can express a password hash.** These are write models, and the
  read model (``MeResponse``, in ``app.schemas.auth``) has no such field.
"""

from __future__ import annotations

import re

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.services.passwords import (
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    password_policy_errors,
)

#: Handles are lower-case alphanumerics and underscores, 3-32 characters. Kept
#: narrow so a handle is safe in a URL, a share sheet and a search box without
#: escaping, and so the database's case-sensitive unique index agrees with what
#: a person sees.
USERNAME_PATTERN = re.compile(r"^[a-z0-9_]{3,32}$")


class UserUpdate(BaseModel):
    """``PATCH /users/me`` — absent fields are left alone."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    email: EmailStr | None = None
    #: Nullable on purpose: clearing a phone number is a real edit.
    phone: str | None = Field(default=None, max_length=32)
    designation: str | None = Field(default=None, max_length=200)
    username: str | None = Field(default=None, min_length=3, max_length=32)
    #: Required by the service, not the schema, whenever ``email`` or
    #: ``username`` is present — see the model validator below.
    current_password: str | None = Field(default=None, repr=False)

    @field_validator("username")
    @classmethod
    def _username_is_a_handle(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not USERNAME_PATTERN.match(value):
            raise ValueError(
                "Username must be 3-32 characters, lowercase letters, numbers "
                "and underscores only."
            )
        return value

    @model_validator(mode="after")
    def _sensitive_change_needs_the_password(self) -> UserUpdate:
        """Refuse an identity change that carries no password.

        Done in the schema so the failure is a 422 naming the field, and so the
        rule cannot be forgotten on a second code path.
        """

        if (
            self.email is not None or self.username is not None
        ) and not self.current_password:
            raise ValueError(
                "current_password is required to change your email or username."
            )
        return self


class ChangePasswordRequest(BaseModel):
    """``POST /users/me/password`` — both halves required."""

    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(
        min_length=1, max_length=PASSWORD_MAX_LENGTH, repr=False
    )
    new_password: str = Field(
        min_length=PASSWORD_MIN_LENGTH,
        max_length=PASSWORD_MAX_LENGTH,
        repr=False,
    )

    @field_validator("new_password")
    @classmethod
    def _new_password_meets_the_policy(cls, value: str) -> str:
        """The Phase 2 policy, unchanged.

        Reusing ``password_policy_errors`` is the point: a password the signup
        form would reject must not be accepted here, or the two paths disagree
        about what a valid password is.
        """

        problems = password_policy_errors(value)
        if problems:
            raise ValueError(" ".join(problems))
        return value

    @model_validator(mode="after")
    def _must_actually_change(self) -> ChangePasswordRequest:
        if self.current_password == self.new_password:
            raise ValueError(
                "Your new password must be different from the current one."
            )
        return self


class DeleteAccountRequest(BaseModel):
    """``DELETE /users/me`` — two independent confirmations, per the safety rules.

    The password proves the account is really theirs; the typed phrase proves the
    deletion was deliberate rather than a mis-tap. Both are required, so neither
    alone can destroy an account.
    """

    model_config = ConfigDict(extra="forbid")

    password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH, repr=False)
    confirmation: str

    @field_validator("confirmation")
    @classmethod
    def _confirmation_is_exact(cls, value: str) -> str:
        if value != DELETE_CONFIRMATION_PHRASE:
            raise ValueError(
                f"Type {DELETE_CONFIRMATION_PHRASE} exactly to confirm the deletion."
            )
        return value


#: The phrase the client sends. Named so the requirement lives in one place and
#: the error message and the validator cannot disagree.
DELETE_CONFIRMATION_PHRASE = "DELETE"


class UsernameAvailability(BaseModel):
    """``GET /users/me/username/availability?username=``."""

    username: str
    available: bool


class UserSummary(BaseModel):
    """One ``GET /users/lookup`` result — minimal on purpose."""

    user_id: str
    public_id: str
    username: str
    name: str
    role: str
    avatar_url: str | None = None
