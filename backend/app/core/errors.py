"""The API error contract.

Every non-2xx response the backend produces uses one envelope, so the mobile
client can parse a failure the same way regardless of which route produced it::

    {
      "error": {
        "code": "not_found",
        "message": "A sentence written for the person reading it.",
        "details": [{"field": "body.email", "message": "...", "type": "..."}],
        "request_id": "0f3c…"
      }
    }

``details[].field`` keeps the framework's source prefix (``body.email``) because
that is what the validation layer produces; the client strips it when rendering
next to an input. Inventing a different shape here would mean teaching the app a
second error format.
"""

from __future__ import annotations

from typing import Any

from fastapi import status


class ErrorCode:
    """Stable, machine-readable codes. The client switches on these."""

    BAD_REQUEST = "bad_request"
    VALIDATION_ERROR = "validation_error"
    NOT_AUTHENTICATED = "not_authenticated"
    INVALID_CREDENTIALS = "invalid_credentials"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    UNPROCESSABLE = "unprocessable"
    RATE_LIMITED = "rate_limited"
    SERVICE_UNAVAILABLE = "service_unavailable"
    INTERNAL_ERROR = "internal_error"


#: The default sentence per status, used when a handler does not supply one.
#: These are written to be read by a person, not a log parser.
DEFAULT_MESSAGES: dict[int, str] = {
    status.HTTP_400_BAD_REQUEST: "The request could not be understood.",
    status.HTTP_401_UNAUTHORIZED: "Please sign in to continue.",
    status.HTTP_403_FORBIDDEN: "You do not have access to this.",
    status.HTTP_404_NOT_FOUND: "The requested resource was not found.",
    status.HTTP_409_CONFLICT: "That conflicts with something that already exists.",
    status.HTTP_422_UNPROCESSABLE_CONTENT: "Some of the details provided were not valid.",
    status.HTTP_429_TOO_MANY_REQUESTS: "Too many attempts. Please try again shortly.",
    status.HTTP_503_SERVICE_UNAVAILABLE: "The service is temporarily unavailable.",
}


#: One sentence for BOTH an unknown email and a wrong password, used verbatim by
#: ``POST /auth/login``. A login failure that distinguishes the two is an
#: account-enumeration oracle: it turns "sign in" into a way to discover who has
#: an account here. It is a constant rather than a ``DEFAULT_MESSAGES`` entry
#: because it is chosen deliberately for one endpoint, and a 401 from any other
#: route ("Please sign in to continue") means something different.
INVALID_CREDENTIALS_MESSAGE = "The email or password is not correct."


def error_detail(
    field: str | None, message: str, type_: str | None = None
) -> dict[str, Any]:
    """One entry of ``details``."""
    return {"field": field, "message": message, "type": type_}


def error_payload(
    *,
    code: str,
    message: str,
    details: list[dict[str, Any]] | None = None,
    request_id: str | None = None,
) -> dict[str, Any]:
    """Build the response body for a failure."""
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "request_id": request_id,
        }
    }


def message_for(status_code: int, override: str | None = None) -> str:
    return override or DEFAULT_MESSAGES.get(
        status_code, "The request could not be completed."
    )


class ApiError(Exception):
    """Raised anywhere in the service layer to fail a request deliberately.

    Handlers never construct an error response by hand: they raise this, and one
    exception handler renders it. That is what keeps the envelope identical
    across every route.
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str | None = None,
        details: list[dict[str, Any]] | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message_for(status_code, message)
        self.details = details
        super().__init__(self.message)
